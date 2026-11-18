import { describe, expect, it } from 'vitest';
import { aiFolderSteps, folderGuide } from '../shared/folderGuide.ts';

describe('素材实现格式指引', () => {
  it('目录示例中的框架是可选项，导入已有素材沿用原格式', () => {
    const guide = folderGuide();
    expect(guide).toContain('HTML 实现（按需）');
    expect(guide).toContain('React 实现（按需）');
    expect(guide).toContain('Vue 实现（按需）');
    expect(guide).toContain('只放实际交付的实现，不要求同时提供 HTML、React、Vue');
    expect(guide).toContain('导入已有素材时沿用原有格式，不为凑齐框架改写');
    expect(guide).toContain('新建素材按需求选择一种或多种');
    expect(guide).toContain('单一实现不需要额外包装');
  });

  it('给 AI 的交付提示只保留规则入口、交付与确认', () => {
    const { steps } = aiFolderSteps();
    expect(steps[0].command).toContain('guide');
    expect(steps[1].label).toContain('只交付需要的实现');
    expect(steps[2].label).toContain('覆盖同 ID 前先询问');
    expect(steps).toHaveLength(3);
  });
});
