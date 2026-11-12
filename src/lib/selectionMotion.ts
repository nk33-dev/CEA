export interface SelectionBox { x: number; y: number; width: number; height: number }

export const SELECTION_TIMING: KeyframeAnimationOptions = {
  duration: 200,
  easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
};

const transform = (box: SelectionBox, scale = 1) => `translate3d(${box.x}px, ${box.y}px, 0) scaleX(${scale})`;

export function selectionFrames(from: SelectionBox, to: SelectionBox): Keyframe[] {
  return [
    { transform: transform(from, from.width / to.width) },
    { transform: transform(to) },
  ];
}

export function createSelectionMotion(element: HTMLElement, host: HTMLElement) {
  let box: SelectionBox | null = null;
  let animation: Animation | null = null;
  const stop = () => {
    animation?.cancel();
    animation = null;
  };
  return {
    move(next: SelectionBox, animate: boolean, reducedMotion: boolean) {
      if (box && next.x === box.x && next.y === box.y && next.width === box.width && next.height === box.height) return;
      let from = box;
      if (animation && animate && !reducedMotion) {
        const current = element.getBoundingClientRect();
        const parent = host.getBoundingClientRect();
        from = { x: current.left - parent.left - host.clientLeft, y: current.top - parent.top - host.clientTop, width: current.width, height: current.height };
      }
      stop();
      element.style.width = `${next.width}px`;
      element.style.height = `${next.height}px`;
      element.style.transform = transform(next);
      element.hidden = false;
      host.dataset.selectionReady = '';
      box = next;
      if (!from || !animate || reducedMotion || !element.animate) return;
      animation = element.animate(selectionFrames(from, next), SELECTION_TIMING);
      const current = animation;
      current.onfinish = () => { if (animation === current) animation = null; };
    },
    finish: stop,
    reset() {
      stop();
      box = null;
      element.hidden = true;
      delete host.dataset.selectionReady;
    },
    destroy() {
      stop();
      delete host.dataset.selectionReady;
    },
  };
}
