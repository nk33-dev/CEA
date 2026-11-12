import { test, expect } from '@playwright/test';

for (const framework of ['html', 'react', 'vue']) {
  test(`document scrollbars follow the stage, not the ${framework} map theme`, async ({ page }) => {
    await page.addInitScript(value => localStorage.setItem('cea:framework', value), framework);
    await page.goto('/a/china-map-hero');
    await expect(page.locator('.stage-host')).toHaveAttribute('aria-busy', 'false');
    const frame = page.frameLocator('iframe');
    const theme = page.getByRole('radiogroup', { name: '组件主题', exact: true });
    const background = page.getByRole('radiogroup', { name: '舞台背景', exact: true });
    await page.locator('iframe').evaluate(element => element.setAttribute('data-session', 'preserved'));
    const geometry = () => frame.locator('html').evaluate(element => ({
      width: element.clientWidth, height: element.clientHeight,
      scrollWidth: element.scrollWidth, scrollHeight: element.scrollHeight,
      mapWidth: document.querySelector('.cm')!.getBoundingClientRect().width,
      mapHeight: document.querySelector('.cm')!.getBoundingClientRect().height,
    }));
    const initial = await geometry();
    for (const stage of ['light', 'dark'] as const) {
      await background.getByRole('radio', { name: stage === 'light' ? '浅色' : '深色', exact: true }).check();
      await expect(frame.locator('html')).toHaveAttribute('data-background', stage);
      for (const component of ['dark', 'light'] as const) {
        await theme.getByRole('radio', { name: component === 'light' ? '浅色' : '深色', exact: true }).check();
        await expect(frame.locator('html')).toHaveAttribute('data-theme', component);
        await expect(frame.locator('html')).toHaveCSS('color-scheme', stage);
        await expect(frame.locator('body')).toHaveCSS('color-scheme', component);
        await expect(frame.locator('.cm')).toHaveCSS('color-scheme', component);
        expect(await geometry()).toEqual(initial);
        if (component === 'dark') {
          await page.locator('.panel-preview').screenshot({ path: `test-results/map-scrollbar-${framework}-${stage}.png` });
        }
      }
    }
    expect(await frame.locator('html').evaluate(element => {
      const overflow = document.createElement('div');
      overflow.style.height = `${innerHeight * 2}px`;
      document.body.append(overflow);
      element.scrollTop = 20;
      return element.scrollTop;
    })).toBeGreaterThan(0);
    await expect(page.locator('iframe')).toHaveAttribute('data-session', 'preserved');
  });
}
