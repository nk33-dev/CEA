import vm from 'node:vm';
import { describe, it, expect, vi } from 'vitest';
import { PREVIEW_NAVIGATION_SCRIPT } from '../server/previewNavigation.ts';

function harness(overscroll: string, atBottom: boolean, options: { root?: boolean; overflow?: string } = {}) {
  const postMessage = vi.fn();
  const parent = { postMessage };
  const listeners = new Map<string, (event: unknown) => void>();
  class Element {
    parentElement = null;
    scrollWidth = 200;
    clientWidth = 200;
    scrollHeight = 600;
    clientHeight = 200;
    scrollTop = atBottom ? 400 : 0;
    scrollLeft = 0;
  }
  const target = new Element();
  vm.runInNewContext(PREVIEW_NAVIGATION_SCRIPT, {
    parent, Element, innerWidth: 1000, innerHeight: 800,
    getComputedStyle: () => ({ overflowX: options.overflow ?? 'auto', overflowY: options.overflow ?? 'auto', overscrollBehaviorX: overscroll, overscrollBehaviorY: overscroll }),
    document: { scrollingElement: options.root ? target : null, addEventListener: (name: string, fn: (event: unknown) => void) => listeners.set(name, fn) },
    addEventListener: (name: string, fn: (event: unknown) => void) => listeners.set(name, fn),
  });
  listeners.get('message')!({ source: parent, data: { type: 'cea:canvas-navigation', value: { panX: true, panY: true, zoom: true } } });
  const wheel = (deltaY: number, ctrlKey = false) => {
    const event = { target, defaultPrevented: false, deltaMode: 0, deltaX: 0, deltaY, ctrlKey, metaKey: false,
      clientX: 100, clientY: 100, preventDefault: vi.fn() };
    listeners.get('wheel')!(event);
    return event;
  };
  return { wheel, postMessage };
}

describe('iframe wheel ownership', () => {
  it.each(['contain', 'none'])('%s retains wheel input at both menu boundaries', overscroll => {
    for (const bottom of [false, true]) {
      const h = harness(overscroll, bottom);
      const event = h.wheel(bottom ? 100 : -100);
      expect(h.postMessage).not.toHaveBeenCalled();
      expect(event.preventDefault).not.toHaveBeenCalled();
    }
  });

  it('auto lets the canvas handle wheel input beyond the scroll boundary', () => {
    const h = harness('auto', true);
    expect(h.wheel(100).preventDefault).toHaveBeenCalledOnce();
    expect(h.postMessage).toHaveBeenCalledOnce();
  });

  it('native scrolling keeps wheel input while content can still move', () => {
    const h = harness('auto', false);
    expect(h.wheel(100).preventDefault).not.toHaveBeenCalled();
    expect(h.postMessage).not.toHaveBeenCalled();
  });

  it('Ctrl wheel still reaches the zoom engine inside a contained menu', () => {
    const h = harness('contain', true);
    expect(h.wheel(-100, true).preventDefault).toHaveBeenCalledOnce();
    expect(h.postMessage).toHaveBeenCalledOnce();
  });

  it.each(['hidden', 'clip'])('a root with overflow %s does not claim wheel input it cannot scroll', overflow => {
    const h = harness('contain', false, { root: true, overflow });
    expect(h.wheel(100).preventDefault).toHaveBeenCalledOnce();
    expect(h.postMessage).toHaveBeenCalledOnce();
  });

  it('a visibly scrollable document keeps native wheel input', () => {
    const h = harness('auto', false, { root: true, overflow: 'visible' });
    expect(h.wheel(100).preventDefault).not.toHaveBeenCalled();
    expect(h.postMessage).not.toHaveBeenCalled();
  });
});
