export const PREVIEW_SCALE_MIN = 0.25;
export const PREVIEW_SCALE_MAX = 3;

export interface PreviewViewport { width: number; height: number }
export type PreviewDevice = 'desktop' | 'phone';
export type PreviewFraming = 'content' | 'device';

export const DEVICE_VIEWPORTS: Record<PreviewDevice, PreviewViewport> = {
  desktop: { width: 1440, height: 900 },
  phone: { width: 390, height: 844 },
};

export const PREVIEW_VIEWPORTS = [
  { value: 'auto', label: '自适应' },
  { value: '1200x720', label: '宽幅 · 1200 × 720' },
  { value: '1440x900', label: '整页 · 1440 × 900' },
] as const;

export function previewViewport(value: unknown): PreviewViewport | null {
  if (!value || typeof value !== 'object') return null;
  const { width, height } = value as Partial<PreviewViewport>;
  if (typeof width !== 'number' || typeof height !== 'number' || !Number.isFinite(width) || !Number.isFinite(height)) return null;
  return { width: Math.round(Math.min(1920, Math.max(240, width))), height: Math.round(Math.min(1440, Math.max(240, height))) };
}

/**
 * 素材在列表里的展示方式，由保存的预览画布决定：
 * 组件按内容大小居中；区块按画布宽度排版、横跨两列完整显示；整页横跨两列、截取首屏。
 */
export type PreviewKind = 'component' | 'section' | 'page';

/** 组件的缩略图在这个视口里排版：够宽，不会触发手机布局 */
export const CARD_VIEWPORT: PreviewViewport = { width: 720, height: 540 };

export function previewKind(viewport: PreviewViewport | null | undefined): PreviewKind {
  if (!viewport || viewport.width <= viewport.height) return 'component';
  return viewport.width === 1440 && viewport.height === 900 ? 'page' : 'section';
}

export function isWideViewport(viewport: PreviewViewport | null | undefined): boolean {
  return previewKind(viewport) !== 'component';
}

/** 播放页报告的内容边界，坐标相对 iframe 视口 */
export interface PreviewBounds { x: number; y: number; width: number; height: number }
export interface PreviewLayout extends PreviewViewport { framing: PreviewFraming }

/**
 * 缩略图的位置和比例。按内容边界而不是整个视口缩放，舞台留白不会挤占卡片；
 * 组件最多显示到原始大小，整页按宽度铺满并顶部对齐。
 */
export function thumbnailTransform(container: PreviewViewport, viewport: PreviewViewport, bounds: PreviewBounds | null, kind: PreviewKind, zoom = 1) {
  const z = previewScale(zoom);
  if (kind === 'page') {
    const scale = container.width / viewport.width * z;
    return { scale, x: (container.width - viewport.width * scale) / 2, y: 0 };
  }
  const box = bounds && bounds.width >= 1 && bounds.height >= 1 ? bounds : { x: 0, y: 0, ...viewport };
  const pad = kind === 'component' ? Math.min(24, container.width * 0.08) : 0;
  const fit = Math.min((container.width - pad * 2) / box.width, (container.height - pad * 2) / box.height);
  const scale = (kind === 'component' ? Math.min(fit, 1) : fit) * z;
  return { scale, x: container.width / 2 - (box.x + box.width / 2) * scale, y: container.height / 2 - (box.y + box.height / 2) * scale };
}

export function fitPreview(container: PreviewViewport, viewport: PreviewViewport, zoom = 1): number {
  return Math.min(container.width / viewport.width, container.height / viewport.height) * previewScale(zoom);
}

export function previewScale(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.round(Math.min(PREVIEW_SCALE_MAX, Math.max(PREVIEW_SCALE_MIN, value)) * 100) / 100
    : 1;
}
