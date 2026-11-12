import { test, expect } from '@playwright/test';

for (const scenario of [
  { width: 1986, height: 975, dpr: 1.25 },
  { width: 1440, height: 900, dpr: 1 },
]) {
  test.describe(`thumbnail ${scenario.width}px DPR ${scenario.dpr}`, () => {
    test.use({ viewport: { width: scenario.width, height: scenario.height }, deviceScaleFactor: scenario.dpr });
    test('opening a weather menu preserves the card and first visible menu frame', async ({ page }, info) => {
      await page.goto('/');
      const card = page.locator('[data-asset-id="weather-week-switcher"]');
      await expect(card.locator('.stage-host')).toHaveAttribute('aria-busy', 'false');
      const frame = card.frameLocator('iframe');
      const menu = frame.locator('.wx-weather-menu');
      await menu.evaluate(el => {
        el.addEventListener('beforetoggle', event => {
          if ((event as ToggleEvent).newState !== 'open') return;
          const samples: Record<string, number>[] = [];
          (window as unknown as { menuSamples: typeof samples }).menuSamples = samples;
          const sample = () => {
            const rect = el.getBoundingClientRect();
            samples.push({ x: rect.x, y: rect.y, width: rect.width, height: rect.height, opacity: Number(getComputedStyle(el).opacity) });
            if (samples.length < 35) requestAnimationFrame(sample);
          };
          requestAnimationFrame(sample);
        });
      });
      for (let cycle = 0; cycle < 3; cycle++) {
        await card.evaluate(el => {
          const samples: Record<string, number>[] = [];
          (window as unknown as { cardSamples: typeof samples }).cardSamples = samples;
          const sample = () => {
            const inner = el.querySelector('.fit-stage-inner')!;
            const rect = inner.getBoundingClientRect();
            const parents: Element[] = [];
            for (let node: Element | null = inner; node; node = node.parentElement) parents.push(node);
            samples.push({ x: rect.x, y: rect.y, width: rect.width, height: rect.height,
              scroll: parents.reduce((sum, node) => sum + Math.abs(node.scrollTop) + Math.abs(node.scrollLeft), 0) });
            if (samples.length < 60) requestAnimationFrame(sample);
          };
          sample();
        });
        await frame.getByRole('button', { name: '选择预览天气', exact: true }).click();
        await expect.poll(() => menu.evaluate(() => (window as unknown as { menuSamples: unknown[] }).menuSamples.length)).toBe(35);
        const menuSamples = await menu.evaluate(() => (window as unknown as { menuSamples: Record<string, number>[] }).menuSamples);
        const cardSamples = await page.evaluate(() => (window as unknown as { cardSamples: Record<string, number>[] }).cardSamples);
        await info.attach(`opening-${cycle}`, { body: JSON.stringify({ menuSamples, cardSamples }), contentType: 'application/json' });
        for (let i = 1; i < menuSamples.length; i++) expect(menuSamples[i].opacity).toBeGreaterThanOrEqual(menuSamples[i - 1].opacity - 0.001);
        for (const samples of [menuSamples, cardSamples]) for (const key of ['x', 'y', 'width', 'height']) {
          expect(Math.max(...samples.map(s => s[key])) - Math.min(...samples.map(s => s[key])), key).toBeLessThan(0.5);
        }
        expect(Math.max(...cardSamples.map(s => s.scroll)) - Math.min(...cardSamples.map(s => s.scroll))).toBeLessThan(0.5);
        await card.screenshot({ path: info.outputPath(`menu-${cycle}.png`) });
        if (cycle === 0) await menu.locator('[data-condition]').last().click();
        else await page.keyboard.press('Escape');
        await expect(menu).toBeHidden();
      }
    });
  });
}
