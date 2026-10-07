export const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
export const lerp = (a, b, t) => a + (b - a) * t;
export function smoothstep(start, end, value) {
  const t = clamp((value - start) / (end - start));
  return t * t * (3 - 2 * t);
}

export function getIntroSceneState(progress) {
  const p = clamp(progress);
  return {
    copy: 1 - smoothstep(0.08, 0.42, p),
    photo: 1 - smoothstep(0.18, 0.52, p),
    lines: smoothstep(0.04, 0.16, p),
    draw: smoothstep(0.06, 0.6, p),
    morph: smoothstep(0.68, 1, p),
    research: smoothstep(0.84, 1, p),
  };
}

export function groupSceneWires(wires) {
  const paths = [];
  for (const line of wires) {
    const previous = paths.at(-1);
    if (previous && previous.kind === line.kind && previous.alpha === line.alpha
      && previous.lineWidth === line.lineWidth && previous.color.every((v, i) => v === line.color[i])
      && Math.hypot(...previous.points.at(-1).map((v, i) => v - line.a[i])) < 1e-7) {
      previous.points.push(line.b);
    } else {
      paths.push({ points: [line.a, line.b], alpha: line.alpha, lineWidth: line.lineWidth, color: line.color, kind: line.kind });
    }
  }
  return paths;
}

export function clipSceneWires(wires, width, height) {
  return wires.flatMap(line => {
    let start = 0;
    let end = 1;
    for (const [axis, limit] of [[0, width], [1, height]]) {
      const delta = line.b[axis] - line.a[axis];
      if (delta === 0) {
        if (line.a[axis] < 0 || line.a[axis] > limit) return [];
      } else {
        const a = -line.a[axis] / delta;
        const b = (limit - line.a[axis]) / delta;
        start = Math.max(start, Math.min(a, b));
        end = Math.min(end, Math.max(a, b));
      }
    }
    if (start >= end) return [];
    return [{
      ...line,
      a: line.a.map((v, axis) => lerp(v, line.b[axis], start)),
      b: line.a.map((v, axis) => lerp(v, line.b[axis], end)),
    }];
  });
}

function pathDistances(points) {
  if (points.length < 2) throw new RangeError('Morph paths need at least two points.');
  const distances = [0];
  for (let i = 1; i < points.length; i++) {
    distances.push(distances.at(-1) + Math.hypot(...points[i].map((v, axis) => v - points[i - 1][axis])));
  }
  if (distances.at(-1) === 0) throw new RangeError('Morph paths must have positive length.');
  return distances;
}

function samplePolyline(points, distances, fraction) {
  if (fraction === 1) return [...points.at(-1)];
  const distance = distances.at(-1) * fraction;
  let cursor = 1;
  let end = points.length - 1;
  while (cursor < end) {
    const middle = Math.floor((cursor + end) / 2);
    if (distances[middle] <= distance) cursor = middle + 1;
    else end = middle;
  }
  const span = distances[cursor] - distances[cursor - 1];
  const t = span === 0 ? 0 : (distance - distances[cursor - 1]) / span;
  return points[cursor - 1].map((v, axis) => lerp(v, points[cursor][axis], t));
}

function splitLongestPath(paths, distances) {
  const index = distances.reduce((best, lengths, i) => lengths.at(-1) > distances[best].at(-1) ? i : best, 0);
  const path = paths[index];
  const lengths = distances[index];
  const midpoint = samplePolyline(path.points, lengths, 0.5);
  const split = lengths.findIndex(length => length >= lengths.at(-1) / 2);
  paths.splice(index, 1,
    { ...path, points: [...path.points.slice(0, split), midpoint] },
    { ...path, points: [midpoint, ...path.points.slice(split)] });
  distances.splice(index, 1, pathDistances(paths[index].points), pathDistances(paths[index + 1].points));
}

export function matchMorphPaths(source, target) {
  if (!source.length || !target.length) throw new RangeError('Morph paths must not be empty.');
  const starts = source.map(path => ({ ...path, points: [...path.points] }));
  const ends = target.map(path => ({ ...path, points: [...path.points] }));
  const startLengths = starts.map(path => pathDistances(path.points));
  const endLengths = ends.map(path => pathDistances(path.points));
  while (starts.length < ends.length) splitLongestPath(starts, startLengths);
  while (ends.length < starts.length) splitLongestPath(ends, endLengths);
  const centers = paths => paths.map(({ points }) => [0, 1].map(axis =>
    points.reduce((sum, point) => sum + point[axis], 0) / points.length));
  const normalize = points => {
    const min = [0, 1].map(axis => Math.min(...points.map(point => point[axis])));
    const max = [0, 1].map(axis => Math.max(...points.map(point => point[axis])));
    return points.map(point => point.map((v, axis) => (v - min[axis]) / (max[axis] - min[axis] || 1)));
  };
  const from = normalize(centers(starts));
  const to = normalize(centers(ends));
  const available = new Set(starts.map((_, i) => i));
  // Spatial correspondence keeps upper portrait strokes near the lamp/head and lower strokes near the floor.
  return to.map((point, index) => ({ point, index })).sort((a, b) => a.point[1] - b.point[1])
    .map(({ point, index }) => {
      let closest = -1;
      let distance = Infinity;
      for (const candidate of available) {
        const cost = (point[0] - from[candidate][0]) ** 2 + (point[1] - from[candidate][1]) ** 2;
        if (cost < distance) { closest = candidate; distance = cost; }
      }
      available.delete(closest);
      const start = starts[closest];
      const end = ends[index];
      const distanceBetween = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (distanceBetween(start.points[0], end.points[0]) + distanceBetween(start.points.at(-1), end.points.at(-1))
        > distanceBetween(start.points.at(-1), end.points[0]) + distanceBetween(start.points[0], end.points.at(-1))) {
        start.points.reverse();
      }
      const startDistances = pathDistances(start.points);
      const endDistances = pathDistances(end.points);
      // Retain every vertex of both drawings; interpolation must not cut corners at either endpoint.
      const fractions = [...new Set([
        ...startDistances.map(v => v / startDistances.at(-1)),
        ...endDistances.map(v => v / endDistances.at(-1)),
      ])].sort((a, b) => a - b);
      return {
        sourceId: closest, targetId: index,
        from: { ...start, points: fractions.map(t => samplePolyline(start.points, startDistances, t)) },
        to: { ...end, points: fractions.map(t => samplePolyline(end.points, endDistances, t)) },
      };
    });
}

export function interpolateMorphPath(pair, progress) {
  const t = clamp(progress);
  const { from, to } = pair;
  return {
    points: from.points.map((point, i) => point.map((v, axis) => lerp(v, to.points[i][axis], t))),
    alpha: lerp(from.alpha, to.alpha, t),
    lineWidth: lerp(from.lineWidth, to.lineWidth, t),
    color: from.color.map((v, axis) => lerp(v, to.color[axis], t)),
  };
}

export const boxVertices = [
  [-1.95, -1.55, -0.85], [1.75, -1.55, -0.85],
  [1.75, -1.55, 0.85], [-1.95, -1.55, 0.85],
  [-1.95, 1.25, -0.85], [1.75, 1.25, -0.85],
  [1.75, 1.25, 0.85], [-1.95, 1.25, 0.85],
];
export const boxEdges = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];

export function getPoseSceneState(progress) {
  const p = clamp(progress);
  const pull = smoothstep(0.46, 0.54, p);
  const light = 1 - smoothstep(0.45, 0.8, pull);
  return {
    chapter: p < 0.16 ? 0 : p < 0.46 ? 1 : p < 0.76 ? 2 : 3,
    phase: p < 0.16 ? 'observe' : p < 0.34 ? 'initial-building' : p < 0.46 ? 'initial-ready'
      : p < 0.70 ? 'lights-off' : p < 0.75 ? 'falling' : p < 0.76 ? 'failed'
        : p <= 0.80 ? 'new-start' : p < 0.97 ? 'new-building' : 'new-ready',
    box: smoothstep(0.16, 0.34, p),
    light,
    lampPull: {
      visible: p > 0.34 && p < 0.69,
      approach: smoothstep(0.34, 0.42, p),
      grip: smoothstep(0.42, 0.46, p) * (1 - smoothstep(0.56, 0.60, p)),
      extension: pull * (1 - smoothstep(0.58, 0.64, p)),
      handPull: pull,
      exit: smoothstep(0.60, 0.69, p),
    },
    duckOpacity: lerp(0.19, 0.78, light),
    collapse: smoothstep(0.70, 0.75, p),
    recovery: smoothstep(0.80, 0.97, p),
    yaw: lerp(-0.58, -0.33, smoothstep(0, 0.43, p)),
  };
}

export function getSpatialSceneState(progress) {
  const p = clamp(progress);
  const pose = getPoseSceneState(p / 0.55);
  const interaction = smoothstep(0.55, 0.59, p);
  const approach = smoothstep(0.56, 0.62, p);
  const lift = smoothstep(0.65, 0.74, p);
  const place = smoothstep(0.80, 0.87, p);
  const release = smoothstep(0.87, 0.90, p);
  const exit = smoothstep(0.90, 0.94, p);
  const room = smoothstep(0.80, 0.88, p);
  return {
    ...pose,
    chapter: p < 0.55 ? pose.chapter : p < 0.80 ? 4 : 5,
    phase: p < 0.55 ? pose.phase : p < 0.62 ? 'hand-approach' : p < 0.65 ? 'hand-grasp'
      : p < 0.80 ? 'hand-lift' : p < 0.87 ? 'object-place' : p < 0.94 ? 'hand-release' : 'room-layout',
    lampOpacity: 1 - interaction,
    debrisOpacity: 1 - interaction,
    duckOpacity: lerp(pose.duckOpacity, 0.72, interaction),
    handOpacity: smoothstep(0.55, 0.58, p) * (1 - exit),
    handOffset: [3.5 * (1 - approach) + exit * 4, 0.8 * (1 - approach) + exit, 0],
    grip: smoothstep(0.62, 0.65, p) * (1 - release),
    objectTranslation: [0.3 * lift + 0.3 * place, 1.6 * lift * (1 - place), 0.15 * lift],
    objectRotation: [0.22 * lift * (1 - place), -0.10 * lift * (1 - place)],
    objectScale: 1,
    cameraTarget: [0, 0, 0],
    room,
    layout: smoothstep(0.91, 0.995, p),
    zoom: lerp(1, 0.53, room),
    yaw: lerp(pose.yaw, -0.55, room),
    pitch: lerp(0.21, 0.32, room),
    cameraDistance: lerp(9, 18, room),
  };
}

export function getActionSceneState(progress) {
  const p = clamp(progress);
  const spatial = getSpatialSceneState(p / 0.8);
  const action = clamp((p - 0.8) / 0.2);
  const base = { ...spatial, desk: 0, actionLabel: '', roomOpacity: 1 };
  if (p < 0.8) return base;
  const approach = smoothstep(0.08, 0.22, action);
  const lift = smoothstep(0.32, 0.48, action);
  const carry = smoothstep(0.48, 0.65, action);
  const place = smoothstep(0.65, 0.80, action);
  const release = smoothstep(0.80, 0.88, action);
  const exit = smoothstep(0.88, 0.96, action);
  const focus = smoothstep(0, 0.12, action);
  const objectScale = lerp(1, 0.45, focus);
  return {
    ...base,
    chapter: 6,
    phase: 'action-recognition',
    desk: focus,
    roomOpacity: 1 - focus,
    recovery: 0,
    zoom: lerp(spatial.zoom, 0.72, focus),
    yaw: lerp(spatial.yaw, -0.25, focus),
    cameraTarget: [0, 0.1 * focus, -1.9 * focus],
    objectScale,
    actionLabel: action < 0.08 ? '' : action < 0.22 ? 'Reach' : action < 0.32 ? 'Grasp'
      : action < 0.48 ? 'Lift' : action < 0.65 ? 'Move' : action < 0.80 ? 'Place'
        : action < 0.96 ? 'Release' : 'Placed',
    handOpacity: smoothstep(0.08, 0.14, action) * (1 - exit),
    handOffset: [4 * (1 - approach) + exit * 4, 1 - approach + exit, 0],
    grip: smoothstep(0.22, 0.32, action) * (1 - release),
    objectTranslation: [lerp(0.6, -0.4, carry), -1.5 * (1 - objectScale) + 2.7 * lift - 0.7 * place, lerp(0.15, -2.15, carry)],
    objectRotation: [0, 0],
  };
}

export const vlmQuestionText = 'Where did I place the duck?';
export const vlmAnswerText = 'The duck is placed on the center of the desk.';
export const vlmQuestionWords = vlmQuestionText.split(' ');
export const vlmCaptureTimes = [0.18, 0.42, 0.66];
export const vlmFrameTimes = vlmCaptureTimes;
function getVlmReplay(p) {
  const [first, second, third] = vlmCaptureTimes;
  return p < second ? lerp(0.998, 0.946, smoothstep(first + 0.212, second, p))
    : lerp(0.946, 0.88, smoothstep(second + 0.212, third, p));
}
export const vlmFrameSamples = vlmFrameTimes.map(getVlmReplay);
export const vlmTokenCount = vlmQuestionWords.length + vlmFrameSamples.length * 20;
export const efficientTokenCount = vlmQuestionWords.length + 20 + 8;
export const standardTokenBudget = 64000;
export const efficientTokenBudget = 4500;
export const tokensPerSquare = 2000;
export const tokenReduction = 1 - efficientTokenBudget / standardTokenBudget;

// Source patches animate into budget blocks; they are not a real model tokenizer.
export function getTokenBudgetRow(tokenCount, width) {
  const gap = width * 0.80 / (standardTokenBudget / tokensPerSquare - 1);
  const size = Math.min(12, gap * 0.72);
  return Array.from({ length: Math.ceil(tokenCount / tokensPerSquare) }, (_, index) => ({
    x: width * 0.08 + index * gap,
    size,
    weight: Math.min(1, tokenCount / tokensPerSquare - index),
  }));
}

export function getVlmState(progress) {
  const p = clamp(progress);
  const replay = getVlmReplay(p);
  return {
    progress: p,
    question: clamp((p - 0.02) / 0.14),
    questionTokens: smoothstep(0.18, 0.28, p),
    replay: lerp(replay, 1, smoothstep(0.88, 0.94, p)),
    flashes: vlmCaptureTimes.map(time => smoothstep(time, time + 0.012, p) * (1 - smoothstep(time + 0.012, time + 0.05, p))),
    model: smoothstep(0.85, 0.88, p),
    processed: smoothstep(0.94, 0.96, p),
    answer: clamp((p - 0.96) / (0.995 - 0.96)),
  };
}

export function getVlmToken(index, progress) {
  const text = index < vlmQuestionWords.length;
  const visualIndex = index - vlmQuestionWords.length;
  const frame = text ? null : Math.floor(visualIndex / 20);
  const cell = text ? index : visualIndex % 20;
  const start = text ? 0.18 + cell * 0.002 : vlmFrameTimes[frame] + 0.012;
  const collect = text ? smoothstep(start, start + 0.07, progress)
    : smoothstep(start + 0.07, start + 0.20, progress);
  const delay = (vlmTokenCount - 1 - index) / (vlmTokenCount - 1) * 0.02;
  const travel = smoothstep(0.88 + delay, 0.919 + delay, progress);
  return { text, frame, cell, collect, travel, opacity: smoothstep(start, start + 0.012, progress) };
}

export function getVlmTokenPosition(index, progress, width, height, origin) {
  const token = getVlmToken(index, progress);
  const startX = origin?.[0] ?? width * (token.text ? 0.2 + token.cell * 0.12 : 0.13 + (token.cell % 5 + 0.5) * 0.148);
  const startY = origin?.[1] ?? height * (token.text ? 0.12 : 0.27 + (Math.floor(token.cell / 5) + 0.5) * 0.09);
  const gap = width * 0.80 / (vlmTokenCount - 1);
  return {
    ...token,
    x: lerp(startX, width * 0.08 + index * gap, token.collect),
    y: lerp(startY, height * 0.70, token.collect),
    size: Math.min(6, gap * 0.72),
  };
}

export function getVisibleFrameIndices(state) {
  const frames = new Set();
  for (let index = vlmQuestionWords.length; index < vlmTokenCount; index++) {
    const token = getVlmToken(index, state.vlm.progress);
    if (token.opacity > 0 && token.collect < 1) frames.add(token.frame);
  }
  if (state.efficient) {
    for (let index = 0; index < efficientTokenCount; index++) {
      const token = getEfficientTokenPosition(index, state.efficient.progress, 1, 1, [0, 0]);
      if (!token.text && !token.motion && token.opacity > 0 && token.collect < 1) {
        frames.add(vlmFrameSamples.length - 1);
        break;
      }
    }
  }
  return [...frames];
}

export function getVlmSceneState(progress) {
  const p = clamp(progress);
  const action = getActionSceneState(p / 0.82);
  if (p < 0.82) return { ...action, vlm: null };
  const vlm = getVlmState((p - 0.82) / 0.18);
  return {
    ...getActionSceneState(vlm.replay),
    chapter: 7,
    phase: 'spatial-vlm',
    actionLabel: '',
    vlm,
  };
}

export function getEfficientMotion(index) {
  const from = getActionSceneState(lerp(0.88, 0.96, index / 8)).objectTranslation;
  const to = getActionSceneState(lerp(0.88, 0.96, (index + 1) / 8)).objectTranslation;
  return { from, to };
}

export function getEfficientTrajectory(state, width, height) {
  const { efficient } = state;
  const { project } = getSceneProjection(state, width, height);
  const start = project(getActionSceneState(0.88).objectTranslation);
  const lifted = project(getActionSceneState(0.91).objectTranslation);
  const end = project(getActionSceneState(0.96).objectTranslation);
  const rise = Math.abs(start[1] - lifted[1]);
  // Round the lift/carry/place corners into one illustrative arc, anchored to the real endpoints.
  const controlA = [start[0] - rise * 0.95, start[1] - rise * 0.25];
  const controlB = [end[0] - rise * 0.8, lifted[1] - rise * 0.5];
  const sample = t => start.map((value, axis) =>
    (1 - t) ** 3 * value + 3 * (1 - t) ** 2 * t * controlA[axis]
    + 3 * (1 - t) * t ** 2 * controlB[axis] + t ** 3 * end[axis]);
  const reveal = efficient.motion.reduce((sum, amount) => sum + amount, 0) / efficient.motion.length;
  const steps = 128;
  const last = Math.floor(reveal * steps);
  const points = Array.from({ length: last + 1 }, (_, i) => ({ position: sample(i / steps), time: i / steps }));
  if (reveal * steps > last) points.push({ position: sample(reveal), time: reveal });
  return {
    points,
    origins: Array.from({ length: 8 }, (_, i) => sample((i + 0.5) / 8)),
    tangent: start.map((value, axis) =>
      3 * (1 - reveal) ** 2 * (controlA[axis] - value)
      + 6 * (1 - reveal) * reveal * (controlB[axis] - controlA[axis])
      + 3 * reveal ** 2 * (end[axis] - controlB[axis])),
    reveal,
    opacity: efficient.motion[0] * (1 - efficient.answer),
    lineWidth: clamp(width * 0.006, 2.4, 3.4),
  };
}

export function getEfficientState(progress) {
  const p = clamp(progress);
  return {
    progress: p,
    intro: smoothstep(0, 0.12, p),
    replay: p < 0.54 ? lerp(1, 0.88, smoothstep(0.10, 0.24, p))
      : lerp(0.88, 1, smoothstep(0.54, 0.78, p)),
    flash: smoothstep(0.24, 0.252, p) * (1 - smoothstep(0.252, 0.29, p)),
    motion: Array.from({ length: 8 }, (_, i) => smoothstep(0.54 + i * 0.03, 0.57 + i * 0.03, p)),
    processed: smoothstep(0.94, 0.96, p),
    answer: clamp((p - 0.965) / (0.999 - 0.965)),
  };
}

export function getEfficientTokenPosition(index, progress, width, height, motionOrigin) {
  const text = index < 6;
  const motion = index >= 26;
  const cell = text ? index : motion ? index - 26 : index - 6;
  const start = text ? 0.12 : motion ? 0.59 + cell * 0.025 : 0.26;
  const collect = text || motion ? smoothstep(start, start + 0.08, progress)
    : smoothstep(0.34, 0.54, progress);
  const gap = width * 0.80 * (efficientTokenBudget / standardTokenBudget) / (efficientTokenCount - 1);
  const size = Math.min(6, gap * 0.72);
  const source = text ? [getVlmTokenPosition(index, 1, width, height).x, height * 0.65]
    : motion ? motionOrigin
      : [width * (0.13 + (cell % 5 + 0.5) * 0.148), height * (0.21 + (Math.floor(cell / 5) + 0.5) * 0.09)];
  const delay = (efficientTokenCount - 1 - index) / (efficientTokenCount - 1) * 0.035;
  return {
    text, motion, cell, collect, size,
    x: lerp(source[0], width * 0.08 + index * gap, collect),
    y: lerp(source[1], height * 0.75, collect),
    opacity: smoothstep(start, start + 0.012, progress),
    travel: smoothstep(0.86 + delay, 0.90 + delay, progress),
  };
}

export function getSceneState(progress) {
  const p = clamp(progress);
  if (p < 0.83) return { ...getVlmSceneState(p / 0.83), efficient: null };
  const efficient = getEfficientState((p - 0.83) / 0.17);
  return {
    ...getActionSceneState(efficient.replay),
    chapter: 8,
    phase: 'efficient-vlm',
    actionLabel: '',
    vlm: { ...getVlmState(1), processed: efficient.processed, answer: efficient.progress < 0.12 ? 1 : efficient.answer },
    efficient,
  };
}

const spatialDuration = 0.8 * 0.82 * 0.83;
export const chapterStops = [
  { copyChapter: null, sceneProgress: 0, duration: 1800 },
  { copyChapter: 0, sceneProgress: 0.34 * 0.55 * spatialDuration, duration: 1800 },
  { copyChapter: null, sceneProgress: 0.755 * 0.55 * spatialDuration, duration: 3600 },
  { copyChapter: 3, sceneProgress: 0.98 * 0.55 * spatialDuration, duration: 2000 },
  { copyChapter: 4, sceneProgress: 0.78 * spatialDuration, duration: 2600 },
  { copyChapter: 5, sceneProgress: 0.997 * spatialDuration, duration: 3000 },
  { copyChapter: 6, sceneProgress: 0.998 * 0.82 * 0.83, duration: 3600 },
  { copyChapter: 7, sceneProgress: (0.82 + 0.18 * 0.999) * 0.83, duration: 8000, scrollViewports: 2.5 },
  { copyChapter: 8, sceneProgress: 1, duration: 7000, scrollViewports: 2.5 },
];

export const photoChapter = -2;
export const portraitChapter = -1;
const openingStops = [
  { introProgress: 0, sceneProgress: 0, copyChapter: null },
  { introProgress: 0.65, sceneProgress: 0, copyChapter: null },
];

function getPlaybackStop(index) {
  return index < 0 ? openingStops[index - photoChapter] : { ...chapterStops[index], introProgress: 1 };
}

function getPlaybackTiming(fromIndex, toIndex) {
  const from = getPlaybackStop(fromIndex), to = getPlaybackStop(toIndex);
  const introDuration = from.introProgress === to.introProgress ? 0
    : Math.min(fromIndex, toIndex) === photoChapter ? 2200 : 2400;
  const sceneDuration = from.sceneProgress === to.sceneProgress ? 0 : chapterStops[Math.max(fromIndex, toIndex)].duration;
  const fadeOut = from.copyChapter === null ? 0 : 180;
  const finish = fadeOut + introDuration + sceneDuration;
  const fadeIn = to.copyChapter === null ? 0 : 250;
  const introStart = fadeOut + (toIndex < fromIndex ? sceneDuration : 0);
  const sceneStart = fadeOut + (toIndex > fromIndex ? introDuration : 0);
  return { from, to, introDuration, sceneDuration, fadeOut, finish, fadeIn, introStart, sceneStart };
}

export function getChapterPlayback(fromIndex, toIndex, elapsed, reducedMotion = false) {
  const { from, to, introDuration, sceneDuration, fadeOut, finish, fadeIn, introStart, sceneStart } = getPlaybackTiming(fromIndex, toIndex);
  if (reducedMotion || fromIndex === toIndex || elapsed >= finish + fadeIn) {
    return {
      introProgress: to.introProgress,
      sceneProgress: to.sceneProgress,
      copy: { chapter: to.copyChapter, opacity: to.copyChapter === null ? 0 : 1 },
      playing: false,
    };
  }
  if (fadeOut) {
    const duration = finish + fadeIn;
    const readingEnd = duration * 0.30;
    const fadeEnd = duration * 0.45;
    if (elapsed < fadeEnd) {
      return {
        introProgress: from.introProgress,
        sceneProgress: from.sceneProgress,
        copy: { chapter: from.copyChapter, opacity: 1 - smoothstep(readingEnd, fadeEnd, elapsed) },
        playing: true,
      };
    }
    // Reserve scroll space for reading without moving any chapter boundary.
    elapsed = lerp(fadeOut, duration, (elapsed - fadeEnd) / (duration - fadeEnd));
  }
  const sceneProgress = sceneDuration ? lerp(from.sceneProgress, to.sceneProgress, smoothstep(sceneStart, sceneStart + sceneDuration, elapsed)) : to.sceneProgress;
  const copyOpacity = toIndex === chapterStops.length - 1
    ? smoothstep(0.95, 0.97, sceneProgress)
    : smoothstep(finish, finish + 250, elapsed);
  return {
    introProgress: introDuration ? lerp(from.introProgress, to.introProgress, smoothstep(introStart, introStart + introDuration, elapsed)) : to.introProgress,
    sceneProgress,
    copy: { chapter: to.copyChapter, opacity: to.copyChapter === null ? 0 : copyOpacity },
    playing: true,
  };
}

export function getScrollStops({ introOverflow, introDistance, storyTop, viewportHeight }) {
  let position = storyTop;
  const stops = [
    { chapter: photoChapter, position: introOverflow, time: 0 },
    { chapter: portraitChapter, position: introOverflow + introDistance * 0.65, time: 0 },
    ...chapterStops.map((stop, chapter) => {
      if (chapter > 0) position += (stop.scrollViewports ?? 1) * viewportHeight;
      return { chapter, position, time: 0 };
    }),
  ];
  for (let index = 1; index < stops.length; index++) {
    const timing = getPlaybackTiming(stops[index - 1].chapter, stops[index].chapter);
    stops[index].time = stops[index - 1].time + timing.finish + timing.fadeIn;
  }
  return stops;
}

function interpolateStops(value, stops, source, target) {
  if (value <= stops[0][source]) return stops[0][target];
  const index = stops.findIndex(stop => stop[source] >= value);
  if (index === -1) return stops.at(-1)[target];
  const from = stops[index - 1], to = stops[index];
  return lerp(from[target], to[target], (value - from[source]) / (to[source] - from[source]));
}

export const getScrollTime = (position, stops) => interpolateStops(position, stops, 'position', 'time');
export const getScrollPosition = (time, stops) => interpolateStops(time, stops, 'time', 'position');

export function getScrollState(position, stops) {
  const nearby = stops.find(stop => Math.abs(stop.position - position) < 1);
  const time = nearby ? nearby.time : getScrollTime(position, stops);
  const index = stops.findIndex(stop => stop.time >= time);
  const to = stops[index];
  const from = stops[Math.max(0, index - 1)];
  return { ...getChapterPlayback(from.chapter, to.chapter, time - from.time), chapter: to.chapter, time };
}

export function getChapterScrollBoundary(position, direction, stops) {
  if (direction === 0) return null;
  const candidates = stops.filter(stop => stop.chapter !== 0
    && (direction < 0 || (stop.chapter !== 2 && stop.chapter !== photoChapter)));
  return direction > 0
    ? candidates.find(stop => stop.position > position + 1) ?? null
    : candidates.findLast(stop => stop.position < position - 1) ?? null;
}

export function isFreeScroll(distance, viewportHeight) {
  return distance > clamp(viewportHeight * 0.75, 360, 900);
}

export function getManualScroll(position, previousPosition, gesture, stops, viewportHeight) {
  const delta = position - previousPosition;
  if (Math.abs(delta) < 0.1) return { position, gesture };
  const direction = Math.sign(delta);
  const distance = gesture.distance + Math.abs(delta);
  const free = gesture.free || isFreeScroll(distance, viewportHeight);
  const boundary = gesture.direction === direction ? gesture.boundary
    : getChapterScrollBoundary(previousPosition, direction, stops);
  const held = !free && boundary !== null && (position - boundary.position) * direction >= 0;
  return {
    position: held ? boundary.position : position,
    gesture: { ...gesture, distance, free, direction, boundary, held },
  };
}

export function getSceneProjection(state, width, height) {
  const scale = Math.min(width * 0.14, height * 0.105) * state.zoom;
  const cx = width / 2;
  const cy = height / 2 - scale * 0.175 + state.room * state.roomOpacity * scale * 1.3 - height * 0.06 * (state.efficient?.intro ?? 0);
  const project = createProjector(state.yaw, state.pitch, scale, cx, cy, state.cameraDistance, state.cameraTarget);
  return { scale, cx, cy, project };
}

export function getLampGeometry(state, width, height) {
  const { scale, cx, cy } = getSceneProjection(state, width, height);
  const size = Math.min(1, scale / 65);
  const x = cx - scale * 1.65;
  const y = cy - scale * 2.7;
  const project = ([px, py]) => [
    x + size * (px * Math.cos(-0.48) - py * Math.sin(-0.48)),
    y + size * (px * Math.sin(-0.48) + py * Math.cos(-0.48)),
  ];
  const shade = [[-9, -16], [9, -16], [23, 9], [-23, 9]].map(project);
  const bulb = Array.from({ length: 17 }, (_, i) => project([Math.cos(i / 16 * Math.PI) * 6, 10 + Math.sin(i / 16 * Math.PI) * 6]));
  const lamp = lerp(0.38, 1, state.light) * state.lampOpacity;
  const line = (a, b, alpha, lineWidth, color = [235, 240, 229], kind = 'lamp') => ({ a, b, alpha, lineWidth, color, kind });
  const wires = [
    line(project([0, -55]), project([0, -16]), lamp * 0.55, size, [232, 237, 226]),
    ...shade.map((a, i) => line(a, shade[(i + 1) % 4], lamp * 0.85, size * 1.2)),
    ...bulb.slice(1).map((b, i) => line(bulb[i], b, lamp * 0.85, size * 1.2)),
  ];
  const cordStart = project([-13, 9]);
  const cordRest = [cordStart[0], cordStart[1] + 68 * size];
  const cordEnd = [cordRest[0], cordRest[1] + 30 * size * state.lampPull.extension];
  const cordRadius = 3 * size;
  const cordLoop = Array.from({ length: 13 }, (_, i) => [
    cordEnd[0] + Math.cos(i / 12 * Math.PI * 2) * cordRadius,
    cordEnd[1] + Math.sin(i / 12 * Math.PI * 2) * cordRadius,
  ]);
  wires.push(line(cordStart, [cordEnd[0], cordEnd[1] - cordRadius], state.lampOpacity * 0.8, 0.85, [232, 237, 226], 'cord'));
  cordLoop.slice(1).forEach((b, i) => wires.push(line(cordLoop[i], b, state.lampOpacity * 0.8, 0.85, [232, 237, 226], 'cord')));
  const beam = [
    [x - 14 * size, y + 13 * size], [cx - scale * 0.35, cy + scale * 1.9],
    [cx + scale * 1.2, cy + scale * 2.2], [cx + scale * 2.35, cy + scale * 0.8],
    [x + 22 * size, y - 4 * size],
  ];
  if (state.light > 0) {
    wires.push(line(beam[0], beam[1], state.light * state.lampOpacity * 0.12, 0.7, [232, 237, 226], 'beam'));
    wires.push(line(beam[4], beam[3], state.light * state.lampOpacity * 0.12, 0.7, [232, 237, 226], 'beam'));
  }
  return { x, y, size, shade, bulb, beam, wires, cord: { start: cordStart, rest: cordRest, end: cordEnd } };
}

export function getLampPullHand(state, width, height) {
  const lamp = getLampGeometry(state, width, height);
  const scale = getSceneProjection(state, width, height).scale * 0.65;
  const { approach, grip, handPull, exit, visible } = state.lampPull;
  const travel = width + 4 * scale;
  const anchor = [
    lamp.cord.rest[0] + travel * (1 - approach + exit),
    lamp.cord.rest[1] + 30 * lamp.size * handPull + exit * 25 * lamp.size,
  ];
  const pose = { grip, handOffset: [0, 0, 0], objectScale: 1, objectTranslation: [0, 0, 0], objectRotation: [0, 0] };
  const joints = getHandJoints(pose, 'pinch');
  const tips = [4, 8].map(i => projectPoint(joints[i], state.yaw, state.pitch, scale, 0, 0, state.cameraDistance));
  const offset = anchor.map((v, axis) => v - (tips[0][axis] + tips[1][axis]) / 2);
  return { joints, forearm: getHandForearm(pose), scale, offset, visible };
}

export function getSceneWires(state, width, height, duck) {
  const { project } = getSceneProjection(state, width, height);
  const transform = createObjectTransform(state);
  const projected = new Map();
  const projectObject = point => {
    if (!projected.has(point)) projected.set(point, project(transform(point)));
    return projected.get(point);
  };
  const wires = [];
  const color = [232, 237, 226];
  for (let i = -5; i <= 5; i++) {
    const alpha = (1 - Math.abs(i) / 7) * 0.07 * (1 - state.room);
    wires.push({ a: project([i, -1.6, -4]), b: project([i, -1.6, 4]), alpha, lineWidth: 0.7, color, kind: 'ground' });
    wires.push({ a: project([-5, -1.6, i]), b: project([5, -1.6, i]), alpha, lineWidth: 0.7, color, kind: 'ground' });
  }
  if (state.lampOpacity > 0) wires.push(...getLampGeometry(state, width, height).wires);
  for (const { a, b, strength } of duck) {
    wires.push({
      a: projectObject(a), b: projectObject(b),
      alpha: clamp(strength * state.duckOpacity), lineWidth: strength > 0.7 ? 1.1 : 0.75, color, kind: 'duck',
    });
  }
  return wires;
}

export const deskBounds = { min: [-4, 0.35, -3.25], max: [4, 0.5, -1.05] };

export function createDeskScene() {
  const segments = [];
  const line = (a, b, strength = 0.55) => segments.push({ a, b, strength });
  const cuboid = (min, max, strength) => {
    const vertices = boxVertices.map(point => point.map((value, axis) => value < 0 ? min[axis] : max[axis]));
    boxEdges.forEach(([a, b]) => line(vertices[a], vertices[b], strength));
  };
  cuboid(deskBounds.min, deskBounds.max, 0.75);
  for (const x of [-3.7, 3.7]) {
    for (const z of [-3, -1.3]) cuboid([x - 0.08, -1.6, z - 0.08], [x + 0.08, 0.35, z + 0.08], 0.45);
  }
  // A small stack of books and a handled mug leave the middle of the desk free.
  cuboid([-3.8, 0.5, -2.8], [-2.7, 0.67, -1.5], 0.65);
  cuboid([-3.65, 0.68, -2.85], [-2.65, 0.83, -1.65], 0.55);
  for (const y of [0.55, 0.6, 0.73, 0.78]) line([-3.65, y, -1.5], [-2.75, y, -1.5], 0.25);
  const mug = (angle, y, radius = 0.38) => [2.65 + Math.cos(angle) * radius, y, -2.15 + Math.sin(angle) * radius];
  for (const y of [0.5, 1.32]) {
    for (let i = 0; i < 40; i++) line(mug(i / 40 * Math.PI * 2, y), mug((i + 1) / 40 * Math.PI * 2, y), 0.7);
  }
  for (let i = 0; i < 8; i++) line(mug(i / 8 * Math.PI * 2, 0.5), mug(i / 8 * Math.PI * 2, 1.32), 0.3);
  for (let i = 0; i < 24; i++) {
    const handle = angle => [3 + Math.sin(angle) * 0.4, 0.91 + Math.cos(angle) * 0.3, -2.15];
    line(handle(i / 24 * Math.PI), handle((i + 1) / 24 * Math.PI), 0.75);
  }
  line([1.7, 0.53, -1.4], [2.8, 0.53, -1.6], 0.7);
  line([1.7, 0.56, -1.4], [2.8, 0.56, -1.6], 0.4);
  return segments;
}

export function transformObjectPoint(point, state) {
  return createObjectTransform(state)(point);
}

export function createObjectTransform(state) {
  const [yaw, roll] = state.objectRotation;
  const cosYaw = Math.cos(yaw), sinYaw = Math.sin(yaw);
  const cosRoll = Math.cos(roll), sinRoll = Math.sin(roll);
  return point => {
    const px = point[0] * state.objectScale, py = point[1] * state.objectScale, pz = point[2] * state.objectScale;
    const x = px * cosYaw + pz * sinYaw;
    const z = -px * sinYaw + pz * cosYaw;
    return [
      x * cosRoll - py * sinRoll + state.objectTranslation[0],
      x * sinRoll + py * cosRoll + state.objectTranslation[1],
      z + state.objectTranslation[2],
    ];
  };
}

export const handBones = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [0, 9], [9, 10], [10, 11], [11, 12],
  [0, 13], [13, 14], [14, 15], [15, 16],
  [0, 17], [17, 18], [18, 19], [19, 20],
];

export function getHandJoints(state, grasp = 'object') {
  const open = [
    [2.2, 0.4, -0.3],
    [1.45, 0.2, -0.5], [0.9, 0.16, -0.95], [0.45, 0.12, -1.15], [0.1, 0.08, -1.25],
  ];
  const closed = [
    [2.2, 0.4, -0.3],
    [1.45, 0.1, -0.45], [0.95, -0.28, -0.68], [0.45, -0.65, -0.73], [0.2, -0.94, -0.62],
  ];
  [0.02, 0.36, 0.70, 1.02].forEach((x, finger) => {
    const y = -0.03 - finger * 0.055;
    const z = -0.10 - finger * 0.03;
    const length = [0.95, 1.06, 0.98, 0.80][finger];
    open.push([x, y, z], [x - 0.08, y + 0.12, z + length * 0.55],
      [x - 0.11, y + 0.16, z + length], [x - 0.12, y + 0.17, z + length * 1.3]);
    closed.push([x, y, z], [x - 0.04, y - 0.24, 0.43],
      [x - 0.07, y - 0.62, 0.74 - finger * 0.015], [x - 0.08, y - 0.92, 0.62 - finger * 0.02]);
  });
  if (grasp === 'pinch') {
    closed.splice(2, 3, [0.85, -0.10, -0.35], [0.35, -0.30, 0.03], [0.03, -0.45, 0.28]);
    closed.splice(6, 3, [0, -0.06, 0.38], [-0.08, -0.26, 0.42], [-0.03, -0.39, 0.28]);
  }
  const transform = createObjectTransform(state);
  return open.map((point, index) => transform(
    point.map((value, axis) => lerp(value, closed[index][axis], state.grip) + state.handOffset[axis]),
  ));
}

export function getHandForearm(state) {
  const transform = createObjectTransform(state);
  return [
    [2.2, 0.65, -0.53], [3.6, 0.85, -0.53], [3.6, 0.35, 0.0], [2.2, 0.15, 0.0],
  ].map(point => transform(point.map((value, axis) => value + state.handOffset[axis])));
}

export const roomVertices = [
  [-4.5, -1.6, -3.5], [4.5, -1.6, -3.5], [4.5, -1.6, 3.5], [-4.5, -1.6, 3.5],
  [-4.5, 4.2, -3.5], [4.5, 4.2, -3.5], [4.5, 4.2, 3.5], [-4.5, 4.2, 3.5],
];
export const roomDetails = [
  [[-3.0, 0.5, -3.49], [-0.5, 0.5, -3.49]],
  [[-0.5, 0.5, -3.49], [-0.5, 2.6, -3.49]],
  [[-0.5, 2.6, -3.49], [-3.0, 2.6, -3.49]],
  [[-3.0, 2.6, -3.49], [-3.0, 0.5, -3.49]],
  [[-1.75, 0.5, -3.49], [-1.75, 2.6, -3.49]],
  [[-3.0, 1.55, -3.49], [-0.5, 1.55, -3.49]],
  [[4.49, -1.6, -1.8], [4.49, 1.55, -1.8]],
  [[4.49, 1.55, -1.8], [4.49, 1.55, 0.1]],
  [[4.49, 1.55, 0.1], [4.49, -1.6, 0.1]],
];

export function getRoomLayout(progress) {
  const order = [0, 1, 2, 3, 8, 9, 10, 11, 4, 5, 6, 7];
  return order.flatMap((edge, index) => {
    const amount = clamp(progress * 3 - Math.floor(index / 4));
    if (amount === 0) return [];
    const [a, b] = boxEdges[edge].map(vertex => roomVertices[vertex]);
    return [{ a, b: a.map((value, axis) => lerp(value, b[axis], amount)) }];
  });
}

export function getRecoveryGeometry(progress) {
  const p = clamp(progress);
  const rise = clamp((p - 0.12) / 0.76);
  const edges = [];
  for (const [a, b] of boxEdges) {
    const amount = a < 4 && b < 4 ? clamp(p / 0.12)
      : a >= 4 && b >= 4 ? clamp((p - 0.88) / 0.12) : rise;
    if (amount > 0) {
      edges.push({
        a: boxVertices[a],
        b: boxVertices[a].map((value, axis) => lerp(value, boxVertices[b][axis], amount)),
      });
    }
  }
  return { edges, scanY: lerp(boxVertices[0][1], boxVertices[4][1], rise) };
}

export function projectPoint(point, yaw, pitch, scale, centerX, centerY, cameraDistance = 9) {
  return createProjector(yaw, pitch, scale, centerX, centerY, cameraDistance)(point);
}

export function createProjector(yaw, pitch, scale, centerX, centerY, cameraDistance = 9, target = [0, 0, 0]) {
  const cosYaw = Math.cos(yaw), sinYaw = Math.sin(yaw);
  const cosPitch = Math.cos(pitch), sinPitch = Math.sin(pitch);
  return point => {
    const x = point[0] - target[0], y = point[1] - target[1], z = point[2] - target[2];
    const rx = x * cosYaw + z * sinYaw;
    const rz = -x * sinYaw + z * cosYaw;
    const ry = y * cosPitch - rz * sinPitch;
    const depth = y * sinPitch + rz * cosPitch;
    const perspective = cameraDistance / (cameraDistance - depth);
    return [centerX + rx * scale * perspective, centerY - ry * scale * perspective];
  };
}

export function fallingEdge(index, progress) {
  const [a, b] = boxEdges[index].map(i => boxVertices[i]);
  const t = smoothstep(index * 0.016, 0.78 + index * 0.018, progress);
  const center = a.map((v, i) => (v + b[i]) / 2);
  const length = Math.hypot(...a.map((v, i) => v - b[i]));
  const angle = index * 2.399;
  const endCenter = [center[0] + Math.sin(angle) * 1.25, -1.57, center[2] + Math.cos(angle) * 0.9];
  const endDirection = [Math.cos(angle) * length / 2, 0, Math.sin(angle) * length / 2];
  const bounce = Math.sin(t * Math.PI * 3) ** 2 * (1 - t) * 0.22;
  return [a, b].map((point, end) => point.map((v, axis) => {
    const destination = endCenter[axis] + (end === 0 ? -1 : 1) * endDirection[axis];
    return lerp(v, destination, axis === 1 ? Math.min(1, t * t * 1.5) : t) + (axis === 1 ? bounce : 0);
  }));
}

export function createRubberDuck() {
  const segments = [];
  const curve = (sample, steps, strength) => {
    let a = sample(0);
    for (let i = 1; i <= steps; i++) {
      const b = sample(i / steps);
      if (Math.hypot(...a.map((v, axis) => v - b[axis])) > 1e-8) {
        segments.push({ a, b, strength });
      }
      a = b;
    }
  };

  // Horizontal cross-sections form one continuous body, neck, and head.
  const profile = [
    [-1.5, 0.22, 0, 0], [-1.4, 0.22, 0.66, 0.43],
    [-1.15, 0.19, 1.04, 0.67], [-0.8, 0.13, 1.18, 0.76],
    [-0.45, 0.02, 1.08, 0.68], [-0.18, -0.22, 0.66, 0.46],
    [0.02, -0.47, 0.39, 0.34], [0.25, -0.53, 0.53, 0.45],
    [0.55, -0.53, 0.62, 0.52], [0.85, -0.51, 0.54, 0.46],
    [1.06, -0.48, 0.32, 0.29], [1.15, -0.47, 0, 0],
  ];
  const bodyPoint = (t, angle) => {
    const position = t * (profile.length - 1);
    const index = Math.min(Math.floor(position), profile.length - 2);
    const u = position - index;
    const values = profile[index].map((_, axis) => {
      const a = profile[Math.max(0, index - 1)][axis];
      const b = profile[index][axis];
      const c = profile[index + 1][axis];
      const d = profile[Math.min(profile.length - 1, index + 2)][axis];
      return 0.5 * (2 * b + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u * u + (-a + 3 * b - 3 * c + d) * u * u * u);
    });
    const [y, x, rx, rz] = values;
    const tail = Math.max(0, Math.cos(angle)) ** 12 * Math.exp(-((y + 0.36) ** 2) / 0.035);
    return [x + Math.max(0, rx) * Math.cos(angle) + tail * 0.48, y + tail * 0.22, Math.max(0, rz) * Math.sin(angle)];
  };
  for (let ring = 1; ring < profile.length - 1; ring++) {
    curve(t => bodyPoint(ring / (profile.length - 1), t * Math.PI * 2), 64, 0.55);
  }
  for (let meridian = 0; meridian < 12; meridian++) {
    const angle = meridian / 12 * Math.PI * 2;
    curve(t => bodyPoint(t, angle), 88, Math.sin(angle) >= 0 ? 0.8 : 0.24);
  }

  const billPoint = (t, angle) => {
    const roundness = Math.sqrt(Math.max(0, 1 - t * t));
    return [-1.02 - t * 0.84, 0.37 + Math.cos(angle) * 0.11 * roundness - t * 0.035, Math.sin(angle) * 0.31 * roundness];
  };
  [0, 0.4, 0.75].forEach(t => curve(s => billPoint(t, s * Math.PI * 2), 32, 0.65));
  for (let side = 0; side < 8; side++) {
    curve(t => billPoint(t, side / 8 * Math.PI * 2), 24, 0.9);
  }
  [-1, 1].forEach(side => {
    curve(t => {
      const angle = t * Math.PI * 2;
      return [-0.79 + Math.cos(angle) * 0.075, 0.68 + Math.sin(angle) * 0.075, side * 0.46];
    }, 24, side > 0 ? 1.5 : 0.25);
    curve(t => {
      const angle = t * Math.PI * 2;
      return [-0.79 + Math.cos(angle) * 0.025, 0.68 + Math.sin(angle) * 0.025, side * 0.465];
    }, 16, side > 0 ? 1.8 : 0.25);
    curve(t => {
      const angle = t * Math.PI * 2;
      return [0.26 + Math.cos(angle) * 0.65, -0.79 + Math.sin(angle) * 0.29, side * (0.68 + Math.sin(angle) * 0.025)];
    }, 48, side > 0 ? 1.1 : 0.2);
  });
  return segments;
}
