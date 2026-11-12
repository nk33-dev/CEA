import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '*.browser.ts',
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: process.env.CEA_TEST_URL ?? 'http://127.0.0.1:5180',
    viewport: { width: 1440, height: 900 },
    // 测试真实的滚动条绘制与拖动，不采用 headless 默认的隐藏滚动条参数。
    launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] },
    screenshot: 'only-on-failure',
  },
});
