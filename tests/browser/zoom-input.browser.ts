import { test, expect } from '@playwright/test';

test('zoom input keeps native selection and editing behavior', async ({ page }) => {
  await page.goto('/a/weather-day-switcher');
  const input = page.getByRole('spinbutton', { name: '缩放比例', exact: true });
  await input.fill('70');
  await input.press('Enter');
  await expect(input).toHaveValue('70');
  await input.evaluate(element => {
    const field = element as HTMLInputElement & { selectionCalls: number };
    const select = field.select.bind(field);
    field.selectionCalls = 0;
    field.select = () => { field.selectionCalls++; select(); };
  });
  await input.click();
  expect(await input.evaluate(element => (element as HTMLInputElement & { selectionCalls: number }).selectionCalls)).toBe(0);
  await input.press('ControlOrMeta+A');
  await input.pressSequentially('85');
  await input.press('Enter');
  await expect(input).toHaveValue('85');
  await page.getByRole('button', { name: '放大预览', exact: true }).click();
  await expect(input).toHaveValue('90');
  await page.getByRole('button', { name: '缩小预览', exact: true }).click();
  await expect(input).toHaveValue('80');
});
