import { describe, expect, it } from 'vitest';
import { aiCliPrompt } from '../shared/cliPrompt.ts';
import { en } from '../shared/i18n/ui/en.ts';

describe('可复制 CLI 工作流', () => {
  it('绑定当前程序和库，通过帮助发现工作流并保留写入确认', () => {
    const prompt = aiCliPrompt({ path: 'F:\\My Library', cli: { path: 'C:\\My CEA\\dist-cli\\cea.mjs', platform: 'win32' } });
    expect(prompt).toContain('node "C:\\My CEA\\dist-cli\\cea.mjs" --help');
    expect(prompt).toContain('F:\\My Library');
    expect(prompt).toContain('导入前检查和预演');
    expect(prompt).toContain('需要覆盖时先询问');
    expect(prompt.split('\n')).toHaveLength(4);
    expect(prompt).not.toContain('--overwrite');
    expect(prompt).not.toContain('E:\\CEA-Assets');
  });

  it('支持其他系统、缺省入口和界面翻译，不把语言判断散落在页面', () => {
    const prompt = aiCliPrompt({ path: "/Users/me/AI's Library", cli: { path: '/Applications/CEA/cea.mjs', platform: 'darwin' } }, key => en[key as keyof typeof en] ?? key);
    expect(prompt).toContain("node '/Applications/CEA/cea.mjs'");
    expect(prompt).toContain("/Users/me/AI's Library");
    expect(prompt).toContain('Read the help first');
    expect(prompt).not.toMatch(/[\u4e00-\u9fff]/);
    expect(aiCliPrompt()).toContain('npm run cea -- --help');
  });
});
