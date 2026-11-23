import { expect, test } from '@playwright/test';
import { mockLibrary } from './fixtures/mockLibrary.ts';
import { unzipSync, strFromU8 } from 'fflate';

test('blocked browser storage leaves browsing and session theme switching usable', async ({ page }) => {
  await mockLibrary(page);
  await page.addInitScript(() => {
    if (window !== window.top) return;
    const set = Storage.prototype.setItem;
    Storage.prototype.getItem = () => { throw new DOMException('Blocked', 'SecurityError'); };
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith('cea:ui:')) throw new DOMException('Blocked', 'SecurityError');
      set.call(this, key, value);
    };
  });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('.card')).toHaveCount(3);
  await page.getByRole('radio', { name: '深色界面', exact: true }).check();
  await expect(page.locator('html')).toHaveAttribute('data-ui-theme', 'dark');
  await page.locator('.card').first().locator('.card-stage').hover();
  await page.locator('.card').first().frameLocator('iframe').locator('#counter').click();
  await expect(page.locator('.card').first().frameLocator('iframe').locator('#counter')).toHaveText('1');
  expect(errors).toEqual([]);
});

test('draft storage failures stay visible and do not turn a successful library save into an error', async ({ page }) => {
  const { assets } = await mockLibrary(page);
  await page.addInitScript(() => {
    if (window !== window.top) return;
    for (const method of ['setItem', 'removeItem'] as const) {
      const original = Storage.prototype[method];
      Storage.prototype[method] = function (key: string, value?: string) {
        if (key === 'cea:draft:new:v2') throw new DOMException('Full', 'QuotaExceededError');
        return original.call(this, key, value!);
      };
    }
  });
  await page.goto('/new');
  await page.getByRole('textbox', { name: '编辑 markup.html', exact: true }).fill('<button>Draft content</button>');
  await expect(page.getByRole('alert')).toContainText('草稿无法自动保存');
  await page.getByRole('tab', { name: '信息与提示词', exact: true }).click();
  await page.getByRole('textbox', { name: '默认名称', exact: true }).fill('Recoverable draft');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page).toHaveURL(/\/a\/recoverable-draft$/);
  expect(assets.get('recoverable-draft')!.variants[0].files[0].content).toContain('Draft content');
});

test('invalid stored drafts fall back to an editable template', async ({ page }) => {
  await mockLibrary(page);
  await page.addInitScript(() => {
    if (window === window.top) localStorage.setItem('cea:draft:new:v2', JSON.stringify({ variants: [], texts: null }));
  });
  await page.goto('/new');
  await expect(page.getByRole('textbox', { name: '编辑 markup.html', exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('replaying a cached draft renews the server URL', async ({ page }) => {
  const { writes } = await mockLibrary(page);
  await page.goto('/a/demo-a/edit');
  await expect(page.locator('.editor-preview .stage-host')).toHaveAttribute('aria-busy', 'false');
  const before = await page.locator('iframe').getAttribute('src');
  const count = writes.filter(value => value === 'POST /api/play/draft').length;
  await page.getByRole('button', { name: '重播', exact: true }).click();
  await expect.poll(() => writes.filter(value => value === 'POST /api/play/draft').length).toBe(count + 1);
  await expect.poll(async () => {
    const frames = await page.locator('iframe').evaluateAll(elements => elements.map(frame => frame.getAttribute('src')));
    return frames.length === 1 && frames[0] !== before;
  }).toBe(true);
  await expect(page.locator('.editor-preview .stage-host')).toHaveAttribute('aria-busy', 'false');
});

test('assets without a runnable implementation retain their image cover', async ({ page }) => {
  const { assets } = await mockLibrary(page);
  assets.get('demo-a')!.frameworks = [];
  assets.get('demo-a')!.cover = 'assets/demo-a/cover.png';
  await page.goto('/');
  const card = page.locator('[data-asset-id="demo-a"]');
  await expect(card.locator('.card-cover')).toBeVisible();
  await card.locator('.card-stage').hover();
  await expect(card.locator('iframe')).toHaveCount(0);
});

test('folder drops package original bytes in a worker and ignore repeated drops during reading', async ({ page }) => {
  const { writes } = await mockLibrary(page);
  let contents = '';
  await page.route('**/api/import/preview?*', async route => {
    const files = unzipSync(route.request().postDataBuffer()!);
    contents = strFromU8(files['fixture/markup.html']);
    await route.fallback();
  });
  await page.goto('/transfer');
  await page.locator('.transfer-drop').evaluate(element => {
    const file = new File(['<button>Original bytes</button>'], 'markup.html', { type: 'text/html' });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    Object.defineProperty(DataTransferItem.prototype, 'webkitGetAsEntry', { value: () => ({
      name: 'fixture', isDirectory: true,
      createReader: () => {
        let delivered = false;
        return { readEntries: (callback: (entries: unknown[]) => void) => {
          const entries = delivered ? [] : [{ name: file.name, isDirectory: false, file: (callback: (file: File) => void) => setTimeout(() => callback(file), 150) }];
          delivered = true;
          callback(entries);
        } };
      },
    }) });
    element.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    element.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  });
  await expect(page.locator('.import-plan')).toBeVisible();
  expect(contents).toBe('<button>Original bytes</button>');
  expect(writes.filter(value => value === 'POST /api/import/preview')).toHaveLength(1);
});
