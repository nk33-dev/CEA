import { expect, test } from '@playwright/test';
import { bundlePlayPage, htmlPlayPage } from '../../server/play.ts';
import { mockLibrary, PNG } from './fixtures/mockLibrary.ts';
import { clickScaledFrame } from './fixtures/framePointer.ts';

for (const bundled of [false, true]) {
  test(`${bundled ? 'bundled' : 'html'} sandbox images support canvas interaction without changing component source`, async ({ page }) => {
    const { assets } = await mockLibrary(page);
    assets.delete('demo-b'); assets.delete('demo-c');
    const markup = '<section style="width:300px;height:260px;background:#fff"><img id="static" src="./resources/art.png"><button aria-expanded="false">Open image</button></section>';
    const script = `
      const button=document.querySelector('button');
      const dynamic=new Image();dynamic.src='./resources/art.png';
      const attribute=document.createElement('img');attribute.setAttribute('src','./resources/art.png');
      const holder=document.createElement('div');holder.innerHTML='<img src="./resources/art.png">';document.body.append(holder);
      const external=new Image();external.src='https://example.org/external.png';
      const explicit=new Image();explicit.crossOrigin='use-credentials';explicit.src='./resources/art.png';
      window.externalMode=external.crossOrigin;window.explicitMode=explicit.crossOrigin;
      button.onclick=async()=>{
        const images=[document.querySelector('#static'),dynamic,attribute,holder.firstChild];
        await Promise.all(images.map(image=>image.decode()));
        const canvas=document.createElement('canvas');canvas.width=canvas.height=1;
        const ctx=canvas.getContext('2d');
        for(const image of images){ctx.drawImage(image,0,0);ctx.getImageData(0,0,1,1);}
        button.setAttribute('aria-expanded',String(button.getAttribute('aria-expanded')!=='true'));
      };`;
    const playback = bundled
      ? bundlePlayPage('Images', `document.querySelector('#root').innerHTML=${JSON.stringify(markup)};${script}`, null)
      : htmlPlayPage('Images', [{ path: 'markup.html', content: markup }, { path: 'script.js', content: script }]);
    await page.route('**/play/**/resources/art.png', route => route.fulfill({ contentType: 'image/png', headers: { 'access-control-allow-origin': '*'}, body: PNG }));
    await page.route('https://example.org/**', route => route.fulfill({ contentType: 'image/png', body: PNG }));
    await page.route(/\/play\/demo-a\/html\/\?/, route => route.fulfill({ contentType: 'text/html', body: playback }));
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/');
    const card = page.locator('.card');
    await expect(card.locator('.fit-stage')).toHaveAttribute('data-display', 'true');
    const frame = card.frameLocator('iframe');
    await card.locator('.card-stage').hover();
    await expect(frame.locator('html')).not.toHaveAttribute('data-paused', '');
    for (const expanded of ['true', 'false', 'true']) {
      await clickScaledFrame(page, card.locator('iframe'), frame.getByRole('button', { name: 'Open image' }));
      await expect(frame.locator('button')).toHaveAttribute('aria-expanded', expanded);
    }
    expect(await frame.locator('#static').evaluate(image => (image as HTMLImageElement).crossOrigin)).toBe('anonymous');
    expect(await frame.locator('html').evaluate(() => ({ external: (window as unknown as { externalMode: string | null }).externalMode, explicit: (window as unknown as { explicitMode: string }).explicitMode }))).toEqual({ external: null, explicit: 'use-credentials' });
    expect(await card.locator('iframe').getAttribute('sandbox')).not.toContain('allow-same-origin');
    await expect(card.locator('.preview-failure')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}
