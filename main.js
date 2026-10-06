import { clamp, lerp, boxVertices, boxEdges, getSceneState, getIntroSceneState, getActionSceneState, getRecoveryGeometry, fallingEdge, createRubberDuck, getHandJoints, handBones, roomVertices, roomDetails, getRoomLayout, createDeskScene, getSceneProjection, vlmFrameSamples, vlmTokenCount, vlmQuestionText, vlmAnswerText, vlmQuestionWords, getVlmToken, getVlmTokenPosition, efficientTokenCount, getEfficientTokenPosition, standardTokenBudget, efficientTokenBudget, tokensPerSquare, getTokenBudgetRow } from './geometry.js';
import { smoothstep, getLampGeometry, getLampPullHand, getHandForearm, createProjector, createObjectTransform, getSceneWires, groupSceneWires, clipSceneWires, matchMorphPaths, interpolateMorphPath, getEfficientTrajectory, chapterStops, getScrollStops, getScrollTime, getScrollPosition, getScrollState, getVisibleFrameIndices, getManualScroll } from './geometry.js';

const canvas = document.querySelector('#scene');
const ctx = canvas.getContext('2d');
if (!ctx) throw new Error('This browser does not support the Canvas 2D renderer.');
const story = document.querySelector('.scroll-story');
const viewport = document.querySelector('.story-viewport');
const introTrack = document.querySelector('.intro-track');
const intro = document.querySelector('.intro-section');
const introCopy = document.querySelector('.intro-copy');
const portrait = document.querySelector('.profile-visual');
const portraitLines = document.querySelector('.portrait-lines');
const portraitScrollHint = document.querySelector('#portrait-scroll-hint');
const morphCanvas = document.querySelector('#portrait-morph');
const morphContext = morphCanvas.getContext('2d');
if (!morphContext) throw new Error('Unable to create the portrait morph renderer.');
const chapters = [...document.querySelectorAll('.chapter')];
const chapterButtons = [...document.querySelectorAll('[data-chapter-step]')];
const progressBar = document.querySelector('#progress-bar');
const progressValue = document.querySelector('#progress-value');
const scrollInstruction = document.querySelector('#scroll-instruction');
const actionLabel = document.querySelector('#action-label');
const vlmUi = document.querySelector('#vlm-ui');
const vlmQuestion = document.querySelector('#vlm-question');
const vlmModel = document.querySelector('#vlm-model');
const vlmAnswer = document.querySelector('#vlm-answer');
const questionLetters = document.querySelector('#vlm-question-letters');
const answerLetters = document.querySelector('#vlm-answer-letters');
const answerStatus = document.querySelector('#vlm-answer-status');
const standardLabel = document.querySelector('#standard-token-label');
const efficientLabel = document.querySelector('#efficient-token-label');
const efficientInput = document.querySelector('#efficient-input');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const duck = createRubberDuck();
const desk = createDeskScene();
let width = 0;
let height = 0;
let activeChapter = -1;
let framePending = false;
let sampledFrames = [];
let introOverflow = 0;
let introDistance = 1;
let portraitBounds = { left: 0, top: 0, width: 0 };
let morphPairs = null;
let scrollStops = [];
let settleTimer = null;
let userScrolling = false;
let pointerDown = false;
let touching = false;
let lastScrollY = window.scrollY;
let writtenScrollPosition = null;
let gesture = null;
let layoutSize = '';

function samplePortraitPaths() {
  const paths = [];
  for (const original of portraitLines.querySelectorAll('path')) {
    // Sample subpaths separately so pen lifts never become unwanted connecting lines.
    for (const data of original.getAttribute('d').match(/M[^M]*/g)) {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', data);
      const length = path.getTotalLength();
      const steps = Math.ceil(length / 2);
      let points = [];
      for (let i = 0; i <= steps; i++) {
        const { x, y } = path.getPointAtLength(length * i / steps);
        if (Math.hypot(x - 400, y - 400) <= 400) {
          points.push([x, y]);
        } else {
          if (points.length > 1) paths.push(points);
          points = [];
        }
      }
      if (points.length > 1) paths.push(points);
    }
  }
  return paths;
}

const portraitPaths = samplePortraitPaths();

function createMorphPairs() {
  const scene = canvas.getBoundingClientRect();
  const viewportTop = viewport.getBoundingClientRect().top;
  const target = clipSceneWires(getSceneWires(getSceneState(0), width, height, duck), width, height).map(line => ({
    ...line,
    a: [line.a[0] + scene.left, line.a[1] + scene.top - viewportTop],
    b: [line.b[0] + scene.left, line.b[1] + scene.top - viewportTop],
  }));
  const scale = portraitBounds.width / 800;
  const project = point => [portraitBounds.left + point[0] * scale, portraitBounds.top + point[1] * scale];
  const source = portraitPaths.map(points => ({
    points: points.map(project), alpha: 1, lineWidth: 2.4 * scale, color: [239, 239, 235],
  }));
  return matchMorphPaths(source, groupSceneWires(target));
}

function drawPortraitMorph(progress) {
  if (!morphPairs) morphPairs = createMorphPairs();
  morphContext.save();
  morphContext.resetTransform();
  morphContext.clearRect(0, 0, morphCanvas.width, morphCanvas.height);
  morphContext.restore();
  for (const pair of morphPairs) {
    const line = interpolateMorphPath(pair, progress);
    morphContext.beginPath();
    morphContext.strokeStyle = `rgba(${line.color.join(',')},${line.alpha})`;
    morphContext.lineWidth = line.lineWidth;
    line.points.forEach((point, i) => i === 0 ? morphContext.moveTo(...point) : morphContext.lineTo(...point));
    morphContext.stroke();
  }
}

function layoutIntro() {
  const viewportHeight = viewport.offsetHeight;
  const size = `${document.documentElement.clientWidth}:${viewportHeight}:${intro.offsetHeight}:${window.devicePixelRatio}`;
  // Mobile browser chrome can resize the window without changing the svh story.
  if (size === layoutSize) return;
  layoutSize = size;
  const preservePosition = scrollStops.length > 0 && window.scrollY >= scrollStops[0].position
    && window.scrollY <= scrollStops.at(-1).position;
  const time = preservePosition ? getScrollTime(window.scrollY, scrollStops) : 0;
  resetScrollGesture();
  introTrack.classList.add('is-animated');
  story.style.height = `${chapterStops.length * viewportHeight}px`;
  const paperChapters = chapterStops.map((stop, index) => stop.copyChapter === null ? null : index).filter(index => index !== null);
  document.querySelectorAll('.scroll-anchor').forEach((anchor, index) => {
    anchor.style.top = `${paperChapters[index] * viewportHeight}px`;
    anchor.dataset.chapter = paperChapters[index];
  });
  introOverflow = Math.max(0, intro.offsetHeight - viewportHeight);
  introDistance = viewportHeight * 1.5;
  introTrack.style.height = `${intro.offsetHeight + introDistance}px`;
  intro.style.top = `${-introOverflow}px`;
  story.style.marginTop = `${-viewportHeight}px`;
  scrollStops = getScrollStops({ introOverflow, introDistance, storyTop: story.offsetTop, viewportHeight });
  const picture = portrait.getBoundingClientRect();
  const section = intro.getBoundingClientRect();
  portraitBounds = { left: picture.left, top: picture.top - section.top - introOverflow, width: picture.width };
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  morphCanvas.width = Math.round(document.documentElement.clientWidth * ratio);
  morphCanvas.height = Math.round(window.innerHeight * ratio);
  morphContext.setTransform(ratio, 0, 0, ratio, 0, 0);
  morphPairs = null;
  if (preservePosition) writeScroll(getScrollPosition(time, scrollStops));
  requestRender();
}

function renderIntro(p) {
  const state = getIntroSceneState(p);
  intro.style.setProperty('--intro-copy-opacity', state.copy);
  intro.style.setProperty('--portrait-photo-opacity', state.photo);
  intro.style.setProperty('--portrait-line-opacity', state.lines);
  intro.style.setProperty('--portrait-line-offset', 1 - state.draw);
  intro.style.visibility = p >= 1 ? 'hidden' : '';
  introCopy.inert = state.copy === 0;
  introCopy.setAttribute('aria-hidden', String(state.copy === 0));
  portraitLines.style.visibility = state.morph > 0 ? 'hidden' : '';
  morphCanvas.hidden = state.morph === 0 || state.morph === 1;
  viewport.classList.toggle('is-intro', p < 1);
  viewport.style.setProperty('--research-copy-opacity', state.research);
  viewport.style.visibility = state.morph === 0 ? 'hidden' : '';
  viewport.inert = state.research === 0;
  viewport.setAttribute('aria-hidden', String(state.research === 0));
  return state;
}

function writeScroll(top) {
  writtenScrollPosition = top;
  window.scrollTo({ top, behavior: 'instant' });
  lastScrollY = window.scrollY;
  requestRender();
}

function resetScrollGesture() {
  clearTimeout(settleTimer);
  settleTimer = null;
  userScrolling = false;
  gesture = null;
  requestRender();
}

function goToChapter(index) {
  resetScrollGesture();
  writeScroll(scrollStops.find(stop => stop.chapter === index).position);
}

function beginUserScroll(event, fresh = false) {
  const now = event?.timeStamp ?? performance.now();
  const previous = !fresh && gesture && (touching || pointerDown || event?.repeat
    || now - gesture.lastInput < 250) ? gesture : null;
  resetScrollGesture();
  userScrolling = true;
  gesture = previous ?? { distance: 0, free: false, direction: 0, boundary: null, held: false };
  gesture.lastInput = now;
  scheduleScrollEnd();
}

function scheduleScrollEnd() {
  clearTimeout(settleTimer);
  settleTimer = null;
  if (!userScrolling || pointerDown || touching) return;
  settleTimer = setTimeout(() => {
    settleTimer = null;
    userScrolling = false;
    requestRender();
  }, 280);
}

function scrollToBoundary(end) {
  resetScrollGesture();
  writeScroll(end ? document.documentElement.scrollHeight : 0);
}

function handleStoryScroll() {
  const position = window.scrollY;
  const ownScroll = writtenScrollPosition !== null && Math.abs(position - writtenScrollPosition) < 2;
  writtenScrollPosition = null;
  if (!ownScroll && gesture && Math.abs(position - lastScrollY) > 0.1) {
    const result = getManualScroll(position, lastScrollY, gesture, scrollStops, viewport.offsetHeight);
    gesture = result.gesture;
    userScrolling = true;
    if (result.position !== position) writeScroll(result.position);
    scheduleScrollEnd();
  }
  lastScrollY = window.scrollY;
  requestRender();
}

function scrollToContact() {
  const contact = document.querySelector('#contact');
  const top = Math.min(introOverflow, Math.max(0,
    contact.getBoundingClientRect().top - intro.getBoundingClientRect().top - 84));
  resetScrollGesture();
  writeScroll(top);
  renderIntro(0);
  contact.focus({ preventScroll: true });
}

document.querySelector('a[href="#contact"]').addEventListener('click', event => {
  event.preventDefault();
  history.pushState(null, '', '#contact');
  scrollToContact();
});

document.querySelectorAll('[data-jump]').forEach(link => {
  link.addEventListener('click', event => {
    event.preventDefault();
    resetScrollGesture();
    writeScroll(scrollStops[0].position);
  });
});
chapterButtons.forEach((button, index) => button.addEventListener('click', () => goToChapter(index)));
document.querySelectorAll('a[href="#top"], .skip-link').forEach(link => {
  link.addEventListener('click', event => {
    event.preventDefault();
    const end = link.hash === '#story-end';
    history.pushState(null, '', link.hash);
    scrollToBoundary(end);
    document.querySelector(end ? '#story-end' : '.wordmark').focus({ preventScroll: true });
  });
});
document.addEventListener('focusin', resetScrollGesture);

window.addEventListener('wheel', event => {
  if (event.ctrlKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
  if (event.deltaY !== 0) beginUserScroll(event);
}, { passive: true });

window.addEventListener('pointerdown', event => {
  pointerDown = true;
  beginUserScroll(event, true);
}, { passive: true });
function releasePointer() {
  pointerDown = false;
  scheduleScrollEnd();
}
window.addEventListener('pointerup', releasePointer, { passive: true });
window.addEventListener('pointercancel', releasePointer, { passive: true });
window.addEventListener('touchstart', event => {
  touching = true;
  beginUserScroll(event, true);
}, { passive: true });
window.addEventListener('touchmove', beginUserScroll, { passive: true });
function releaseTouch(event) {
  touching = event.touches.length > 0;
  scheduleScrollEnd();
}
window.addEventListener('touchend', releaseTouch, { passive: true });
window.addEventListener('touchcancel', releaseTouch, { passive: true });
window.addEventListener('keydown', event => {
  if (event.ctrlKey || event.metaKey || event.altKey
    || (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable]'))) return;
  if (['Home', 'End'].includes(event.key)) {
    event.preventDefault();
    scrollToBoundary(event.key === 'End');
    return;
  }
  if (event.target instanceof Element && event.target.closest('a, button')) return;
  if (['ArrowDown', 'PageDown', ' ', 'ArrowUp', 'PageUp'].includes(event.key)) beginUserScroll(event, !event.repeat);
});
document.addEventListener('visibilitychange', () => {
  resetScrollGesture();
});

function stroke(a, b, alpha = 1, lineWidth = 1, dash = [], color = [232, 237, 226]) {
  ctx.beginPath();
  ctx.strokeStyle = `rgba(${color.join(',')}, ${clamp(alpha)})`;
  ctx.lineWidth = lineWidth;
  ctx.setLineDash(dash);
  ctx.moveTo(...a);
  ctx.lineTo(...b);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawHand({ joints, forearm, opacity }, project, scale) {
  handBones.forEach(([a, b]) => {
    const start = joints[a];
    const end = joints[b];
    const direction = end.map((value, axis) => value - start[axis]);
    const length = Math.hypot(...direction);
    const normalLength = Math.hypot(direction[0], direction[2]);
    const normal = normalLength > 1e-6 ? [direction[2] / normalLength, 0, -direction[0] / normalLength] : [1, 0, 0];
    const tangent = [
      direction[1] * normal[2] / length,
      (direction[2] * normal[0] - direction[0] * normal[2]) / length,
      -direction[1] * normal[0] / length,
    ];
    const radius = a === 0 ? 0.075 : 0.065;
    for (let side = 0; side < 6; side++) {
      const angle = side / 6 * Math.PI * 2;
      const offset = normal.map((value, axis) => radius * (value * Math.cos(angle) + tangent[axis] * Math.sin(angle)));
      stroke(project(start.map((value, axis) => value + offset[axis])),
        project(end.map((value, axis) => value + offset[axis])), opacity * 0.26, 0.6);
    }
    stroke(project(start), project(end), opacity * 0.9, 1.15);
  });
  const palm = [0, 1, 5, 9, 13, 17, 0];
  for (let i = 0; i < palm.length - 1; i++) {
    stroke(project(joints[palm[i]]), project(joints[palm[i + 1]]), opacity * 0.6, 0.9);
  }
  forearm.forEach((point, index) => stroke(project(point), project(forearm[(index + 1) % 4]), opacity * 0.4, 0.8));
  joints.forEach(point => {
    const [x, y] = project(point);
    ctx.beginPath();
    ctx.arc(x, y, clamp(scale * 0.033, 1.3, 2.5), 0, Math.PI * 2);
    ctx.fillStyle = `rgba(242, 246, 236, ${opacity})`;
    ctx.fill();
  });
}

function drawRoom(state, project) {
  [[0, 1, 2, 3], [0, 1, 5, 4], [1, 2, 6, 5]].forEach(face => {
    ctx.beginPath();
    face.forEach((index, point) => {
      const projected = project(roomVertices[index]);
      if (point === 0) ctx.moveTo(...projected);
      else ctx.lineTo(...projected);
    });
    ctx.closePath();
    ctx.fillStyle = `rgba(232, 237, 226, ${state.room * 0.018})`;
    ctx.fill();
  });
  boxEdges.forEach(([a, b]) => stroke(project(roomVertices[a]), project(roomVertices[b]), state.room * 0.18, 0.7));
  roomDetails.forEach(([a, b]) => stroke(project(a), project(b), state.room * 0.36, 0.9));
  for (let i = -3; i <= 3; i++) {
    stroke(project([-4.5, -1.6, i]), project([4.5, -1.6, i]), state.room * 0.07, 0.6);
    stroke(project([i, -1.6, -3.5]), project([i, -1.6, 3.5]), state.room * 0.07, 0.6);
  }
  getRoomLayout(state.layout).forEach(({ a, b }) => {
    stroke(project(a), project(b), 0.9, 1.4);
    const [x, y] = project(b);
    ctx.fillStyle = 'rgba(240, 245, 234, 0.9)';
    ctx.fillRect(x - 2, y - 2, 4, 4);
  });
}

function render() {
  framePending = false;
  const timeline = getScrollState(window.scrollY, scrollStops);
  const introState = renderIntro(timeline.introProgress);
  introTrack.dataset.playing = 'false';
  introTrack.dataset.stage = timeline.introProgress === 0 ? 'photo' : timeline.introProgress === 0.65 ? 'portrait'
    : timeline.introProgress === 1 ? 'research' : 'transition';
  portraitScrollHint.hidden = Math.abs(timeline.introProgress - 0.65) > 0.001;
  viewport.dataset.playing = 'false';
  viewport.setAttribute('aria-busy', 'false');
  viewport.dataset.control = gesture?.held ? 'held' : userScrolling ? 'scroll' : 'idle';
  const state = getSceneState(timeline.sceneProgress);
  const chapter = Math.max(0, timeline.chapter);
  const { copy } = timeline;
  chapters.forEach(element => {
    const active = Number(element.dataset.chapter) === copy.chapter;
    const visible = active && copy.opacity > 0;
    element.classList.toggle('is-active', active);
    element.inert = !visible;
    element.setAttribute('aria-hidden', String(!visible));
    element.style.opacity = active ? copy.opacity : '';
    element.style.visibility = active && !visible ? 'hidden' : '';
  });
  if (chapter !== activeChapter) {
    activeChapter = chapter;
    chapterButtons.forEach((button, index) => {
      button.classList.toggle('is-active', index === chapter);
      if (index === chapter) button.setAttribute('aria-current', 'step');
      else button.removeAttribute('aria-current');
    });
  }
  progressBar.style.transform = `scaleX(${timeline.sceneProgress})`;
  progressValue.textContent = String(Math.round(timeline.sceneProgress * 100)).padStart(2, '0');
  scrollInstruction.textContent = gesture?.held ? 'SCROLL AGAIN TO CONTINUE' : 'SCROLL TO CONTINUE';
  if (actionLabel.textContent !== state.actionLabel) {
    actionLabel.hidden = !state.actionLabel;
    actionLabel.textContent = state.actionLabel;
  }
  vlmUi.hidden = !state.vlm;
  vlmUi.classList.toggle('is-efficient', !!state.efficient);
  if (state.vlm) {
    const { vlm } = state;
    const entry = state.efficient?.intro ?? 0;
    vlmUi.style.setProperty('--comparison-entry', entry);
    standardLabel.hidden = vlm.model === 0;
    efficientLabel.hidden = !state.efficient || entry === 0;
    efficientLabel.style.opacity = entry;
    efficientInput.hidden = !state.efficient || state.efficient.progress < 0.12 || state.efficient.progress >= 0.85;
    vlmAnswer.style.opacity = state.efficient && state.efficient.progress < 0.12 ? 1 - entry : 1;
    const question = vlmQuestionText.slice(0, Math.floor(vlm.question * vlmQuestionText.length));
    questionLetters.textContent = question;
    vlmQuestion.hidden = question.length === 0;
    vlmQuestion.classList.toggle('is-typing', vlm.question > 0 && vlm.question < 1);
    vlmModel.hidden = state.vlm.model === 0;
    vlmModel.style.opacity = state.vlm.model;
    vlmModel.style.setProperty('--processed', state.vlm.processed);
    vlmModel.classList.toggle('is-processed', state.vlm.processed === 1);
    const answer = vlmAnswerText.slice(0, Math.floor(vlm.answer * vlmAnswerText.length));
    answerLetters.textContent = answer;
    vlmAnswer.hidden = answer.length === 0;
    vlmAnswer.style.setProperty('--reveal', vlm.answer);
    vlmAnswer.classList.toggle('is-typing', vlm.answer > 0 && vlm.answer < 1);
    const announcement = vlm.answer === 1 ? vlmAnswerText : '';
    if (answerStatus.textContent !== announcement) answerStatus.textContent = announcement;
    drawVlm(state);
  } else {
    answerStatus.textContent = '';
    drawScene(state, introState.morph);
    if (introState.morph > 0 && introState.morph < 1) drawPortraitMorph(introState.morph);
  }
}

function clearScene() {
  ctx.save();
  ctx.resetTransform();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
}

function drawVlm(state) {
  const { vlm } = state;
  // Prepare only visible patches before drawing the live scene, which replaces the capture.
  for (const index of getVisibleFrameIndices(state)) {
    if (!sampledFrames[index]) {
      drawScene(getActionSceneState(vlmFrameSamples[index]));
      const frame = document.createElement('canvas');
      frame.width = Math.ceil(width);
      frame.height = Math.ceil(height);
      const frameContext = frame.getContext('2d');
      if (!frameContext) throw new Error('Unable to create the video frame renderer.');
      frameContext.drawImage(canvas, 0, 0, frame.width, frame.height);
      sampledFrames[index] = frame;
    }
  }
  drawScene(state);
  const capture = { x: width * 0.13, y: height * 0.27, width: width * 0.74, height: height * 0.36 };
  const entry = state.efficient?.intro ?? 0;
  const captureY = capture.y - height * 0.06 * entry;
  const flashes = state.efficient ? [state.efficient.flash] : vlm.flashes;
  flashes.forEach(flash => {
    if (flash === 0) return;
    ctx.save();
    // Low-contrast exposure pulses are confined to the sampled region, never the whole viewport.
    ctx.fillStyle = `rgba(232,237,226,${reducedMotion.matches ? 0 : flash * 0.055})`;
    ctx.fillRect(capture.x, captureY, capture.width, capture.height);
    const length = Math.min(width, height) * 0.04;
    for (const x of [capture.x, capture.x + capture.width]) {
      for (const y of [captureY, captureY + capture.height]) {
        stroke([x, y], [x + (x === capture.x ? length : -length), y], flash * 0.7);
        stroke([x, y], [x, y + (y === captureY ? length : -length)], flash * 0.7);
      }
    }
    ctx.restore();
  });

  const questionBounds = questionLetters.getBoundingClientRect();
  const canvasBounds = canvas.getBoundingClientRect();
  const questionStyle = getComputedStyle(vlmQuestion);
  ctx.font = `${questionStyle.fontWeight} ${questionStyle.fontSize} ${questionStyle.fontFamily}`;
  const questionStart = width / 2 - ctx.measureText(vlmQuestionText).width / 2;
  let wordOffset = 0;
  let collected = 0;
  for (let index = 0; index < vlmTokenCount; index++) {
    const word = vlmQuestionWords[index];
    const wordWidth = word ? ctx.measureText(word).width : 0;
    const origin = word ? [questionStart + ctx.measureText(vlmQuestionText.slice(0, wordOffset)).width + wordWidth / 2,
      questionBounds.top - canvasBounds.top + questionBounds.height / 2] : undefined;
    if (word) wordOffset += word.length + 1;
    const token = getVlmTokenPosition(index, vlm.progress, width, height, origin);
    const { x, size, opacity, text, frame, cell, collect } = token;
    const y = token.y - height * 0.05 * entry;
    collected += collect;
    if (opacity === 0 || collect === 1) continue;
    ctx.save();
    ctx.globalAlpha = opacity;
    const tokenWidth = lerp(text ? wordWidth + 8 : capture.width / 5, size, collect);
    const tokenHeight = lerp(text ? parseFloat(questionStyle.fontSize) + 6 : capture.height / 4, size, collect);
    if (text) {
      ctx.fillStyle = `rgba(239,239,235,${1 - collect})`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(word, x, y);
    } else if (collect < 1) {
      const image = sampledFrames[frame];
      ctx.globalAlpha = opacity * (1 - collect);
      ctx.drawImage(image, image.width * (0.13 + cell % 5 * 0.148), image.height * (0.27 + Math.floor(cell / 5) * 0.09),
        image.width * 0.148, image.height * 0.09, x - tokenWidth / 2, y - tokenHeight / 2, tokenWidth, tokenHeight);
      ctx.globalAlpha = opacity;
    }
    ctx.fillStyle = `rgba(232,237,226,${collect * (text ? 0.9 : 0.22 + (cell % 4) * 0.12)})`;
    ctx.strokeStyle = `rgba(232,237,226,${text ? 1 : 0.65})`;
    ctx.lineWidth = lerp(0.65, size * 0.25, collect);
    ctx.fillRect(x - tokenWidth / 2, y - tokenHeight / 2, tokenWidth, tokenHeight);
    ctx.strokeRect(x - tokenWidth / 2, y - tokenHeight / 2, tokenWidth, tokenHeight);
    ctx.restore();
  }
  drawBudgetRow(standardTokenBudget, collected / vlmTokenCount, height * (0.70 - 0.05 * entry),
    index => state.efficient ? 1 : getVlmToken(index, vlm.progress).travel, vlmTokenCount);
  if (state.efficient) drawEfficientTokens(state, capture);
  if (vlm.model > 0) {
    const modelY = height * lerp(0.80, 0.85, entry);
    const modelRight = width / 2 + vlmModel.offsetWidth / 2;
    stroke([width * 0.92, height * lerp(0.70, 0.75, entry)], [width * 0.92, modelY], vlm.model * 0.4, 0.8);
    stroke([width * 0.92, modelY], [modelRight, modelY], vlm.model * 0.4, 0.8);
    stroke([modelRight + 4, modelY - 3], [modelRight, modelY], vlm.model * 0.6, 0.8);
    stroke([modelRight + 4, modelY + 3], [modelRight, modelY], vlm.model * 0.6, 0.8);
    if (vlm.answer > 0) {
      const { project, scale } = getSceneProjection(state, width, height);
      const point = project([state.objectTranslation[0], 0.51, state.objectTranslation[2]]);
      ctx.beginPath();
      ctx.ellipse(...point, scale * 0.83, scale * 0.22, 0, 0, Math.PI * 2 * vlm.answer);
      ctx.strokeStyle = 'rgba(232,237,226,0.7)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
}

function drawBudgetRow(budget, collected, y, travelForIndex, sourceCount) {
  const row = getTokenBudgetRow(budget, width);
  row.forEach(({ x, size, weight }, index) => {
    const filled = clamp(collected * budget / tokensPerSquare - index, 0, weight);
    if (filled === 0) return;
    ctx.fillStyle = 'rgba(232,237,226,0.6)';
    ctx.fillRect(x - size / 2, y - size / 2, size * filled, size);
    ctx.strokeStyle = 'rgba(232,237,226,0.85)';
    ctx.lineWidth = Math.min(0.7, size * 0.18);
    ctx.strokeRect(x - size / 2, y - size / 2, size, size);
    const sourceIndex = Math.round(index / (row.length - 1) * (sourceCount - 1));
    drawTokenFlight(x, y, size, travelForIndex(sourceIndex), weight);
  });
}

function drawTokenFlight(x, y, size, travel, weight = 1) {
  if (travel <= 0 || travel >= 1) return;
  const destination = lerp(x, width * 0.92, travel);
  ctx.fillStyle = `rgba(239,239,235,${Math.sin(travel * Math.PI) * 0.8})`;
  ctx.fillRect(destination - size / 2, y - size / 2, size * weight, size);
}

function drawEfficientTrajectory(state) {
  const { points, origins, tangent, opacity, lineWidth } = getEfficientTrajectory(state, width, height);
  if (points.length < 2 || opacity === 0) return origins;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  points.forEach(({ position }, i) => i === 0 ? ctx.moveTo(...position) : ctx.lineTo(...position));
  ctx.globalAlpha = opacity * 0.9;
  ctx.strokeStyle = '#080909';
  ctx.lineWidth = lineWidth + 5;
  ctx.stroke();
  ctx.globalAlpha = opacity * 0.24;
  ctx.strokeStyle = '#efefeb';
  ctx.shadowColor = '#efefeb';
  ctx.shadowBlur = 8;
  ctx.lineWidth = lineWidth + 2;
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.globalAlpha = opacity;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
  const first = points[0].position;
  const head = points.at(-1).position;
  const angle = Math.atan2(tangent[1], tangent[0]);
  ctx.beginPath();
  ctx.arc(...first, lineWidth + 1.5, 0, Math.PI * 2);
  ctx.fillStyle = '#080909';
  ctx.fill();
  ctx.strokeStyle = '#efefeb';
  ctx.lineWidth = 1.8;
  ctx.stroke();
  const headColor = [239, 239, 235];
  ctx.beginPath();
  ctx.arc(...head, lineWidth + 0.5, 0, Math.PI * 2);
  ctx.fillStyle = `rgb(${headColor.join(',')})`;
  ctx.fill();
  const arrowSize = clamp(width * 0.014, 5, 8);
  for (const side of [-1, 1]) {
    stroke(head, [head[0] - Math.cos(angle + side * 0.55) * arrowSize,
      head[1] - Math.sin(angle + side * 0.55) * arrowSize], 1, 2, [], headColor);
  }
  ctx.restore();
  return origins;
}

function drawEfficientTokens(state, capture) {
  const { efficient } = state;
  const motionOrigins = drawEfficientTrajectory(state);
  let collected = 0;
  for (let index = 0; index < efficientTokenCount; index++) {
    const token = getEfficientTokenPosition(index, efficient.progress, width, height, motionOrigins[index - 26]);
    const { x, y, size, opacity, collect, text, motion, cell } = token;
    collected += collect;
    if (opacity === 0 || collect === 1) continue;
    const w = lerp(text ? size : motion ? 10 : capture.width / 5, size, collect);
    const h = lerp(text ? size : motion ? 10 : capture.height / 4, size, collect);
    ctx.save();
    ctx.globalAlpha = opacity;
    if (!text && !motion && collect < 1) {
      const image = sampledFrames[vlmFrameSamples.length - 1];
      ctx.globalAlpha *= 1 - collect;
      ctx.drawImage(image, image.width * (0.13 + cell % 5 * 0.148), image.height * (0.27 + Math.floor(cell / 5) * 0.09),
        image.width * 0.148, image.height * 0.09, x - w / 2, y - h / 2, w, h);
      ctx.globalAlpha = opacity;
    }
    const color = [232, 237, 226];
    ctx.fillStyle = `rgba(${color.join(',')},${text ? 0.9 : motion ? 0.85 : 0.4 * collect})`;
    ctx.strokeStyle = `rgba(${color.join(',')},0.8)`;
    ctx.lineWidth = lerp(0.65, size * 0.25, collect);
    ctx.fillRect(x - w / 2, y - h / 2, w, h);
    ctx.strokeRect(x - w / 2, y - h / 2, w, h);
    if (motion && collect < 1) stroke([x - w / 3, y + h / 3], [x + w / 3, y - h / 3], 1 - collect, 1);
    ctx.restore();
  }
  drawBudgetRow(efficientTokenBudget, collected / efficientTokenCount, height * 0.75,
    index => getEfficientTokenPosition(index, efficient.progress, width, height, [0, 0]).travel, efficientTokenCount);
}

function drawLampPullHand(state) {
  if (!state.lampPull.visible) return;
  const hand = getLampPullHand(state, width, height);
  const project = createProjector(state.yaw, state.pitch, hand.scale, ...hand.offset, state.cameraDistance);
  drawHand({ ...hand, opacity: 1 }, project, hand.scale);
}

function drawScene(state, formation = 1) {
  const { light, collapse, recovery } = state;
  const { scale, cx, cy, project } = getSceneProjection(state, width, height);
  const transform = createObjectTransform(state);
  const projectObject = point => project(transform(point));
  const wirePaths = formation < 1 ? [] : groupSceneWires(getSceneWires(state, width, height, duck));
  const drawWires = kind => {
    if (formation < 1) return;
    for (const path of wirePaths.filter(path => path.kind === kind)) {
      ctx.beginPath();
      ctx.strokeStyle = `rgba(${path.color.join(',')},${path.alpha})`;
      ctx.lineWidth = path.lineWidth;
      path.points.forEach((point, i) => i === 0 ? ctx.moveTo(...point) : ctx.lineTo(...point));
      ctx.stroke();
    }
  };
  clearScene();

  drawWires('ground');
  const illumination = smoothstep(0.96, 1, formation);
  const origin = project([0, -1.59, 0]);
  const shadow = ctx.createRadialGradient(...origin, 0, ...origin, scale * 1.8 * illumination);
  shadow.addColorStop(0, 'rgba(198, 208, 184, 0.035)');
  shadow.addColorStop(1, 'rgba(198, 208, 184, 0)');
  ctx.fillStyle = shadow;
  ctx.fillRect(0, 0, width, height);
  if (state.room > 0 && state.roomOpacity > 0) {
    ctx.save();
    ctx.globalAlpha = state.roomOpacity;
    drawRoom(state, project);
    ctx.restore();
  }
  if (state.desk > 0) {
    desk.forEach(({ a, b, strength }) => stroke(project(a), project(b), strength * state.desk, 0.9));
  }

  if (state.lampOpacity > 0) {
    ctx.save();
    ctx.globalAlpha = state.lampOpacity;
    const { x: lx, y: ly, shade, bulb, beam: beamPoints } = getLampGeometry(state, width, height);
    if (light > 0 && illumination > 0) {
      const beam = ctx.createLinearGradient(lx, ly, cx + scale, cy + scale * 1.6);
      beam.addColorStop(0, `rgba(244, 243, 217, ${light * 0.23})`);
      beam.addColorStop(1, 'rgba(244, 243, 217, 0)');
      ctx.fillStyle = beam;
      ctx.beginPath();
      const grow = point => [lerp(lx, point[0], illumination), lerp(ly, point[1], illumination)];
      ctx.moveTo(...beamPoints[0]);
      ctx.lineTo(...grow(beamPoints[1]));
      ctx.quadraticCurveTo(...grow(beamPoints[2]), ...grow(beamPoints[3]));
      ctx.lineTo(...beamPoints[4]);
      ctx.closePath();
      ctx.fill();
    }
    if (formation === 1) {
      ctx.beginPath();
      shade.forEach((point, i) => i === 0 ? ctx.moveTo(...point) : ctx.lineTo(...point));
      ctx.closePath();
      ctx.fillStyle = '#080909';
      ctx.fill();
    }
    if (light > 0 && illumination > 0) {
      ctx.beginPath();
      bulb.forEach((point, i) => {
        const position = [lerp(lx, point[0], illumination), lerp(ly, point[1], illumination)];
        if (i === 0) ctx.moveTo(...position);
        else ctx.lineTo(...position);
      });
      ctx.fillStyle = `rgba(244, 243, 217, ${light * 0.85})`;
      ctx.fill();
    }
    ctx.restore();
    drawWires('beam');
    drawWires('lamp');
    drawWires('cord');
    if (formation === 1) drawLampPullHand(state);
  }

  drawWires('duck');

  if (state.box > 0 && state.debrisOpacity > 0) {
    boxEdges.forEach(([a, b], index) => {
      const amount = clamp(state.box * 2 - index / 12);
      if (!amount) return;
      const endpoints = collapse > 0 ? fallingEdge(index, collapse) : [boxVertices[a], boxVertices[b]];
      const start = project(endpoints[0]);
      const end = project(endpoints[1]);
      const alpha = (collapse > 0 ? lerp(0.7, 0.28, collapse) : 0.7) * state.debrisOpacity;
      stroke(start, start.map((v, axis) => lerp(v, end[axis], amount)), alpha, 0.9, [4, 3]);
    });
    if (collapse === 0) {
      boxVertices.forEach(vertex => {
        const [x, y] = project(vertex);
        ctx.fillStyle = `rgba(235, 240, 229, ${state.box * 0.85})`;
        ctx.fillRect(x - 2, y - 2, 4, 4);
      });
    }
  }
  if (recovery > 0) {
    const { edges, scanY } = getRecoveryGeometry(recovery);
    edges.forEach(({ a, b }) => stroke(projectObject(a), projectObject(b), lerp(0.95, 0.5, state.layout), 1.5));
    if (recovery < 1) {
      const scanCorners = boxVertices.slice(0, 4).map(([x, , z]) => projectObject([x, scanY, z]));
      scanCorners.forEach((point, index) => stroke(point, scanCorners[(index + 1) % 4], 0.6, 0.8, [2, 4]));
    }
    boxVertices.forEach(vertex => {
      if (vertex[1] > scanY || (vertex[1] > 0 && recovery < 1)) return;
      const [x, y] = projectObject(vertex);
      ctx.strokeStyle = 'rgba(240, 245, 234, 0.95)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x - 3, y - 3, 6, 6);
    });
  }
  if (state.handOpacity > 0) {
    drawHand({ joints: getHandJoints(state), forearm: getHandForearm(state), opacity: state.handOpacity }, project, scale);
  }
}

function requestRender() {
  if (!framePending) {
    framePending = true;
    requestAnimationFrame(render);
  }
}

function resize() {
  const bounds = canvas.getBoundingClientRect();
  width = bounds.width;
  height = bounds.height;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  sampledFrames = [];
  morphPairs = null;
  requestRender();
}

new ResizeObserver(resize).observe(canvas);
new ResizeObserver(layoutIntro).observe(intro);
reducedMotion.addEventListener('change', resetScrollGesture);
window.addEventListener('scroll', handleStoryScroll, { passive: true });
window.addEventListener('resize', layoutIntro);
function restoreLocation(event) {
  resetScrollGesture();
  if (location.hash === '#contact') {
    scrollToContact();
  } else if (location.hash === '#top' || (event.type === 'hashchange' && !location.hash)) {
    writeScroll(0);
  } else if (location.hash === '#research') {
    goToChapter(1);
  } else {
    const anchor = document.getElementById(location.hash.slice(1));
    if (anchor?.classList.contains('scroll-anchor')) {
      goToChapter(Number(anchor.dataset.chapter));
    } else if (location.hash === '#story-end') {
      scrollToBoundary(true);
    }
  }
  requestRender();
}
window.addEventListener('hashchange', restoreLocation);
window.addEventListener('pageshow', event => requestAnimationFrame(() => restoreLocation(event)));
layoutIntro();
resize();
