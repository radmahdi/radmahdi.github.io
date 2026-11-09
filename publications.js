const diagrams = {
  pose: [
    'M38 31 68 18 98 32 68 47Z M38 31V66L68 81 98 66V32 M68 47V81',
    'M38 66 68 51 98 66 M68 18V51',
    'M68 51H119 M113 47 119 51 113 55 M68 51V5 M64 11 68 5 72 11 M68 51 17 77 M19 70 17 77 25 77',
    'M48 38 68 29 88 39V60L68 70 48 60Z M48 38 68 49 88 39 M68 49V70',
  ],
  lighting: [
    'M74 6V22 M63 22H85L96 37H52Z',
    'M57 42 23 81 M91 42 125 81 M74 43V58',
    'M47 64 68 54 89 64 68 75Z M47 64V82L68 92 89 82V64 M68 75V92',
    'M18 88H41 M96 88H133 M30 62 35 54 M111 54 116 62',
  ],
  interaction: [
    'M17 61H34C42 61 45 53 52 53C58 53 63 60 69 60H81C90 60 90 70 81 70H63 M88 66 108 51C114 47 119 53 113 58L93 77C89 81 84 83 77 84L55 87C47 88 42 81 34 81H17',
    'M89 62 103 47C107 43 112 46 111 50 M86 60 96 47C99 43 103 44 104 47 M82 60 89 49C92 45 96 46 96 48',
    'M63 27 83 17 103 27 83 38Z M63 27V48L83 58 103 48V27 M83 38V58',
    'M28 61V81 M31 61V81 M48 66C50 73 55 77 62 78 M78 70C82 72 86 72 90 70',
  ],
  layout: [
    'M23 27 75 10 126 27V75L75 94 23 75Z M75 10V59 M23 75 75 59 126 75',
    'M23 27 75 45 126 27 M75 45V94',
    'M38 71V51L62 43V63 M38 51 48 55V75 M48 55 72 47V67 M62 43 72 47',
    'M92 37V56L113 63V44Z M34 79 85 63 M49 84 100 68 M90 88 38 70 M107 82 56 65',
  ],
  actions: [
    'M15 67 34 57 53 67 34 77Z M15 67V84 M53 67V84 M34 77V94',
    'M30 33C30 24 42 24 42 33S30 42 30 33 M36 42V57L25 68 M36 57 45 67 M36 46 49 50 58 42',
    'M71 30C71 21 83 21 83 30S71 39 71 30 M77 39V55L67 69 M77 55 87 67 M77 43 89 38 96 24',
    'M110 33C110 24 122 24 122 33S110 42 110 33 M116 42V57L106 71 M116 57 128 70 M116 46 130 50 137 42',
    'M19 17C47 4 95 4 128 16 M122 10 128 16 120 18',
  ],
  spatial: [
    'M12 26H50V56H12Z M18 50 29 37 37 45 44 34 M18 20H56V50',
    'M68 36 91 25 114 36 91 47Z M68 36V65L91 77 114 65V36 M91 47V77',
    'M68 65 91 54 114 65 M91 25V54 M50 41H62 M58 37 62 41 58 45',
    'M108 8H143V27H133L125 34V27H108Z M116 15H135 M116 21H128',
    'M91 77V91H133 M127 87 133 91 127 95',
  ],
  efficient: [
    'M12 19H22V29H12Z M28 19H38V29H28Z M44 19H54V29H44Z M12 35H22V45H12Z M28 35H38V45H28Z M44 35H54V45H44Z M12 51H22V61H12Z M28 51H38V61H28Z M44 51H54V61H44Z',
    'M64 22 86 40 64 58 M73 40H112 M106 36 112 40 106 44',
    'M121 26H136V41H121Z M121 48H136V63H121Z',
    'M17 86C40 86 43 73 64 77S94 93 132 77 M125 75 132 77 128 84',
  ],
};

const svgNamespace = 'http://www.w3.org/2000/svg';
const groups = document.querySelectorAll('.publication-group');
for (const group of groups) {
  const paths = diagrams[group.id];
  if (!paths) throw new Error(`Missing publication illustration: ${group.id}`);
  const illustration = document.createElementNS(svgNamespace, 'svg');
  illustration.setAttribute('viewBox', '0 0 150 104');
  illustration.setAttribute('aria-hidden', 'true');
  illustration.setAttribute('focusable', 'false');
  illustration.classList.add('publication-sketch');
  paths.forEach((data, index) => {
    const path = document.createElementNS(svgNamespace, 'path');
    path.setAttribute('d', data);
    path.setAttribute('pathLength', '1');
    path.style.setProperty('--stroke-delay', `${index * 110}ms`);
    illustration.append(path);
  });
  group.prepend(illustration);
}

// Only decorative strokes animate; papers are always visible and usable.
const observer = new IntersectionObserver(entries => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    entry.target.classList.add('sketch-revealed');
    observer.unobserve(entry.target);
  }
}, { threshold: 0.6 });
for (const sketch of document.querySelectorAll('.publication-sketch')) observer.observe(sketch);
