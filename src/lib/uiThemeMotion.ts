let enabled = false;
let deadline: ReturnType<typeof setTimeout> | undefined;

function finish() {
  clearTimeout(deadline);
  deadline = undefined;
  delete document.documentElement.dataset.uiThemeChanging;
}

export function applyUiTheme(theme: 'light' | 'dark') {
  const root = document.documentElement;
  if (root.dataset.uiTheme === theme) return;
  clearTimeout(deadline);
  if (!enabled || document.hidden || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    root.dataset.uiThemeChanging = 'instant';
    root.dataset.uiTheme = theme;
    void document.body.offsetHeight;
    finish();
    return;
  }
  root.dataset.uiThemeChanging = 'animated';
  root.dataset.uiTheme = theme;
  // 浏览器负责换色与反向续接；这里只在完成后恢复控件原有的悬停时长。
  deadline = setTimeout(finish, 220);
}

export function enableUiThemeMotion() {
  enabled = true;
  const root = document.documentElement;
  root.dataset.uiThemeMotion = 'ready';
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const interrupt = () => {
    if (reduced.matches || document.hidden) finish();
  };
  reduced.addEventListener('change', interrupt);
  document.addEventListener('visibilitychange', interrupt);
  return () => {
    enabled = false;
    finish();
    reduced.removeEventListener('change', interrupt);
    document.removeEventListener('visibilitychange', interrupt);
    delete root.dataset.uiThemeMotion;
  };
}
