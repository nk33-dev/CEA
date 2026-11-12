import { describe, expect, it, vi } from 'vitest';
import { createSelectionMotion, selectionFrames, SELECTION_TIMING } from '../src/lib/selectionMotion.ts';
import { handleTabKeys } from '../src/lib/tabKeys.ts';
import type { KeyboardEvent } from 'react';

function fixture() {
  const animations: { cancel: ReturnType<typeof vi.fn>; onfinish: (() => void) | null }[] = [];
  const element = {
    style: { width: '', height: '', transform: '' },
    hidden: true,
    getBoundingClientRect: vi.fn(() => ({ left: 65, top: 22, width: 60, height: 28 })),
    animate: vi.fn((_frames: Keyframe[], _options: KeyframeAnimationOptions) => {
      const animation = { cancel: vi.fn(), onfinish: null as (() => void) | null };
      animations.push(animation);
      return animation;
    }),
  };
  const host = { dataset: {} as Record<string, string>, clientLeft: 0, clientTop: 0, getBoundingClientRect: vi.fn(() => ({ left: 10, top: 20 })) };
  const controller = createSelectionMotion(element as unknown as HTMLElement, host as unknown as HTMLElement);
  return { element, host, animations, controller };
}

const first = { x: 2, y: 2, width: 80, height: 28 };
const second = { x: 84, y: 2, width: 64, height: 28 };
const third = { x: 150, y: 2, width: 50, height: 28 };

describe('共享选择滑块', () => {
  it('首次渲染直接定位，不从页面原点飞入', () => {
    const { element, host, controller } = fixture();
    controller.move(first, true, false);
    expect(element.hidden).toBe(false);
    expect(element.style.transform).toBe('translate3d(2px, 2px, 0) scaleX(1)');
    expect(host.dataset.selectionReady).toBe('');
    expect(element.animate).not.toHaveBeenCalled();
  });

  it('不同宽度的选项只通过 transform 过渡，不逐帧动画 width 或 left', () => {
    const { element, controller } = fixture();
    controller.move(first, false, false);
    controller.move(second, true, false);
    expect(element.style.width).toBe('64px');
    expect(element.animate).toHaveBeenCalledWith([
      { transform: 'translate3d(2px, 2px, 0) scaleX(1.25)' },
      { transform: 'translate3d(84px, 2px, 0) scaleX(1)' },
    ], SELECTION_TIMING);
    expect(selectionFrames(first, second).every(frame => Object.keys(frame).join() === 'transform')).toBe(true);
  });

  it('连续点击取消旧动画，并从当前可见位置接着移动', () => {
    const { element, animations, controller } = fixture();
    controller.move(first, false, false);
    controller.move(second, true, false);
    controller.move(third, true, false);
    expect(animations[0].cancel).toHaveBeenCalledOnce();
    expect(element.animate.mock.calls.at(-1)?.[0]).toEqual([
      { transform: 'translate3d(55px, 2px, 0) scaleX(1.2)' },
      { transform: 'translate3d(150px, 2px, 0) scaleX(1)' },
    ]);
    expect(animations).toHaveLength(2);
  });

  it('相同位置不重复测量和启动动画，resize 直接对齐新尺寸', () => {
    const { element, animations, controller } = fixture();
    controller.move(first, false, false);
    controller.move(second, true, false);
    controller.move(second, true, false);
    expect(animations).toHaveLength(1);
    expect(element.getBoundingClientRect).not.toHaveBeenCalled();
    controller.move(third, false, false);
    expect(animations[0].cancel).toHaveBeenCalledOnce();
    expect(animations).toHaveLength(1);
    expect(element.style.transform).toContain('150px');
  });

  it('减少动态效果、无动画 API、隐藏和卸载都有即时回退', () => {
    const { element, host, animations, controller } = fixture();
    controller.move(first, false, false);
    controller.move(second, true, true);
    expect(animations).toHaveLength(0);
    controller.move(third, true, false);
    controller.finish();
    expect(animations[0].cancel).toHaveBeenCalledOnce();
    expect(element.style.transform).toContain('150px');
    controller.reset();
    expect(element.hidden).toBe(true);
    expect(host.dataset.selectionReady).toBeUndefined();
    controller.move(first, true, false);
    expect(animations).toHaveLength(1);
    controller.destroy();
    expect(host.dataset.selectionReady).toBeUndefined();
    const withoutApi = fixture();
    (withoutApi.element as unknown as { animate?: unknown }).animate = undefined;
    withoutApi.controller.move(first, false, false);
    withoutApi.controller.move(second, true, false);
    expect(withoutApi.element.style.transform).toContain('84px');
  });

  it('过期动画的完成回调不会清掉新动画', () => {
    const { animations, controller } = fixture();
    controller.move(first, false, false);
    controller.move(second, true, false);
    const oldFinish = animations[0].onfinish!;
    controller.move(third, true, false);
    oldFinish();
    controller.destroy();
    expect(animations[1].cancel).toHaveBeenCalledOnce();
  });
});

describe('共享页签键盘操作', () => {
  it('左右循环，Home / End 跳转，更新焦点和选中状态', () => {
    const tabs = Array.from({ length: 3 }, () => ({ focus: vi.fn(), click: vi.fn() }));
    const preventDefault = vi.fn();
    const event = (key: string, index: number) => ({
      key, preventDefault,
      target: { closest: () => tabs[index] },
      currentTarget: { querySelectorAll: () => tabs, getAttribute: () => null },
    } as unknown as KeyboardEvent<HTMLElement>);
    handleTabKeys(event('ArrowLeft', 0));
    expect(tabs[2].focus).toHaveBeenCalledOnce();
    expect(tabs[2].click).toHaveBeenCalledOnce();
    handleTabKeys(event('Home', 2));
    expect(tabs[0].click).toHaveBeenCalledOnce();
    handleTabKeys(event('End', 0));
    expect(tabs[2].click).toHaveBeenCalledTimes(2);
    handleTabKeys(event('Tab', 0));
    expect(preventDefault).toHaveBeenCalledTimes(3);
  });
});
