import { afterEach, describe, expect, it, vi } from 'vitest';
import { BACKGROUND_RELEASE_MS, createActivity, MAX_GPU_CONTEXTS, MAX_RETAINED_PREVIEWS, MAX_WARMING_PREVIEWS, PREVIEW_IDLE_MS, SCROLL_SETTLE_MS } from '../src/components/PreviewActivity.tsx';

afterEach(() => vi.useRealTimers());

describe('列表预览预算', () => {
  it('后台不启动预热，短暂离开保留实例，长时间后台释放全部实例', () => {
    vi.useFakeTimers();
    const activity = createActivity();
    activity.retain('live');
    activity.activate('live', true);
    activity.setVisible(false);
    activity.prewarm('waiting');
    activity.retain('hidden');
    vi.advanceTimersByTime(BACKGROUND_RELEASE_MS - 1);
    expect(activity.resident()).toEqual(['live']);
    activity.setVisible(true);
    expect(activity.resident()).toEqual(['live']);
    activity.activate('live', false);
    vi.advanceTimersByTime(PREVIEW_IDLE_MS);
    expect(activity.resident()).toContain('waiting');
    activity.setVisible(false);
    vi.advanceTimersByTime(BACKGROUND_RELEASE_MS);
    expect(activity.resident()).toEqual([]);
    activity.setVisible(true);
    activity.retain('live');
    expect(activity.resident()).toEqual(['live']);
    activity.dispose();
  });
  it('按实际 WebGL 上下文限制驻留，不挤掉正在操作的预览和普通组件', () => {
    const activity = createActivity();
    activity.retain('plain');
    activity.retain('interactive');
    activity.activate('interactive', true);
    activity.resources('interactive', 2);
    for (let i = 0; i < MAX_GPU_CONTEXTS; i++) {
      activity.retain(`gpu-${i}`);
      activity.resources(`gpu-${i}`, 1);
    }
    expect(activity.resident()).toContain('plain');
    expect(activity.resident()).toContain('interactive');
    expect(activity.resident().filter(id => id.startsWith('gpu-'))).toHaveLength(MAX_GPU_CONTEXTS - 2);
    expect(activity.resident()).not.toContain('gpu-0');
    activity.resources('evicted', 100);
    expect(activity.resident()).toContain('interactive');
    activity.release('interactive');
    expect(activity.resident()).not.toContain('interactive');
  });
  it('最近操作的预览保留，最早未使用的实例按预算释放', () => {
    const activity = createActivity();
    for (let index = 0; index < MAX_RETAINED_PREVIEWS; index++) activity.retain(String(index));
    activity.retain('0');
    activity.retain('next');
    expect(activity.resident()).toHaveLength(MAX_RETAINED_PREVIEWS);
    expect(activity.resident()).toContain('0');
    expect(activity.resident()).not.toContain('1');
    expect(activity.resident().at(-1)).toBe('next');
    activity.release('0');
    expect(activity.resident()).not.toContain('0');
  });

  it('不重复登记最近实例，活动结束与释放可重复调用', () => {
    const activity = createActivity();
    activity.retain('a');
    const snapshot = activity.resident();
    activity.retain('a');
    expect(activity.resident()).toBe(snapshot);
    const end = activity.begin();
    expect(activity.snapshot()).toBe(1);
    end(); end();
    expect(activity.snapshot()).toBe(0);
    activity.release('a'); activity.release('a');
    expect(activity.resident()).toEqual([]);
  });

  it('可见预览限量预热，悬停不用等待预热队列', () => {
    vi.useFakeTimers();
    const activity = createActivity();
    for (let index = 0; index < 6; index++) activity.prewarm(String(index));
    expect(activity.resident()).toEqual([]);
    vi.advanceTimersByTime(PREVIEW_IDLE_MS);
    expect(activity.resident()).toHaveLength(MAX_WARMING_PREVIEWS);
    activity.retain('5');
    expect(activity.resident()).toContain('5');
    expect(activity.snapshot()).toBe(0);
    activity.ready('0');
    vi.advanceTimersByTime(PREVIEW_IDLE_MS);
    expect(activity.resident()).toContain('1');
    expect(activity.resident()).not.toContain('2');
    activity.ready('1');
    vi.advanceTimersByTime(PREVIEW_IDLE_MS);
    expect(activity.resident()).toContain('2');
    activity.ready('2');
    vi.advanceTimersByTime(PREVIEW_IDLE_MS);
    expect(activity.resident()).toContain('3');
    expect(activity.resident()).not.toContain('4');
    expect(activity.resident().filter(id => id === '5')).toHaveLength(1);
  });

  it('离屏时取消排队和进行中的预热，已就绪的实例仍保留', () => {
    vi.useFakeTimers();
    const activity = createActivity();
    const cancel = activity.prewarm('offscreen');
    cancel();
    vi.runAllTimers();
    expect(activity.resident()).toEqual([]);
    const cancelNext = activity.prewarm('next');
    vi.advanceTimersByTime(PREVIEW_IDLE_MS);
    cancelNext();
    activity.cancelWarm('next');
    expect(activity.resident()).toEqual([]);
    activity.ready('next');
    const cancelVisible = activity.prewarm('visible');
    vi.advanceTimersByTime(PREVIEW_IDLE_MS);
    expect(activity.resident()).toEqual(['visible']);
    activity.ready('visible');
    cancelVisible();
    expect(activity.resident()).toEqual(['visible']);
  });

  it('预热转为主动播放时保留 GPU 计数，不会被旧预热清理挤掉', () => {
    vi.useFakeTimers();
    const activity = createActivity();
    const cancel = activity.prewarm('playing');
    vi.advanceTimersByTime(PREVIEW_IDLE_MS);
    activity.resources('playing', 1);
    activity.retain('playing');
    activity.activate('playing', true);
    cancel();
    activity.cancelWarm('playing');
    for (let index = 0; index < MAX_GPU_CONTEXTS; index++) {
      activity.retain(`gpu-${index}`);
      activity.resources(`gpu-${index}`, 1);
    }
    expect(activity.resident()).toContain('playing');
    expect(activity.resident()).toHaveLength(MAX_GPU_CONTEXTS);
  });

  it('滚动和翻页期间不启动预览，稳定后串行预热，操作中的预览优先', () => {
    vi.useFakeTimers();
    const activity = createActivity();
    activity.setNavigating(true);
    activity.prewarm('first');
    activity.prewarm('second');
    activity.retain('hovered');
    vi.advanceTimersByTime(PREVIEW_IDLE_MS);
    expect(activity.resident()).toEqual([]);
    activity.setNavigating(false);
    activity.scroll();
    expect(activity.canInteract()).toBe(false);
    vi.advanceTimersByTime(SCROLL_SETTLE_MS + PREVIEW_IDLE_MS - 1);
    expect(activity.resident()).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(activity.resident()).toEqual(['first']);
    activity.retain('hovered');
    activity.activate('hovered', true);
    expect(activity.suspended('first')).toBe(true);
    expect(activity.suspended('hovered')).toBe(false);
    activity.ready('first');
    vi.advanceTimersByTime(PREVIEW_IDLE_MS);
    expect(activity.resident()).not.toContain('second');
    activity.scroll();
    expect(activity.suspended('hovered')).toBe(true);
    vi.advanceTimersByTime(SCROLL_SETTLE_MS);
    expect(activity.suspended('hovered')).toBe(false);
    activity.activate('hovered', false);
    vi.advanceTimersByTime(PREVIEW_IDLE_MS);
    expect(activity.resident()).toContain('second');
    activity.dispose();
  });
});
