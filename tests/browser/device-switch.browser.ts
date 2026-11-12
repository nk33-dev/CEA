import { test, expect } from '@playwright/test';

for (const id of ['leetcode-heatmap', 'weather-forecast-detail']) {
  test(`${id} switches device without intermediate resizing or stacked fades`, async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('cea:framework', 'vue'));
    await page.goto(`/a/${id}`);
    await expect(page.locator('.stage-host')).toHaveAttribute('aria-busy', 'false');
    const frame = page.frameLocator('iframe');
    await page.locator('iframe').evaluate(element => element.setAttribute('data-session', 'preserved'));
    await page.getByRole('radio', { name: '电脑', exact: true }).check();
    for (const device of ['手机', '电脑', '手机']) {
      await frame.locator('html').evaluate(() => {
        const samples: { width: number; client: number; content: number; device: string | undefined }[] = [];
        (window as unknown as { switchSamples: typeof samples }).switchSamples = samples;
        const end = performance.now() + 550;
        function sample() {
          const component = document.querySelector('.hm, .wx')!.getBoundingClientRect();
          samples.push({ width: innerWidth, client: document.documentElement.clientWidth, content: component.width, device: document.documentElement.dataset.device });
          if (performance.now() < end) requestAnimationFrame(sample);
        }
        requestAnimationFrame(sample);
      });
      await page.getByRole('radio', { name: device, exact: true }).check();
      const samples = await page.locator('.device-shell').evaluate(async element => {
        const values: { opacity: number; width: number; height: number; animations: number }[] = [];
        const end = performance.now() + 600;
        while (performance.now() < end) {
          const rect = element.getBoundingClientRect();
          const fades = element.getAnimations().filter(animation => (animation.effect as KeyframeEffect).getKeyframes().some(keyframe => 'opacity' in keyframe || 'transform' in keyframe));
          values.push({ opacity: Number(getComputedStyle(element).opacity), width: rect.width, height: rect.height, animations: fades.length });
          await new Promise(requestAnimationFrame);
        }
        return values;
      });
      expect(samples.filter(sample => sample.animations > 1)).toEqual([]);
      const visible = samples.filter(sample => sample.opacity > 0.1);
      expect(new Set(visible.map(sample => `${sample.width.toFixed(2)}x${sample.height.toFixed(2)}`)).size).toBe(1);
      const content = await frame.locator('html').evaluate(() => (window as unknown as { switchSamples: { width: number; client: number; content: number; device: string }[] }).switchSamples);
      const width = device === '手机' ? 390 : 1440;
      const next = content.filter(sample => sample.width === width);
      expect(next.length).toBeGreaterThan(0);
      expect(new Set(next.map(sample => sample.content.toFixed(2))).size).toBe(1);
      await expect(page.locator('iframe')).toHaveAttribute('data-session', 'preserved');
    }
  });
}
