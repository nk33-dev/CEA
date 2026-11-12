import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { PLAYBACK_SCRIPT } from '../server/playback.ts';
import { htmlPlayPage } from '../server/play.ts';

function animation(state = 'running') {
  const value = {
    playState: state,
    pause: vi.fn(() => { value.playState = 'paused'; }),
    play: vi.fn(() => { value.playState = 'running'; }),
  };
  return value;
}

function media(paused = false) {
  const value = {
    paused, ended: false, isConnected: true,
    pause: vi.fn(() => { value.paused = true; }),
    play: vi.fn(() => { value.paused = false; return Promise.resolve(); }),
  };
  return value;
}

function harness(page = false) {
  let now = 0;
  let sequence = 0;
  const queue = new Map<number, (time: number) => void>();
  const timers = new Map<number, { at: number; callback: () => void }>();
  const advance = (value: number) => {
    now = value;
    for (const [id, timer] of timers) {
      if (timer.at <= now) { timers.delete(id); timer.callback(); }
    }
  };
  const animations: ReturnType<typeof animation>[] = [];
  const players: ReturnType<typeof media>[] = [];
  const listeners = new Map<string, (event?: { isTrusted: boolean }) => void>();
  const messages = new Map<string, (event: unknown) => void>();
  const attributes = new Set<string>();
  const window = {
    requestAnimationFrame: (callback: (time: number) => void) => { const id = ++sequence; queue.set(id, callback); return id; },
    cancelAnimationFrame: (id: number) => queue.delete(id),
    parent: { postMessage: vi.fn() },
  };
  class TestElement {
    animate() { const result = animation(); animations.push(result); return result; }
  }
  const document = {
    hidden: false,
    documentElement: { toggleAttribute: (name: string, on: boolean) => on ? attributes.add(name) : attributes.delete(name), dataset: {}, classList: { toggle: vi.fn() } },
    fonts: { ready: Promise.resolve() },
    body: { children: [] as unknown[] },
    getElementById: () => null,
    getAnimations: () => animations,
    querySelectorAll: () => players,
    addEventListener: (type: string, callback: (event?: { isTrusted: boolean }) => void) => {
      const previous = listeners.get(type);
      listeners.set(type, event => {
        const payload = { target: { closest: () => null }, ...event } as { isTrusted: boolean };
        previous?.(payload);
        callback(payload);
      });
    },
  };
  const script = page
    ? htmlPlayPage('Test', []).match(/<script>([\s\S]*?)<\/script>/)![1]
    : `${PLAYBACK_SCRIPT}\n({ setActive });`;
  const globals = {
    window, document, innerWidth: 1000, innerHeight: 700, performance: { now: () => now }, Element: TestElement,
    getComputedStyle: () => ({ backgroundImage: 'none', backgroundColor: '#fff', boxShadow: 'none', borderTopWidth: '0', borderBottomWidth: '0' }),
    setTimeout: (callback: () => void, delay: number) => { const id = ++sequence; timers.set(id, { at: now + delay, callback }); return id; },
    location: { search: '?active=0&interactive=1' }, URLSearchParams, parent: window.parent,
    addEventListener: (type: string, callback: (event: unknown) => void) => {
      const previous = messages.get(type);
      messages.set(type, event => { previous?.(event); callback(event); });
    },
  };
  const control = vm.runInNewContext(script, globals) as { setActive: (active: boolean, interactive?: boolean) => void };
  return {
    control, window, document, animations, players, listeners, messages, attributes, queue, TestElement,
    time: advance,
    resize(width: number, height: number) {
      globals.innerWidth = width;
      globals.innerHeight = height;
      messages.get('resize')?.({});
    },
    frame(value: number) { advance(value); const callbacks = [...queue.values()]; queue.clear(); callbacks.forEach(callback => callback(value)); },
  };
}

describe('预览播放控制', () => {
  it('首帧携带布局边界，入场缩放不改变缩略图的测量尺寸', async () => {
    const h = harness(true);
    h.document.body.children.push({
      tagName: 'SECTION', offsetWidth: 300, offsetHeight: 280, offsetLeft: 210, offsetTop: 130, offsetParent: null,
      matches: () => false,
      getBoundingClientRect: () => ({ left: 322, top: 235, right: 397, bottom: 305, width: 75, height: 70 }),
    });
    h.listeners.get('DOMContentLoaded')?.();
    await Promise.resolve();
    h.frame(16);
    h.frame(32);
    expect(h.window.parent.postMessage).toHaveBeenCalledWith({
      type: 'cea:ready', bounds: { x: 210, y: 130, width: 300, height: 280 },
      layout: { width: 1000, height: 700, framing: 'content' },
    }, '*');
    h.time(1632);
    const bounds = h.window.parent.postMessage.mock.calls.filter(([message]) => message.type === 'cea:bounds');
    expect(bounds).toHaveLength(1);
  });
  it('打开的弹层不参与组件边界测量', async () => {
    const h = harness(true);
    h.document.body.children.push({
      tagName: 'SECTION', offsetWidth: 300, offsetHeight: 180, offsetLeft: 210, offsetTop: 130, offsetParent: null,
      matches: () => false,
    }, {
      tagName: 'ASIDE', offsetWidth: 500, offsetHeight: 650, offsetLeft: 0, offsetTop: 0, offsetParent: null,
      matches: (selector: string) => selector === '[popover],dialog',
    });
    h.listeners.get('DOMContentLoaded')?.();
    await Promise.resolve();
    h.frame(16);
    h.frame(32);
    expect(h.window.parent.postMessage).toHaveBeenCalledWith({
      type: 'cea:ready', bounds: { x: 210, y: 130, width: 300, height: 180 },
      layout: { width: 1000, height: 700, framing: 'content' },
    }, '*');
  });
  it('后台标签页暂停预热和播放，回到前台采用最近的播放意图', async () => {
    const h = harness(true);
    h.listeners.get('DOMContentLoaded')?.();
    await Promise.resolve();
    h.frame(16);
    h.frame(32);
    h.document.hidden = true;
    h.listeners.get('visibilitychange')?.();
    expect(h.attributes.has('data-paused')).toBe(true);
    h.messages.get('message')?.({ source: h.window.parent, data: { type: 'cea:active', value: true, interactive: true } });
    h.time(1632);
    expect(h.attributes.has('data-paused')).toBe(true);
    h.document.hidden = false;
    h.listeners.get('visibilitychange')?.();
    expect(h.attributes.has('data-paused')).toBe(false);
    h.messages.get('message')?.({ source: h.window.parent, data: { type: 'cea:active', value: false, interactive: true } });
    h.document.hidden = true;
    h.listeners.get('visibilitychange')?.();
    h.document.hidden = false;
    h.listeners.get('visibilitychange')?.();
    expect(h.attributes.has('data-paused')).toBe(true);
  });
  it('静态缩略图先完成首帧和入场，再暂停，不会冻结空白 Canvas', async () => {
    const h = harness(true);
    const draw = vi.fn();
    h.window.requestAnimationFrame(draw);
    h.frame(16);
    expect(draw).toHaveBeenCalledOnce();
    expect(h.attributes.has('data-paused')).toBe(false);
    h.listeners.get('DOMContentLoaded')?.();
    await Promise.resolve();
    h.frame(32);
    h.frame(48);
    expect(h.attributes.has('data-paused')).toBe(false);
    h.time(1648);
    expect(h.attributes.has('data-paused')).toBe(true);
    const ready = { type: 'cea:ready', bounds: null, layout: { width: 1000, height: 700, framing: 'content' } };
    expect(h.window.parent.postMessage).toHaveBeenCalledWith(ready, '*');
    h.messages.get('message')?.({ source: h.window.parent, data: { type: 'cea:probe' } });
    expect(h.window.parent.postMessage).toHaveBeenLastCalledWith(ready, '*');
    const later = vi.fn();
    h.window.requestAnimationFrame(later);
    h.frame(1664);
    expect(later).not.toHaveBeenCalled();
  });

  it('视口改变后即使内容边界相同也重新报告测量所属的布局', async () => {
    const h = harness(true);
    h.listeners.get('DOMContentLoaded')?.();
    await Promise.resolve();
    h.frame(16);
    h.frame(32);
    h.window.parent.postMessage.mockClear();
    h.resize(390, 844);
    h.frame(48);
    expect(h.window.parent.postMessage).toHaveBeenLastCalledWith({
      type: 'cea:bounds', value: null, layout: { width: 390, height: 844, framing: 'content' },
    }, '*');
    h.messages.get('message')?.({ source: h.window.parent, data: { type: 'cea:framing', value: 'device' } });
    h.frame(64);
    expect(h.window.parent.postMessage).toHaveBeenLastCalledWith({
      type: 'cea:bounds', value: null, layout: { width: 390, height: 844, framing: 'device' },
    }, '*');
  });

  it('加载中切换播放状态采用最新指令，就绪后仍能通过互动恢复', async () => {
    const h = harness(true);
    h.messages.get('message')?.({ source: h.window.parent, data: { type: 'cea:active', value: true, interactive: true } });
    h.listeners.get('DOMContentLoaded')?.();
    await Promise.resolve();
    h.frame(16);
    h.frame(32);
    expect(h.attributes.has('data-paused')).toBe(false);
    h.messages.get('message')?.({ source: h.window.parent, data: { type: 'cea:active', value: false, interactive: true } });
    expect(h.attributes.has('data-paused')).toBe(true);
    h.listeners.get('pointerdown')?.({ isTrusted: true });
    expect(h.attributes.has('data-paused')).toBe(false);
    expect(h.window.parent.postMessage).toHaveBeenLastCalledWith({ type: 'cea:resume' }, '*');
  });

  it('暂停逐帧回调，继续时扣除暂停时长而不是跳到结束', () => {
    const h = harness();
    const callback = vi.fn();
    h.window.requestAnimationFrame(callback);
    h.frame(20);
    expect(callback).toHaveBeenLastCalledWith(20);
    callback.mockClear();
    h.window.requestAnimationFrame(callback);
    h.control.setActive(false);
    expect(h.attributes.has('data-paused')).toBe(true);
    h.frame(100);
    expect(callback).not.toHaveBeenCalled();
    h.time(150);
    h.control.setActive(true);
    h.frame(160);
    expect(callback).toHaveBeenCalledExactlyOnceWith(30);
    expect(h.attributes.has('data-paused')).toBe(false);
  });

  it('暂停期间取消的回调不会在继续后执行', () => {
    const h = harness();
    h.control.setActive(false);
    const callback = vi.fn();
    const id = h.window.requestAnimationFrame(callback);
    h.window.cancelAnimationFrame(id);
    h.control.setActive(true);
    h.frame(20);
    expect(callback).not.toHaveBeenCalled();
    expect(h.queue.size).toBe(0);
  });

  it('只恢复被预览按钮暂停的动画和媒体，保留组件自身的暂停状态', () => {
    const h = harness();
    const moving = animation();
    const stopped = animation('paused');
    const video = media();
    const stoppedVideo = media(true);
    h.animations.push(moving, stopped);
    h.players.push(video, stoppedVideo);
    h.control.setActive(false);
    expect(moving.pause).toHaveBeenCalledOnce();
    expect(stopped.pause).not.toHaveBeenCalled();
    expect(video.pause).toHaveBeenCalledOnce();
    h.control.setActive(true);
    expect(moving.play).toHaveBeenCalledOnce();
    expect(stopped.play).not.toHaveBeenCalled();
    expect(video.play).toHaveBeenCalledOnce();
    expect(stoppedVideo.play).not.toHaveBeenCalled();
  });

  it('暂停后创建的 Web Animation、CSS 过渡和媒体也暂停', () => {
    const h = harness();
    h.control.setActive(false);
    const created = new h.TestElement().animate();
    expect(created.playState).toBe('paused');
    const transition = animation();
    h.animations.push(transition);
    h.listeners.get('transitionrun')?.();
    expect(transition.playState).toBe('paused');
    const video = media();
    h.players.push(video);
    h.listeners.get('play')?.();
    expect(video.paused).toBe(true);
    h.control.setActive(true);
    expect(created.play).toHaveBeenCalledOnce();
    expect(transition.play).toHaveBeenCalledOnce();
    expect(video.play).toHaveBeenCalledOnce();
  });

  it('首次加载已暂停的预览，加载后再次同步仍会暂停晚创建的动画', () => {
    const h = harness();
    h.control.setActive(false);
    const late = animation();
    h.animations.push(late);
    h.control.setActive(false);
    expect(late.playState).toBe('paused');
    h.control.setActive(true);
    expect(late.play).toHaveBeenCalledOnce();
  });

  it.each(['pointerdown', 'keydown', 'click'])('暂停后 %s 先恢复动画和逐帧回调，再执行组件互动', event => {
    const h = harness();
    const moving = animation();
    h.animations.push(moving);
    h.control.setActive(false, true);
    const callback = vi.fn();
    h.window.requestAnimationFrame(callback);
    h.time(300);
    h.listeners.get(event)?.({ isTrusted: true });
    expect(h.attributes.has('data-paused')).toBe(false);
    expect(moving.playState).toBe('running');
    expect(new h.TestElement().animate().playState).toBe('running');
    h.frame(320);
    expect(callback).toHaveBeenCalledOnce();
    expect(h.window.parent.postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'cea:resume' }, '*');
    h.listeners.get('click')?.({ isTrusted: true });
    expect(h.window.parent.postMessage).toHaveBeenCalledOnce();
  });

  it('后台预览和脚本合成事件不会恢复播放', () => {
    const h = harness();
    h.control.setActive(false, false);
    h.listeners.get('pointerdown')?.({ isTrusted: true });
    expect(h.attributes.has('data-paused')).toBe(true);
    h.control.setActive(false, true);
    h.listeners.get('click')?.({ isTrusted: false });
    expect(h.attributes.has('data-paused')).toBe(true);
    expect(h.window.parent.postMessage).not.toHaveBeenCalled();
  });
});
