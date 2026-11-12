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

  it('给 AI 的交付提示先说明格式选择，再说明多实现的一致性', () => {
    const { steps } = aiFolderSteps();
    const choice = steps.find(step => step.label.includes('沿用素材已有格式'))!;
    expect(choice).toBeDefined();
    expect(choice.label).toContain('不必补齐 HTML、React、Vue');
    expect(choice.label).toContain('新建时按需选技术栈');
    expect(choice.label).toContain('交付多种实现时共用样式和逻辑');
    expect(choice.label).toContain('手机宽度下也要显示一致');
    expect(steps).toHaveLength(5);
  });
});
