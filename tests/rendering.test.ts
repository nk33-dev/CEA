import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { ideaParts, composeIdea } from '../shared/idea.ts';
import { chunkHtml, escapeHtml } from '../src/lib/codeChunks.ts';
import { renderCode } from '../src/lib/highlightJob.ts';
import { copyText } from '../src/lib/clipboard.ts';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Stage, PreviewStages } from '../src/components/Stage.tsx';
import { ZoomStage } from '../src/components/Stage.tsx';
import { ZoomControl } from '../src/components/ZoomControl.tsx';
import { CARD_VIEWPORT, DEVICE_VIEWPORTS, fitPreview, previewKind, previewScale, previewViewport, thumbnailTransform } from '../shared/preview.ts';
import { bundlePlayPage, htmlPlayPage } from '../server/play.ts';
import { DEFAULT_DEVICE_VIEW, DeviceControl } from '../src/components/DevicePreview.tsx';
import { PreviewBackgroundToggle } from '../src/components/AppearanceToggle.tsx';

afterEach(() => vi.unstubAllGlobals());

describe('预览加载态', () => {
  it('单选菜单在播放层使用文档内 picker，并压过组件的 appearance 重置', () => {
    const page = htmlPlayPage('Select', [{ path: 'style.css', content: '.custom{appearance:none!important}' }]);
    expect(page).toContain('::picker(select){appearance:base-select!important}');
    expect(page).toContain('[size="0"],[size="1"]');
    expect(page).toContain('select.multiple||select.size>1');
    expect(page).toContain("select.style.setProperty('appearance','base-select','important')");
  });
  it('等待时使用不挤占布局的状态指示，未就绪的 iframe 不接收焦点', () => {
    const html = renderToStaticMarkup(createElement(Stage, { assetId: 'test', title: 'Test' }));
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('role="status" aria-label="正在加载预览"');
    expect(html).toContain('stage-loading-indicator');
    expect(html).not.toContain('>正在加载预览');
    expect(html).toContain('tabindex="-1"');
  });
  it('详情首屏只创建选中的实现，不启动其他框架的预览', () => {
    const html = renderToStaticMarkup(createElement(PreviewStages, { assetId: 'test', title: 'Test', framework: 'html' }));
    expect(html.match(/<iframe\b/g)).toHaveLength(1);
    expect(html).toContain('/play/test/html/');
    expect(html).not.toContain('/play/test/react/');
    expect(html).not.toContain('/play/test/vue/');
  });
});

describe('预览缩放', () => {
  it('设备控件提供尺寸、旋转和预设管理', () => {
    expect(DEVICE_VIEWPORTS).toEqual({ desktop: { width: 1440, height: 900 }, phone: { width: 390, height: 844 } });
    const view = { ...DEFAULT_DEVICE_VIEW, device: 'phone' as const, framing: 'device' as const };
    const controls = renderToStaticMarkup(createElement(DeviceControl, { view, onChange: () => {} }));
    expect(controls).toContain('电脑');
    expect(controls).not.toContain('桌面');
    for (const name of ['设备尺寸', '预览设置', '向右旋转设备 90°', '旋转设置']) expect(controls).toContain(`aria-label="${name}"`);
    expect(controls).toContain('checked="" value="phone"');
  });
  it('组件视图默认不展示设备尺寸和旋转控件', () => {
    const controls = renderToStaticMarkup(createElement(DeviceControl, { view: DEFAULT_DEVICE_VIEW, onChange: () => {} }));
    expect(controls).toContain('checked="" value="content"');
    expect(controls).not.toContain('aria-label="设备尺寸"');
    expect(controls).not.toContain('aria-label="旋转设置"');
  });
  it('自动适配的整数百分比有效，也允许低于手动缩放下限的适配值', () => {
    for (const fitScale of [0.87, 0.12]) {
      const control = renderToStaticMarkup(createElement(ZoomControl, { value: 'fit', fitScale, onChange: () => {} }));
      expect(control).toContain('step="1"');
      expect(control).toContain(`min="${Math.min(25, Math.round(fitScale * 100))}"`);
    }
  });
  it('舞台背景使用独立的浅深色快捷选择，图标有名称和提示', () => {
    const controls = renderToStaticMarkup(createElement(PreviewBackgroundToggle, { value: 'dark', onChange: () => {} }));
    expect(controls).toContain('aria-label="舞台背景"');
    for (const name of ['浅色', '深色']) {
      expect(controls).toContain(`aria-label="${name}"`);
      expect(controls).toContain(`title="${name}预览背景"`);
    }
    expect(controls).toContain('checked=""');
    expect(controls).toContain('value="dark"');
  });
  it('缩略图按内容区域缩放：小组件不放大，宽组件缩进卡片，整页按宽度铺满', () => {
    const card = { width: 320, height: 240 };
    const small = thumbnailTransform(card, CARD_VIEWPORT, { x: 300, y: 220, width: 120, height: 100 }, 'component');
    expect(small.scale).toBe(1);
    expect(small.x + 360 * small.scale).toBeCloseTo(160);
    const wide = thumbnailTransform(card, CARD_VIEWPORT, { x: 20, y: 120, width: 680, height: 300 }, 'component');
    expect(680 * wide.scale).toBeLessThanOrEqual(320);
    const section = thumbnailTransform(card, { width: 1200, height: 720 }, { x: 0, y: 0, width: 1200, height: 500 }, 'section');
    expect(1200 * section.scale).toBeCloseTo(320);
    const page = thumbnailTransform(card, { width: 1440, height: 900 }, null, 'page');
    expect(page).toEqual({ scale: 320 / 1440, x: 0, y: 0 });
    expect(previewKind(null)).toBe('component');
    expect(previewKind({ width: 1200, height: 720 })).toBe('section');
    expect(previewKind({ width: 1440, height: 900 })).toBe('page');
  });
  it('宽幅画布完整适配容器，不把桌面布局压成手机布局', () => {
    expect(previewViewport({ width: 1200, height: 720 })).toEqual({ width: 1200, height: 720 });
    expect(previewViewport({ width: Infinity, height: 720 })).toBeNull();
    expect(previewViewport({ width: '1200', height: 720 })).toBeNull();
    expect(previewViewport({ width: 9999, height: 12 })).toEqual({ width: 1920, height: 240 });
    const scale = fitPreview({ width: 600, height: 338 }, { width: 1200, height: 720 });
    expect(1200 * scale).toBeLessThanOrEqual(600);
    expect(720 * scale).toBe(338);
    expect(fitPreview({ width: 600, height: 360 }, { width: 1200, height: 720 }, 1.25)).toBe(0.625);
  });

  it('HTML 和 Vue/React 的挂载容器使用相同的可用宽度', () => {
    for (const page of [htmlPlayPage('Test', []), bundlePlayPage('Test', '', null)]) {
      expect(page).toContain('#root{width:100%;min-width:0;display:grid;grid-template-columns:minmax(0,1fr);place-items:center}');
      expect(page).toContain('grid-template-columns:minmax(0,1fr)');
    }
  });
  it('比例限制在 25% 至 300%，错误值回退为原始比例', () => {
    expect(previewScale(1.35)).toBe(1.35);
    expect(previewScale(0)).toBe(0.25);
    expect(previewScale(10)).toBe(3);
    for (const v of [undefined, NaN, Infinity, '1.5']) expect(previewScale(v)).toBe(1);
  });

  it('只缩放显示层，不改 iframe 地址；比例可以输入，工具按钮有名称', () => {
    const make = (zoom: number) => renderToStaticMarkup(createElement(ZoomStage, { zoom, children: createElement(Stage, { assetId: 'test', title: 'Test' }) }));
    expect(make(1.5)).toContain('scale(1.5)');
    expect(make(0.5)).toContain('width:200%;height:200%');
    expect(make(1).match(/src="[^"]+"/)?.[0]).toBe(make(2).match(/src="[^"]+"/)?.[0]);
    const controls = renderToStaticMarkup(createElement(ZoomControl, { value: 1.25, onChange: () => {} }));
    expect(controls).toContain('value="125"');
    for (const name of ['缩小预览', '放大预览', '还原预览缩放', '缩放比例']) expect(controls).toContain(`aria-label="${name}"`);
  });
});

describe('思路提示词编辑', () => {
  it('短提示词只需要参照描述，关键差异可省略', () => {
    const text = '做一个力扣风格的提交热力图卡片，深色主题。';
    expect(ideaParts(text)).toEqual({ reference: text, details: '' });
    expect(composeIdea(text, '')).toBe(text);
  });

  it('长提示词分开维护后可无损还原，不混入来源或实现参数', () => {
    const text = '做一个 iOS 天气风格的卡片。\n\n- 温度数字逐位弹入。\n- 日期滑块跟随选中项。\n\n支持减少动态效果。';
    const parts = ideaParts(text);
    expect(parts.reference).toBe('做一个 iOS 天气风格的卡片。');
    expect(composeIdea(parts.reference, parts.details)).toBe(text);
    expect(composeIdea('Build a ', '')).toBe('Build a ');
  });
});

describe('长代码渲染', () => {
  it('压缩依赖保留原文并按字符分块，不拆开 HTML 实体', () => {
    const code = 'const value = "<script>&";'.repeat(9000);
    const chunks = renderCode({ text: '', parts: [{ label: null, lang: 'js', code }] });
    expect(chunks.length).toBeGreaterThan(10);
    expect(chunks.every(chunk => chunk.length <= 12_020)).toBe(true);
    expect(chunks.join('')).toBe(escapeHtml(code));
    expect(chunks.join('')).not.toContain('hljs-');
    for (const chunk of chunks) expect(chunk).not.toMatch(/&(?:[a-z]*|#[0-9]*)$/);
  });
  it('分块保留所有换行和空行，跨块的着色标签正确闭合', () => {
    const html = '<span class="hljs-comment">one\n\ntwo\nthree\nfour</span>';
    const chunks = chunkHtml(html, 2);
    expect(chunks).toHaveLength(3);
    expect(chunks.map(c => c.replace(/<[^>]*>/g, '')).join('')).toBe('one\n\ntwo\nthree\nfour');
    for (const c of chunks) {
      expect((c.match(/<span/g) ?? []).length).toBe((c.match(/<\/span>/g) ?? []).length);
    }
  });

  it('提示词文本和文件名被转义，不把源码当可执行 HTML', () => {
    const text = '<img src=x onerror=alert(1)>\n\n```html\n<button>OK</button>\n```';
    expect(renderCode({ text }).join('')).not.toContain('<img');
    const html = renderCode({ text: '', parts: [{ label: '<img>', lang: 'js', code: 'const n = 1;' }] }).join('');
    expect(html).toContain('&lt;img&gt;');
    expect(html).toContain('hljs-keyword');
  });

  it('大量代码分块，每块只含固定行数，回退文本同样安全', () => {
    const text = Array.from({ length: 2000 }, (_, i) => `const n${i} = ${i};`).join('\n');
    const chunks = renderCode({ text: '', parts: [{ label: null, lang: 'js', code: text }] });
    expect(chunks).toHaveLength(100);
    expect(chunks[0].match(/\n/g)).toHaveLength(20);
    expect(chunks.at(-1)).toContain('n1999');
    expect(chunkHtml(escapeHtml('<script>alert(1)</script>'))[0]).not.toContain('<script>');
  });
});

class TestWorker {
  static instances: TestWorker[] = [];
  onmessage?: (event: MessageEvent) => void;
  onerror?: () => void;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() { TestWorker.instances.push(this); }
}

describe('异步高亮', () => {
  beforeEach(() => {
    vi.resetModules();
    TestWorker.instances = [];
    vi.stubGlobal('Worker', TestWorker);
  });

  it('快速切换取消旧结果，只交付对应请求的内容', async () => {
    const { highlightAsync } = await import('../src/lib/codeWorker.ts');
    const old = highlightAsync({ text: 'old' });
    old.cancel();
    const next = highlightAsync({ text: 'new' });
    const worker = TestWorker.instances[0];
    const [[first], [second]] = worker.postMessage.mock.calls as unknown as [{ id: number }[], { id: number }[]];
    worker.onmessage?.({ data: { id: first.id, chunks: ['old'] } } as MessageEvent);
    worker.onmessage?.({ data: { id: second.id, chunks: ['new'] } } as MessageEvent);
    await expect(next.promise).resolves.toEqual(['new']);
    expect(TestWorker.instances).toHaveLength(1);
  });

  it('Worker 故障通知回退，下次请求能重新启动', async () => {
    const { highlightAsync } = await import('../src/lib/codeWorker.ts');
    const task = highlightAsync({ text: 'test' });
    const rejected = expect(task.promise).rejects.toBeUndefined();
    TestWorker.instances[0].onerror?.();
    await rejected;
    expect(TestWorker.instances[0].terminate).toHaveBeenCalled();
    const next = highlightAsync({ text: 'retry' });
    next.cancel();
    expect(TestWorker.instances).toHaveLength(2);
  });
});

describe('完整复制', () => {
  it('复制使用完整文本，不依赖虚拟代码区的可见片段', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const text = 'full source\n'.repeat(2000);
    await copyText(text);
    expect(writeText).toHaveBeenCalledWith(text);
  });

  it('异步剪贴板被拒绝时回退，复制结束恢复焦点', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });
    const area = { value: '', style: {}, setAttribute: vi.fn(), select: vi.fn(), remove: vi.fn() };
    const focus = vi.fn();
    const execCommand = vi.fn().mockReturnValue(true);
    vi.stubGlobal('document', { createElement: () => area, activeElement: { focus }, body: { append: vi.fn() }, execCommand });
    await copyText('complete content');
    expect(area.value).toBe('complete content');
    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(area.remove).toHaveBeenCalled();
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it('复制命令失败仍清理临时节点并报告错误', async () => {
    vi.stubGlobal('navigator', {});
    const remove = vi.fn();
    vi.stubGlobal('document', {
      createElement: () => ({ style: {}, setAttribute: vi.fn(), select: vi.fn(), remove }),
      activeElement: null, body: { append: vi.fn() }, execCommand: () => false,
    });
    await expect(copyText('content')).rejects.toThrow('copy failed');
    expect(remove).toHaveBeenCalled();
  });
});
