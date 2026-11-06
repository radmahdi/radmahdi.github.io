(() => {
  try {
    if (localStorage.getItem('portfolio-theme') === 'light') {
      document.documentElement.dataset.theme = 'light';
      document.querySelector('meta[name="theme-color"]').content = '#f7f6f6';
    }
  } catch (error) {
    console.warn('Unable to restore the saved theme.', error);
  }

  document.addEventListener('DOMContentLoaded', () => {
    const toggle = document.querySelector('#theme-toggle');
    const update = () => {
      const light = document.documentElement.dataset.theme === 'light';
      toggle.setAttribute('aria-pressed', String(light));
      toggle.title = light ? 'Switch to dark mode' : 'Switch to light mode';
      document.querySelector('meta[name="theme-color"]').content = light ? '#f7f6f6' : '#080909';
    };
    toggle.hidden = false;
    update();
    toggle.addEventListener('click', () => {
      const theme = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
      document.documentElement.dataset.theme = theme;
      update();
      document.dispatchEvent(new Event('themechange'));
      try {
        localStorage.setItem('portfolio-theme', theme);
      } catch (error) {
        console.warn('Unable to save the theme preference.', error);
      }
    });
  });
})();
