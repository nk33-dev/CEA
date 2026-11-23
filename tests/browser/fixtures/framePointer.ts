import { expect, type Locator, type Page } from '@playwright/test';

export async function clickScaledFrame(page: Page, iframe: Locator, control: Locator) {
  await expect(control).toBeVisible();
  const frame = await iframe.boundingBox();
  if (!frame) throw new Error('Preview frame is not visible');
  const target = await control.evaluate(element => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, width: innerWidth, height: innerHeight };
  });
  // Edge 的驱动可能返回未缩放的帧内坐标；在父页面发出真实鼠标事件。
  const point = { x: frame.x + target.x * frame.width / target.width, y: frame.y + target.y * frame.height / target.height };
  expect(await iframe.evaluate((element, point) => document.elementFromPoint(point.x, point.y) === element, point)).toBe(true);
  await page.mouse.click(point.x, point.y);
}
