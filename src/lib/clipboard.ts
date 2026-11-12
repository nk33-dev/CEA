export async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // 部分浏览器拒绝异步剪贴板，仍可在点击事件里使用复制命令。
    }
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  const focused = document.activeElement as HTMLElement | null;
  document.body.append(area);
  try {
    area.select();
    if (!document.execCommand('copy')) throw new Error('copy failed');
  } finally {
    area.remove();
    focused?.focus({ preventScroll: true });
  }
}
