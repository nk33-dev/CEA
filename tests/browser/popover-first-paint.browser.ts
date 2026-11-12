import { test, expect } from '@playwright/test';
import { htmlPlayPage } from '../../server/play.ts';

test('a constrained popover is fitted before its first visible frame', async ({ page }) => {
  const preview = htmlPlayPage('Overlay fixture', [
    { path: 'markup.html', content: '<button popovertarget="menu">Open</button><div id="menu" popover><button popovertarget="menu" popovertargetaction="hide">Close</button><p>Menu</p></div>' },
    { path: 'style.css', content: '#menu{width:320px;height:420px;padding:12px;box-sizing:border-box}#menu p{height:800px}' },
  ]);
  await page.route('**/overlay-frame*', route => route.fulfill({ contentType: 'text/html', body: preview }));
  await page.route('**/overlay-host', route => route.fulfill({
    contentType: 'text/html',
    body: `<!doctype html><style>body{margin:0}.frame{width:360px;height:180px;overflow:clip}iframe{width:720px;height:540px;border:0;transform:scale(.5);transform-origin:0 0}</style>
      <script>addEventListener('message',event=>{if(event.data?.type==='cea:ready')event.source.postMessage({type:'cea:visible-area',value:{x:0,y:0,width:720,height:360}},'*')})</script>
      <div class="frame"><iframe title="fixture" sandbox="allow-scripts" src="/overlay-frame?active=1"></iframe></div>`,
  }));
  await page.goto('/overlay-host');
  const frame = page.frameLocator('iframe');
  const menu = frame.locator('#menu');
  await menu.evaluate(el => {
    el.addEventListener('beforetoggle', event => {
      if ((event as ToggleEvent).newState !== 'open') return;
      const frames: { y: number; height: number }[] = [];
      (window as unknown as { opening: typeof frames }).opening = frames;
      const sample = () => {
        const box = el.getBoundingClientRect();
        frames.push({ y: box.y, height: box.height });
        if (frames.length < 20) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
  });
  for (let attempt = 0; attempt < 3; attempt++) {
    await frame.getByRole('button', { name: 'Open', exact: true }).click();
    await expect.poll(() => menu.evaluate(() => (window as unknown as { opening: unknown[] }).opening.length)).toBe(20);
    const frames = await menu.evaluate(() => (window as unknown as { opening: { y: number; height: number }[] }).opening);
    expect(Math.max(...frames.map(f => f.y)) - Math.min(...frames.map(f => f.y))).toBeLessThan(0.5);
    expect(Math.max(...frames.map(f => f.height)) - Math.min(...frames.map(f => f.height))).toBeLessThan(0.5);
    expect(frames[0].y).toBeGreaterThanOrEqual(8);
    expect(frames[0].y + frames[0].height).toBeLessThanOrEqual(352.5);
    expect(await menu.evaluate(el => {
      el.scrollTop = el.scrollHeight;
      return el.scrollTop;
    })).toBeGreaterThan(0);
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    expect(await menu.getAttribute('style')).toBe('');
  }
});
