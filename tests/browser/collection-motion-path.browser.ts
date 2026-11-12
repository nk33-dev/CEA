import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 1550, height: 1000 }, deviceScaleFactor: 1.25 });

const cases = ['组件', '手机'].flatMap(mode => ['html', 'react', 'vue'].map(framework => ({ mode, framework })));
for (const { mode, framework } of cases) {
  test(`${framework} ${mode} artwork takes a continuous path between grid and list`, async ({ page }) => {
    await page.addInitScript(value => localStorage.setItem('cea:framework', value), framework);
    await page.goto('/a/collection-layout-switcher');
    await expect(page.locator('.stage-host')).toHaveAttribute('aria-busy', 'false');
    await page.getByRole('radio', { name: mode, exact: true }).check();
    const frame = page.frameLocator('iframe');
    const root = frame.locator('.cl');
    await expect(root).toBeVisible();

    for (const name of ['List view', 'Grid view']) {
      await root.evaluate(element => {
        const samples: { phase?: string; images: number[][] }[] = [];
        const capture = () => ({
          phase: (element as HTMLElement).dataset.phase,
          images: [...element.querySelectorAll('.cl-image')].map(image => {
            const rect = image.getBoundingClientRect();
            return [rect.x, rect.y, rect.width, rect.height];
          }),
        });
        const state = { samples, stop: false };
        (window as unknown as { motionPath: typeof state }).motionPath = state;
        const sample = () => {
          samples.push(capture());
          if (!state.stop) requestAnimationFrame(sample);
        };
        sample();
      });
      await frame.getByRole('button', { name, exact: true }).click();
      await expect(root).toHaveAttribute('data-phase', 'idle');
      const samples = await root.evaluate(async () => {
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const state = (window as unknown as {
          motionPath: { samples: { phase?: string; images: number[][] }[]; stop: boolean };
        }).motionPath;
        state.stop = true;
        return state.samples;
      });
      expect(samples.filter(sample => sample.phase === 'moving').length).toBeGreaterThan(10);
      const start = samples[0]!;
      const end = samples.at(-1)!;
      for (let image = 0; image < start.images.length; image++) {
        for (let axis = 0; axis < 4; axis++) {
          const first = start.images[image]![axis]!;
          const last = end.images[image]![axis]!;
          const values = samples.map(sample => sample.images[image]![axis]!);
          expect(Math.min(...values), `${name}, image ${image}, axis ${axis}: no backward overshoot`)
            .toBeGreaterThanOrEqual(Math.min(first, last) - 0.6);
          expect(Math.max(...values), `${name}, image ${image}, axis ${axis}: no forward overshoot`)
            .toBeLessThanOrEqual(Math.max(first, last) + 0.6);
          const direction = Math.sign(last - first);
          for (let index = 1; index < values.length; index++) {
            expect((values[index]! - values[index - 1]!) * direction,
              `${name}, image ${image}, axis ${axis}: no reversal`).toBeGreaterThanOrEqual(-0.6);
          }
        }
      }
    }

    await frame.getByRole('button', { name: 'List view', exact: true }).click();
    for (let interruption = 0; interruption < 4; interruption++) {
      await expect.poll(() => root.getAttribute('data-progress').then(Number)).toBeGreaterThan(0.25);
      const discontinuity = await root.evaluate(element => {
        const capture = () => [...element.querySelectorAll('.cl-image')].map(image => {
          const rect = image.getBoundingClientRect();
          return [rect.x, rect.y, rect.width, rect.height];
        });
        const before = capture();
        const next = (element as HTMLElement).dataset.view === 'grid' ? 'list' : 'grid';
        (element.querySelector(`[data-layout="${next}"]`) as HTMLButtonElement).click();
        const after = capture();
        return Math.max(...before.flatMap((rect, index) =>
          rect.map((value, axis) => Math.abs(value - after[index]![axis]!))));
      });
      expect(discontinuity, 'reversing mid-transition preserves every visible image rectangle').toBeLessThan(0.1);
    }
    await expect(root).toHaveAttribute('data-phase', 'idle');
    expect(await root.locator('[data-ghost-key]').count()).toBe(0);
    expect(await root.locator('.cl-artwork, .cl-image, .cl-info').evaluateAll(elements =>
      elements.every(element => !(element as HTMLElement).style.cssText))).toBe(true);
  });
}
