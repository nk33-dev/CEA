import { test, expect } from '@playwright/test';
import { htmlPlayPage } from '../../server/play.ts';

test('component framing ignores empty padding overflow but keeps real document and inner scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const html = htmlPlayPage('Content overflow', [
    { path: 'markup.html', content: '<main><button id="grow">Change height</button><div class="inner"><div class="long"></div></div></main>' },
    { path: 'style.css', content: 'main{width:800px;height:870px;background:#e4ecf4}.inner{height:70px;overflow:auto}.long{height:250px}' },
    { path: 'script.js', content: "document.querySelector('#grow').onclick=()=>{const el=document.querySelector('main');el.style.height=el.style.height==='1400px'?'870px':'1400px';};" },
  ]);
  await page.route('**/content-overflow*', route => route.fulfill({ contentType: 'text/html', body: html }));
  await page.goto('/content-overflow?framing=content');
  await expect(page.locator('html')).toHaveAttribute('data-content-fits', '');
  await expect(page.locator('html')).toHaveCSS('overflow-y', 'clip');
  expect(await page.locator('.inner').evaluate(el => { el.scrollTop = 80; return el.scrollTop; })).toBe(80);
  await page.getByRole('button', { name: 'Change height', exact: true }).click();
  await expect(page.locator('html')).not.toHaveAttribute('data-content-fits', '');
  await expect(page.locator('html')).not.toHaveCSS('overflow-y', 'clip');
  expect(await page.locator('html').evaluate(el => { el.scrollTop = 80; return el.scrollTop; })).toBe(80);
  await page.locator('html').evaluate(el => { el.scrollTop = 0; });
  await page.getByRole('button', { name: 'Change height', exact: true }).click();
  await expect(page.locator('html')).toHaveCSS('overflow-y', 'clip');
  await page.goto('/content-overflow?framing=device');
  await expect(page.locator('html')).not.toHaveCSS('overflow-y', 'clip');
});
