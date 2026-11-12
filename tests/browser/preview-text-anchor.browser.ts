import { test, expect } from '@playwright/test';
import { bundlePlayPage, htmlPlayPage } from '../../server/play.ts';
import type { AssetDetail } from '../../shared/types.ts';

test.use({ viewport: { width: 1600, height: 1100 }, deviceScaleFactor: 1.25 });

for (const bundled of [false, true]) {
  for (const scale of ['fit', '54']) {
    test(`${bundled ? 'bundled' : 'html'} changing content height keeps header text stationary at ${scale}`, async ({ page }, info) => {
      const markup = '<section id="fixture"><header>OPEN COLLECTION <span>No. 01 / ART</span></header><button id="toggle">Toggle layout</button></section>';
      const style = '#fixture{width:1040px;height:600px;background:#fff;border:1px solid #ddd;box-sizing:border-box;padding:28px;font:14px/1.4 Arial}header{display:flex;justify-content:space-between}header span{font:10px/1.4 monospace}button{margin-top:24px}';
      const script = 'let tall=false;document.querySelector("#toggle").onclick=()=>{tall=!tall;const el=document.querySelector("#fixture");el.animate([{height:getComputedStyle(el).height},{height:tall?"850px":"600px"}],{duration:900,fill:"forwards",easing:"ease-in-out"})};';
      const files = [
        { path: 'markup.html', content: markup },
        { path: 'style.css', content: style },
        { path: 'script.js', content: script },
      ];
      const asset: AssetDetail = {
        id: 'text-anchor', title: 'Text anchor', type: 'component', categoryId: null,
        sourceName: '', sourceUrl: '', favorite: false, cover: null, createdAt: '', updatedAt: '',
        tags: [], frameworks: ['html'], locales: ['en'], titles: {}, texts: {}, media: [],
        variants: [{ framework: 'html', entry: 'markup.html', dependencies: {}, files }],
      };
      const playback = bundled
        ? bundlePlayPage(asset.title, `document.head.insertAdjacentHTML('beforeend',${JSON.stringify(`<style>${style}</style>`)});document.querySelector('#root').innerHTML=${JSON.stringify(markup)};${script}`, null)
        : htmlPlayPage(asset.title, files);
      await page.route('**/api/library', route => route.fulfill({ json: { libraryId: 'anchor', path: 'anchor', assetCount: 1 } }));
      await page.route(/\/api\/(tags|categories)$/, route => route.fulfill({ json: [] }));
      await page.route('**/api/assets/text-anchor', route => route.fulfill({ json: asset }));
      await page.route('**/play/text-anchor/**', route => route.fulfill({ contentType: 'text/html', body: playback }));
      await page.goto('/a/text-anchor');
      await expect(page.locator('.stage-host')).toHaveAttribute('aria-busy', 'false');
      const frame = page.frameLocator('iframe');
      if (scale !== 'fit') {
        await page.getByRole('spinbutton', { name: '缩放比例', exact: true }).fill(scale);
        await page.getByRole('spinbutton', { name: '缩放比例', exact: true }).press('Enter');
      }
      const header = frame.locator('header');
      const rect = (await header.boundingBox())!;
      const clip = { x: Math.floor(rect.x), y: Math.floor(rect.y) - 3, width: Math.ceil(rect.width), height: Math.ceil(rect.height) + 6 };
      const baseline = await page.screenshot({ clip });
      await frame.locator('#fixture').evaluate(element => {
        const samples: { y: number; height: number }[] = [];
        (window as unknown as { anchorSamples: typeof samples }).anchorSamples = samples;
        const end = performance.now() + 3500;
        const sample = () => {
          samples.push({ y: element.querySelector('header')!.getBoundingClientRect().y, height: element.getBoundingClientRect().height });
          if (performance.now() < end) requestAnimationFrame(sample);
        };
        sample();
      });
      for (const target of [850, 600]) {
        await frame.getByRole('button', { name: 'Toggle layout', exact: true }).click();
        for (let i = 0; i < 5; i++) {
          const pixels = await page.screenshot({ clip });
          if (!pixels.equals(baseline)) {
            await info.attach('header-before', { body: baseline, contentType: 'image/png' });
            await info.attach('header-during', { body: pixels, contentType: 'image/png' });
          }
          expect(pixels.equals(baseline), 'header pixels must stay unchanged while the content below animates').toBe(true);
        }
        await expect.poll(() => frame.locator('#fixture').evaluate(element => Math.round(element.getBoundingClientRect().height))).toBe(target);
      }
      const samples = await frame.locator('#fixture').evaluate(() => (window as unknown as {
        anchorSamples: { y: number; height: number }[];
      }).anchorSamples);
      expect(samples.length).toBeGreaterThan(20);
      expect(Math.max(...samples.map(s => s.height)) - Math.min(...samples.map(s => s.height))).toBeGreaterThan(240);
      expect(Math.max(...samples.map(s => s.y)) - Math.min(...samples.map(s => s.y))).toBeLessThan(0.02);
    });
  }
}
