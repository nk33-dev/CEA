import { uiText, useUi } from '../lib/uiI18n.ts';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import BatteryFull from 'lucide-react/icons/battery-full';
import ChevronDown from 'lucide-react/icons/chevron-down';
import Monitor from 'lucide-react/icons/monitor';
import Scan from 'lucide-react/icons/scan';
import RotateCcw from 'lucide-react/icons/rotate-ccw';
import RotateCw from 'lucide-react/icons/rotate-cw';
import RotateCwSquare from 'lucide-react/icons/rotate-cw-square';
import Signal from 'lucide-react/icons/signal';
import Smartphone from 'lucide-react/icons/smartphone';
import SlidersHorizontal from 'lucide-react/icons/sliders-horizontal';
import Trash2 from 'lucide-react/icons/trash-2';
import Wifi from 'lucide-react/icons/wifi';
import { DEVICE_VIEWPORTS, type PreviewBounds, type PreviewDevice, type PreviewLayout, type PreviewViewport } from '../../shared/preview.ts';
import { deviceSizeSchema } from '../../shared/configuration.ts';
import { useDeviceSettings } from '../lib/deviceSettings.ts';
import { SelectControl } from './SelectControl.tsx';
import { Dialog } from './Dialog.tsx';
import { ChoiceControl } from './ChoiceControl.tsx';
import { TransformComponent, TransformWrapper, useControls, useTransformComponent } from 'react-zoom-pan-pinch';

/**
 * 预览设备的临时状态，不保存。
 * swapped 交换宽高：设备外形跟着变，页面按新尺寸重新排版，内容保持正向。
 * angle 设备转过的角度，可以是任意值；autoRotate 开启时和真机一样，转过 45° 画面跟着转正并按横屏排版。
 * zoom 为 'fit' 时按预览区自动缩放，数字是实际比例，1 表示 1 个 CSS 像素占 1 个屏幕像素。
 */
export interface DeviceView { device: PreviewDevice; framing?: 'content' | 'device'; swapped: boolean; angle: number; autoRotate: boolean; zoom: number | 'fit'; rotating?: boolean; fitRequest?: number; centerRequest?: number; panMode?: boolean }

export const DEFAULT_DEVICE_VIEW: DeviceView = { device: 'desktop', framing: 'content', swapped: false, angle: 0, autoRotate: true, zoom: 'fit' };

/** 当前设备的视口：用户选的尺寸，交换宽高后的结果 */
export function useDeviceViewport(view: DeviceView): PreviewViewport {
  const [settings] = useDeviceSettings();
  const base = settings.viewports[view.device];
  return view.swapped ? { width: base.height, height: base.width } : base;
}

export function DeviceControl({ view, onChange }: {
  view: DeviceView; onChange: (view: DeviceView) => void;
}) {
  useUi();
  const value = view.device;
  const [settings, setSettings] = useDeviceSettings();
  const viewport = settings.viewports[value];
  const presets = settings.presets.filter(p => p.device === value);
  const builtin = DEVICE_VIEWPORTS[value];
  const matches = (size: PreviewViewport) => size.width === viewport.width && size.height === viewport.height;
  const selected = presets.find(matches)?.id ?? (matches(builtin) ? 'default' : 'custom');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ id: '', name: '', width: '', height: '', ratio: 'free' });
  const [error, setError] = useState('');
  const parsed = deviceSizeSchema.safeParse({ width: Number(draft.width), height: Number(draft.height) });
  const openEditor = () => {
    const preset = presets.find(p => p.id === selected);
    setDraft({ id: preset?.id ?? '', name: preset?.name ?? '', width: String(viewport.width), height: String(viewport.height), ratio: 'free' });
    setError('');
    setEditing(true);
  };
  const updateViewport = (size: PreviewViewport) => {
    try { setSettings({ ...settings, viewports: { ...settings.viewports, [value]: { width: size.width, height: size.height } } }); setError(''); }
    catch { setError(uiText("设置没有保存，请检查浏览器存储空间")); }
  };
  const apply = (save: boolean) => {
    if (!parsed.success || (save && !draft.name.trim())) return;
    try {
      const preset = { ...parsed.data, id: draft.id || `user-${crypto.randomUUID()}`, name: draft.name.trim(), device: value };
      setSettings({
        ...settings, viewports: { ...settings.viewports, [value]: parsed.data },
        presets: save ? [...settings.presets.filter(p => p.id !== draft.id), preset] : settings.presets,
      });
      setEditing(false);
      setError('');
    } catch { setError(uiText("设置没有保存，请检查名称、预设数量和浏览器存储空间")); }
  };
  const resize = (width: string, height: string, ratio = draft.ratio) => {
    const [a, b] = ratio.split(':').map(Number);
    setDraft({ ...draft, width, height: ratio === 'free' || !Number(width) ? height : String(Math.round(Number(width) * b / a)), ratio });
  };
  const pick = (mode: PreviewDevice | 'content') => onChange({
    ...view, device: mode === 'content' ? 'desktop' : mode, framing: mode === 'content' ? 'content' : 'device', swapped: false, angle: 0, zoom: 'fit',
  });
  // 尺寸文字按交换后的实际宽高显示
  const size = (s: PreviewViewport) => view.swapped ? `${s.height} × ${s.width}` : `${s.width} × ${s.height}`;
  return <div className="device-controls">
    <ChoiceControl label={uiText("预览设备")} value={view.framing === 'content' ? 'content' : value} onChange={pick} options={[
      { value: 'content', label: <><Scan size={14} aria-hidden="true" />{uiText("组件")}</> },
      { value: 'desktop', label: <><Monitor size={14} aria-hidden="true" />{uiText("电脑")}</> },
      { value: 'phone', label: <><Smartphone size={14} aria-hidden="true" />{uiText("手机")}</> },
    ]} />
    {view.framing !== 'content' && <>
    <SelectControl label={uiText("设备尺寸")} value={selected} onValueChange={id => {
      if (id === 'swap') onChange({ ...view, swapped: !view.swapped });
      else if (id === 'custom') openEditor();
      else updateViewport(id === 'default' ? builtin : presets.find(p => p.id === id)!);
    }} options={[
      { value: 'default', label: uiText("默认 · {{value0}}", {value0: size(builtin)}) },
      ...presets.map(p => ({ value: p.id, label: `${p.name} · ${size(p)}` })),
      { value: 'custom', label: selected === 'custom' ? uiText("自定义 · {{value0}}", {value0: size(viewport)}) : uiText("自定义尺寸…") },
      { value: 'swap', label: uiText("交换宽高"), note: view.swapped ? uiText("已交换") : undefined, separated: true },
    ]} />
    <RotateControl view={view} onChange={onChange} />
    <button type="button" className="icon-btn icon-btn-sm" aria-label={uiText("预览设置")} title={uiText("预览设置")} onClick={openEditor}><SlidersHorizontal size={15} aria-hidden="true" /></button>
    </>}
    {!editing && error && <span className="form-error" role="alert">{error}</span>}
    <Dialog open={editing} onClose={() => setEditing(false)} title={uiText("预览设置")} footer={<>
      <button type="button" className="btn btn-quiet" disabled={!parsed.success} onClick={() => apply(false)}>{uiText("应用尺寸")}</button>
      <button type="button" className="btn btn-dark" disabled={!parsed.success || !draft.name.trim()} onClick={() => apply(true)}>{draft.id ? uiText("更新预设") : uiText("保存预设")}</button>
    </>}>
      <div className="device-size-form">
        <div className="device-size-fields">
          <label className="field"><span>{uiText("宽度")}</span><input type="number" min="240" max="3840" step="1" value={draft.width}
            onChange={e => resize(e.target.value, draft.height)} /></label>
          <span className="device-size-times" aria-hidden="true">×</span>
          <label className="field"><span>{uiText("高度")}</span><input type="number" min="240" max="3840" step="1" value={draft.height}
            onChange={e => setDraft({ ...draft, height: e.target.value, ratio: 'free' })} /></label>
        </div>
        <label className="field"><span>{uiText("屏幕比例")}</span><SelectControl label={uiText("屏幕比例")} value={draft.ratio}
          onValueChange={ratio => resize(draft.width, draft.height, ratio)} fullWidth options={[
            { value: 'free', label: uiText("自由尺寸") }, { value: '9:16', label: '9 : 16' }, { value: '9:19.5', label: '9 : 19.5' },
            { value: '3:4', label: '3 : 4' }, { value: '16:9', label: '16 : 9' },
          ]} /></label>
        <label className="field"><span>{uiText("预设名称")}</span><input value={draft.name} maxLength={40} placeholder={uiText("如 我的手机")}
          onChange={e => setDraft({ ...draft, name: e.target.value })} /></label>
        {!parsed.success && <p className="form-error" role="alert">{uiText("宽高范围为 240–3840，使用整数。")}</p>}
        {error && <p className="form-error" role="alert">{error}</p>}
        {presets.length > 0 && <div className="device-saved-presets">
          <h3>{uiText("已保存的")}{value === 'phone' ? uiText("手机") : uiText("电脑")}{uiText("尺寸")}</h3>
          {presets.map(p => <div className="device-preset-row" key={p.id}>
            <button type="button" className="device-preset-edit" onClick={() => setDraft({ id: p.id, name: p.name, width: String(p.width), height: String(p.height), ratio: 'free' })}>
              <span>{p.name}</span><small>{p.width} × {p.height}</small>
            </button>
            <button type="button" className="icon-btn icon-btn-sm" aria-label={uiText("移除预设 {{value0}}", {value0: p.name})} title={uiText("移除预设")} onClick={() => {
              try {
                setSettings({ ...settings, presets: settings.presets.filter(item => item.id !== p.id) });
                if (draft.id === p.id) setDraft({ ...draft, id: '', name: '' });
              } catch { setError(uiText("预设没有移除，请检查浏览器存储空间")); }
            }}><Trash2 size={14} /></button>
          </div>)}
        </div>}
      </div>
    </Dialog>
  </div>;
}

/** 外壳和状态栏放在页面视口之外；配置尺寸就是 iframe 的 CSS 像素尺寸。 */
const BEZEL = { phone: { side: 11, top: 61 }, desktop: { side: 1, top: 30 } } as const;
const ROOM = 32;
const MAX_ZOOM = 3;

/** 角度换算到 (-180, 180]，显示和判断方向用；状态里保留累加值，动画始终朝点击的方向转 */
export function normalizeAngle(angle: number) {
  const a = ((((angle + 180) % 360) + 360) % 360) - 180;
  return a === -180 ? 180 : a;
}

/** 转过 45° 后按最近的直角转正；180° 不交换宽高。 */
function screenTurn(angle: number) {
  const a = normalizeAngle(angle);
  if (Math.abs(a) <= 45) return 0;
  if (Math.abs(a) <= 135) return a > 0 ? 90 : -90;
  return a > 0 ? 180 : -180;
}

/**
 * 按真实视口渲染设备，再放进预览区。
 * 缩放、旋转和平移都只改 transform，组件不会重新排版，也不改变任何元素的尺寸，所以不会抖、不出现滚动条；
 * 放大后拖动空白处、滚轮或右侧和底部的细条都能移动画面，Ctrl/⌘ + 滚轮（触控板双指捏合）以指针位置缩放。
 * 只有换设备、改尺寸，以及开启「画面自动转正」后转过 45° 时，页面才按新的宽高重新排版，这和真机一致。
 * 全屏按实际窗口排版，设备外壳不参与全屏尺寸。
 */
export function DevicePreview({ view, fullscreen = false, active = true, bounds, boundsLayout, onFitScale, onZoomChange, children }: {
  view: DeviceView;
  active?: boolean;
  fullscreen?: boolean;
  bounds?: PreviewBounds | null;
  boundsLayout?: PreviewLayout;
  onFitScale?: (scale: number) => void;
  onZoomChange?: (zoom: number) => void;
  children: React.ReactNode;
}) {
  useUi();
  return <TransformWrapper minScale={0.05} maxScale={MAX_ZOOM} centerZoomedOut disablePadding smooth={false}
    doubleClick={{ disabled: true }} velocityAnimation={{ disabled: true }}
    autoAlignment={{ disabled: true, animationTime: 0 }} zoomAnimation={{ disabled: true }}
    wheel={{ disabled: false, activationKeys: keys => keys.includes('Control') || keys.includes('Meta') }}
    trackPadPanning={{ disabled: false, activationKeys: keys => !keys.includes('Control') && !keys.includes('Meta'), velocityDisabled: true }}
    onWheel={(ref, event) => { if (event.ctrlKey || event.metaKey) onZoomChange?.(ref.state.scale); }}
    onPinch={ref => onZoomChange?.(ref.state.scale)}
    pinch={{ disabled: false }} panning={{ disabled: false, velocityDisabled: true, allowRightClickPan: false }}>
    <DevicePreviewCanvas view={view} fullscreen={fullscreen} active={active} bounds={bounds} boundsLayout={boundsLayout} onFitScale={onFitScale}>{children}</DevicePreviewCanvas>
  </TransformWrapper>;
}

function DevicePreviewCanvas({ view, fullscreen = false, active, bounds: reportedBounds, boundsLayout, onFitScale, children }: {
  view: DeviceView;
  active: boolean;
  fullscreen?: boolean;
  bounds?: PreviewBounds | null;
  boundsLayout?: PreviewLayout;
  onFitScale?: (scale: number) => void;
  children: React.ReactNode;
}) {
  useUi();
  const controls = useControls();
  const transform = useTransformComponent(({ state }) => ({ scale: state.scale, x: state.positionX, y: state.positionY }));
  const deviceViewport = useDeviceViewport(view);
  const host = useRef<HTMLDivElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<PreviewViewport | null>(null);
  useLayoutEffect(() => {
    const instance = controls.instance;
    // display:none 的 Tab 不参与库的边界对齐；再次显示时沿用原来的缩放与位置。
    if (!active) instance.observer?.disconnect();
    else if (instance.wrapperComponent && instance.contentComponent) {
      instance.observeSizes(instance.wrapperComponent, instance.contentComponent);
      // 组件内容会自行变形；库只观察工作区尺寸，不随每一帧内容尺寸重新居中。
      if (!fullscreen && view.framing === 'content') instance.observer?.unobserve(instance.contentComponent);
    }
  }, [active, controls.instance, fullscreen, view.framing]);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      // 隐藏 Tab 的零尺寸不能覆盖已测量的比例，否则重新显示时会先缩小再放大。
      if (width > 0 && height > 0) setBox({ width, height });
    });
    observer.observe(host.current!);
    return () => observer.disconnect();
  }, []);

  const physical = fullscreen && box ? { width: Math.round(box.width), height: Math.round(box.height) } : deviceViewport;
  const inspect = !fullscreen && view.framing === 'content';
  const bounds = !boundsLayout || boundsLayout.width === physical.width && boundsLayout.height === physical.height &&
    boundsLayout.framing === (view.framing ?? 'device') ? reportedBounds : undefined;
  const bezel = fullscreen || inspect ? { side: 0, top: 0 } : BEZEL[view.device];
  const room = fullscreen ? 0 : ROOM;
  const angle = fullscreen || inspect ? 0 : view.angle;
  const turn = !inspect && view.autoRotate ? screenTurn(angle) : 0;
  const content = Math.abs(turn) === 90 ? { width: physical.height, height: physical.width } : physical;
  const shell = { width: physical.width + bezel.side * 2, height: physical.height + bezel.top + bezel.side };
  // 转到任意角度时按外接矩形算大小
  const rad = (angle * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const focus = inspect && bounds ? bounds : { x: 0, y: 0, ...shell };
  const outer = { width: focus.width * cos + focus.height * sin, height: focus.width * sin + focus.height * cos };
  const fit = box ? Math.max(0.05, Math.min(1, (box.width - room * 2) / outer.width, (box.height - room * 2) / outer.height)) : 0;
  // 素材内部尺寸变化不驱动外层缩放；窗口变化或再次点击适应时才重新取景。
  const fitKey = `${fullscreen}:${view.framing}:${view.device}:${physical.width}x${physical.height}:${box?.width}x${box?.height}:${view.fitRequest}:${Boolean(inspect && bounds)}:${view.zoom === 'fit'}`;
  const [fitted, setFitted] = useState({ key: fitKey, scale: fit });
  if (fitted.key !== fitKey) setFitted({ key: fitKey, scale: fit });
  const fittedScale = fitted.key === fitKey ? fitted.scale : fit;
  const requestedScale = view.zoom === 'fit' ? fittedScale : view.zoom;
  const scale = transform.scale;

  const report = useRef(onFitScale);
  report.current = onFitScale;
  useEffect(() => { if (fittedScale) report.current?.(Math.round(fittedScale * 100) / 100); }, [fittedScale]);

  // 平移：设备中心相对预览区中心的偏移。只在设备比预览区大的方向上可以移动
  const limit = {
    x: box ? Math.max(0, (outer.width * scale - box.width) / 2) : 0,
    y: box ? Math.max(0, (outer.height * scale - box.height) / 2) : 0,
  };
  const pan = {
    x: transform.x - ((box?.width ?? 0) - outer.width * scale) / 2,
    y: transform.y - ((box?.height ?? 0) - outer.height * scale) / 2,
  };
  const sendVisibleArea = useRef<(frame: HTMLIFrameElement) => void>(() => {});
  sendVisibleArea.current = frame => {
    const hostElement = host.current;
    if (!active || !hostElement || !frame.clientWidth || !frame.clientHeight || !hostElement.clientWidth || !hostElement.clientHeight) return;
    const area = hostElement.getBoundingClientRect();
    const rect = frame.getBoundingClientRect();
    const matrix = [hostElement.querySelector('.device-stage'), shellRef.current, contentRef.current]
      .reduce((value, element) => value.multiply(new DOMMatrix(getComputedStyle(element!).transform)), new DOMMatrix());
    matrix.e = 0;
    matrix.f = 0;
    const inverse = matrix.inverse();
    const corners = [area.left, area.right].flatMap(x => [area.top, area.bottom].map(y =>
      new DOMPoint(x - rect.x - rect.width / 2, y - rect.y - rect.height / 2).matrixTransform(inverse)));
    const x = Math.max(0, frame.clientWidth / 2 + Math.min(...corners.map(point => point.x)));
    const y = Math.max(0, frame.clientHeight / 2 + Math.min(...corners.map(point => point.y)));
    const right = Math.min(frame.clientWidth, frame.clientWidth / 2 + Math.max(...corners.map(point => point.x)));
    const bottom = Math.min(frame.clientHeight, frame.clientHeight / 2 + Math.max(...corners.map(point => point.y)));
    frame.contentWindow?.postMessage({ type: 'cea:visible-area', value: { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) } }, '*');
  };
  useLayoutEffect(() => {
    host.current?.querySelectorAll('iframe').forEach(frame => sendVisibleArea.current(frame));
  }, [transform.x, transform.y, scale, box?.width, box?.height, angle, turn, focus.x, focus.y, focus.width, focus.height, active]);
  useEffect(() => {
    const hostElement = host.current!;
    const send = (frame: HTMLIFrameElement) => frame.contentWindow?.postMessage({
      type: 'cea:canvas-navigation', value: { panX: limit.x > 0, panY: limit.y > 0, zoom: true },
    }, '*');
    const forward = (event: WheelEvent) => {
      const wrapper = controls.instance.wrapperComponent;
      if (!wrapper) return;
      const navigation = event.ctrlKey || event.metaKey || limit.x > 0 || limit.y > 0;
      if (!navigation) { event.stopPropagation(); return; }
      if (wrapper.contains(event.target as Node)) return;
      event.preventDefault();
      wrapper.dispatchEvent(new WheelEvent('wheel', {
        deltaX: event.deltaX, deltaY: event.deltaY, deltaMode: event.deltaMode,
        clientX: event.clientX, clientY: event.clientY, ctrlKey: event.ctrlKey, metaKey: event.metaKey, bubbles: true, cancelable: true,
      }));
    };
    const receive = (event: MessageEvent) => {
      const frame = [...hostElement.querySelectorAll('iframe')].find(frame => frame.contentWindow === event.source && frame.getAttribute('aria-hidden') !== 'true');
      if (!frame) return;
      if (event.data?.type === 'cea:ready' || event.data?.type === 'cea:boot') { send(frame); sendVisibleArea.current(frame); return; }
      const value = event.data?.value;
      if (event.data?.type !== 'cea:canvas-wheel' || !value || ![value.dx, value.dy, value.x, value.y].every(Number.isFinite)) return;
      const rect = frame.getBoundingClientRect();
      controls.instance.wrapperComponent?.dispatchEvent(new WheelEvent('wheel', {
        deltaX: value.dx, deltaY: value.dy, clientX: rect.x + value.x * rect.width, clientY: rect.y + value.y * rect.height,
        ctrlKey: value.ctrlKey === true, metaKey: value.metaKey === true, bubbles: true, cancelable: true,
      }));
    };
    hostElement.querySelectorAll('iframe').forEach(send);
    hostElement.addEventListener('wheel', forward, { passive: false, capture: true });
    window.addEventListener('message', receive);
    return () => {
      hostElement.removeEventListener('wheel', forward, true);
      window.removeEventListener('message', receive);
    };
  }, [limit.x > 0, limit.y > 0, controls.instance]);
  const turnFade = useRef<Animation | null>(null);
  useEffect(() => () => {
    turnFade.current?.cancel();
  }, []);

  const layout = `${fullscreen}:${view.framing}:${view.device}:${physical.width}x${physical.height}`;
  const contentRef = useRef<HTMLDivElement>(null);
  const last = useRef({ layout, angle, turn, width: outer.width, height: outer.height, hostWidth: 0, hostHeight: 0, centerRequest: view.centerRequest, fitRequest: view.fitRequest, measured: Boolean(bounds) });
  useLayoutEffect(() => {
    if (!box || !requestedScale || !controls.instance.isInitialized) return;
    const prev = last.current;
    last.current = { layout, angle, turn, width: outer.width, height: outer.height, hostWidth: box.width, hostHeight: box.height, centerRequest: view.centerRequest, fitRequest: view.fitRequest, measured: Boolean(bounds) };
    const resized = prev.layout !== layout || !inspect && (prev.width !== outer.width || prev.height !== outer.height);
    const hostResized = prev.hostWidth !== box.width || prev.hostHeight !== box.height;
    const refit = prev.fitRequest !== view.fitRequest || !prev.measured && Boolean(bounds) || !prev.hostWidth || view.zoom === 'fit' && hostResized;
    if (prev.centerRequest !== view.centerRequest && !resized) {
      void controls.centerView(undefined, 0);
      return;
    }
    if (resized || refit) {
      void controls.setTransform((box.width - outer.width * requestedScale) / 2, (box.height - outer.height * requestedScale) / 2, requestedScale, 0);
    } else if (prev.hostWidth && (prev.hostWidth !== box.width || prev.hostHeight !== box.height)) {
      void controls.setTransform(controls.state.positionX + (box.width - prev.hostWidth) / 2,
        controls.state.positionY + (box.height - prev.hostHeight) / 2, requestedScale, 0);
    } else if (Math.abs(controls.state.scale - requestedScale) > 0.0001) {
      const rect = host.current!.getBoundingClientRect();
      void controls.zoomToPoint(requestedScale, rect.x + rect.width / 2, rect.y + rect.height / 2, 0);
    }
    if (prev.layout !== layout) {
      turnFade.current?.cancel();
      return;
    }
    if (prev.turn !== turn && !view.rotating && !reducedMotion()) {
      // 画面转正后页面按新宽高重新排版，和真机一样淡入新画面
      turnFade.current?.cancel();
      turnFade.current = contentRef.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260, delay: 120, easing: 'ease-out', fill: 'backwards' }) ?? null;
    }
  }, [layout, requestedScale, angle, turn, outer.width, outer.height, box?.width, box?.height, view.zoom, view.fitRequest, view.centerRequest, fullscreen]);

  useEffect(() => {
    const reveal = (event: MessageEvent) => {
      const el = host.current;
      if (!el || event.data?.type !== 'cea:focus') return;
      const frame = [...el.querySelectorAll('iframe')].find(frame => frame.contentWindow === event.source && frame.getAttribute('aria-hidden') !== 'true');
      const value = event.data.value as PreviewBounds | undefined;
      if (!frame || !value || ![value.x, value.y, value.width, value.height].every(Number.isFinite) || value.width <= 0 || value.height <= 0) return;
      const rect = frame.getBoundingClientRect();
      const area = el.getBoundingClientRect();
      const matrix = [el.querySelector('.device-stage'), shellRef.current, contentRef.current]
        .reduce((matrix, element) => matrix.multiply(new DOMMatrix(getComputedStyle(element!).transform)), new DOMMatrix());
      matrix.e = 0;
      matrix.f = 0;
      const corners = [value.x, value.x + value.width].flatMap(x => [value.y, value.y + value.height].map(y =>
        new DOMPoint(x - frame.clientWidth / 2, y - frame.clientHeight / 2).matrixTransform(matrix)));
      const left = rect.x + rect.width / 2 + Math.min(...corners.map(point => point.x));
      const right = rect.x + rect.width / 2 + Math.max(...corners.map(point => point.x));
      const top = rect.y + rect.height / 2 + Math.min(...corners.map(point => point.y));
      const bottom = rect.y + rect.height / 2 + Math.max(...corners.map(point => point.y));
      const dx = left < area.left + 12 ? area.left + 12 - left : right > area.right - 12 ? area.right - 12 - right : 0;
      const dy = top < area.top + 12 ? area.top + 12 - top : bottom > area.bottom - 12 ? area.bottom - 12 - bottom : 0;
      if (!dx && !dy) return;
      void controls.panBy(dx, dy, 0);
    };
    window.addEventListener('message', reveal);
    return () => window.removeEventListener('message', reveal);
  }, [controls.instance]);

  // 按住空格时临时让拖拽交给画布，不触发 iframe 内的组件。
  const [spaceHeld, setSpaceHeld] = useState(false);
  const hovered = useRef(false);
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || !hovered.current || e.repeat) return;
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, button, [contenteditable="true"]')) return;
      e.preventDefault();
      setSpaceHeld(true);
    };
    const up = (e: KeyboardEvent) => { if (e.code === 'Space') setSpaceHeld(false); };
    const blur = () => setSpaceHeld(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur); };
  }, []);

  const [dragging, setDragging] = useState(false);
  const canPan = limit.x > 0 || limit.y > 0;
  const startDrag = (e: React.PointerEvent, map: (dx: number, dy: number) => { x: number; y: number }) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const start = { x: e.clientX, y: e.clientY };
    setDragging(true);
    const move = (ev: PointerEvent) => {
      const d = map(ev.clientX - start.x, ev.clientY - start.y);
      void controls.panBy(d.x, d.y, 0);
      start.x = ev.clientX;
      start.y = ev.clientY;
    };
    const end = () => {
      setDragging(false);
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', end);
      target.removeEventListener('pointercancel', end);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', end);
    target.addEventListener('pointercancel', end);
  };

  // 悬浮的位置条：不占布局，只在可以移动的方向显示
  const bars = box && canPan ? (['x', 'y'] as const).filter(axis => limit[axis] > 0).map(axis => {
    const size = axis === 'x' ? box.width : box.height;
    const full = (axis === 'x' ? outer.width : outer.height) * scale;
    const track = size - 12;
    const thumb = Math.max(32, track * (size / full));
    const at = ((limit[axis] - pan[axis]) / (limit[axis] * 2)) * (track - thumb);
    const perPixel = (limit[axis] * 2) / (track - thumb);
    return <span key={axis} className={`device-pan-bar is-${axis}`} aria-hidden="true"
      style={axis === 'x' ? { left: 6 + at, width: thumb } : { top: 6 + at, height: thumb }}
      onPointerDown={e => { e.stopPropagation(); startDrag(e, (dx, dy) => axis === 'x' ? { x: -dx * perPixel, y: 0 } : { x: 0, y: -dy * perPixel }); }} />;
  }) : null;

  const physicalLandscape = physical.width > physical.height;
  const contentLandscape = content.width > content.height;
  return <div ref={host}
    className={`device-preview${fullscreen ? ' is-fullscreen' : ''}${inspect ? ' is-content' : ''}${view.rotating || inspect || dragging ? ' is-direct' : ''}${spaceHeld || view.panMode ? ' is-space' : ''}${canPan ? ' can-pan' : ''}${dragging ? ' is-panning' : ''}`}
    onPointerEnter={() => { hovered.current = true; }} onPointerLeave={() => { hovered.current = false; }}>
    <TransformComponent wrapperClass="device-transform-viewport" contentClass="device-stage"
      wrapperStyle={{ width: '100%', height: '100%', overflow: 'clip' }}
      contentStyle={{ width: outer.width, height: outer.height, opacity: !box || (inspect && bounds === undefined) ? 0 : 1 }}>
      <div ref={shellRef} className={`device-shell device-shell-${view.device}`}
        style={{ width: shell.width, height: shell.height, left: outer.width / 2 - focus.x - focus.width / 2, top: outer.height / 2 - focus.y - focus.height / 2, transform: `rotate(${angle}deg)` }}>
        {!fullscreen && !inspect && view.device === 'desktop' && <div className="device-titlebar" aria-hidden="true"><i /><i /><i /></div>}
        {!fullscreen && !inspect && view.device === 'phone' && <>
          <PhoneStatus landscape={contentLandscape} />
          <span className="phone-island" aria-hidden="true" />
        </>}
        <div className={`device-screen device-screen-${view.device}${physicalLandscape ? ' is-landscape' : ''}`} style={{ width: physical.width, height: physical.height }}>
          <div ref={contentRef} className={`device-content${contentLandscape ? ' is-landscape' : ''}`} style={{
            width: content.width, height: content.height,
            left: (physical.width - content.width) / 2, top: (physical.height - content.height) / 2,
            transform: `rotate(${-turn}deg)`,
          }}>
            <div className="device-page">{children}</div>
          </div>
        </div>
      </div>
    </TransformComponent>
    {bars}
  </div>;
}

function reducedMotion() {
  return matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** 装饰状态栏不占页面高度，也不遮挡 iframe 中的控件。 */
function PhoneStatus({ landscape }: { landscape: boolean }) {
  useUi();
  return <div className="phone-status" aria-hidden="true">
    {!landscape && <>
    <span className="phone-time">9:41</span>
    <span className="phone-icons"><Signal size={15} strokeWidth={2.4} /><Wifi size={15} strokeWidth={2.4} /><BatteryFull size={19} strokeWidth={1.8} /></span>
    </>}
  </div>;
}

/**
 * 旋转设备：±90° 快捷按钮和任意角度的滑杆。
 * 「画面自动转正」开启时和真机一样，转过 45° 画面跟着转正并按横屏排版；关闭时画面和设备一起转。
 */
function RotateControl({ view, onChange }: { view: DeviceView; onChange: (view: DeviceView) => void }) {
  useUi();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const [shift, setShift] = useState(0);
  const trigger = useRef<HTMLButtonElement>(null);
  const current = useRef({ view, onChange });
  current.current = { view, onChange };
  const frame = useRef(0);
  const pendingAngle = useRef<number | null>(null);
  const [draftAngle, setDraftAngle] = useState<number | null>(null);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = popup.current?.getBoundingClientRect();
      if (!rect) return;
      const width = document.documentElement.clientWidth;
      const delta = rect.left < 12 ? 12 - rect.left : rect.right > width - 12 ? width - 12 - rect.right : 0;
      if (delta) setShift(value => value + delta);
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open]);
  const finish = () => {
    cancelAnimationFrame(frame.current);
    frame.current = 0;
    const latest = current.current;
    if (pendingAngle.current !== null || latest.view.rotating) {
      latest.onChange({ ...latest.view, angle: pendingAngle.current ?? latest.view.angle, rotating: false });
    }
    pendingAngle.current = null;
    setDraftAngle(null);
  };
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { finish(); setOpen(false); trigger.current?.focus(); } };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', key); };
  }, [open]);
  const shown = draftAngle ?? normalizeAngle(view.angle);
  const turnBy = (delta: number) => onChange({ ...view, angle: view.angle + delta, rotating: false });
  return <div className="rotate-control" ref={wrap}>
    <div className="rotate-shortcut">
      <button type="button" className="icon-btn icon-btn-sm" aria-label={uiText("向右旋转设备 90°")} title={uiText("向右旋转 90°")}
        onClick={() => turnBy(90)}><RotateCwSquare size={15} aria-hidden="true" /></button>
      <button ref={trigger} type="button" className="icon-btn icon-btn-sm rotate-expand" aria-label={uiText("旋转设置")} title={uiText("旋转设置")} aria-expanded={open}
        onClick={() => setOpen(o => !o)}><ChevronDown size={12} aria-hidden="true" /></button>
    </div>
    {open && <div ref={popup} className="rotate-pop option-surface" style={{ marginLeft: shift }} role="group" aria-label={uiText("旋转设备")}>
      <div className="rotate-head">
        <span>{uiText("旋转")}</span>
        <output className="rotate-angle">{shown}°</output>
      </div>
      <div className="rotate-row">
        <button type="button" className="icon-btn icon-btn-sm" aria-label={uiText("向左转 90°")} title={uiText("向左转 90°")} onClick={() => turnBy(-90)}><RotateCcw size={15} aria-hidden="true" /></button>
        <input type="range" className="rotate-range" min={-180} max={180} step={1} value={shown} aria-label={uiText("旋转角度")}
          onPointerDown={() => onChange({ ...view, rotating: true })}
          onPointerUp={finish} onPointerCancel={finish} onBlur={finish} onKeyUp={finish}
          onChange={e => {
            let next = Number(e.target.value);
            // 靠近 0° 和 ±90° 时吸附，方便摆正
            for (const snap of [-180, -90, 0, 90, 180]) if (Math.abs(next - snap) <= 3) next = snap;
            setDraftAngle(next);
            const latest = current.current.view;
            pendingAngle.current = latest.angle + next - normalizeAngle(latest.angle);
            if (!frame.current) frame.current = requestAnimationFrame(() => {
              frame.current = 0;
              const state = current.current;
              state.onChange({ ...state.view, angle: pendingAngle.current ?? state.view.angle, rotating: true });
            });
          }} />
        <button type="button" className="icon-btn icon-btn-sm" aria-label={uiText("向右转 90°")} title={uiText("向右转 90°")} onClick={() => turnBy(90)}><RotateCw size={15} aria-hidden="true" /></button>
      </div>
      <label className="rotate-auto">
        <input type="checkbox" checked={view.autoRotate} onChange={e => onChange({ ...view, autoRotate: e.target.checked })} />
        <span>{uiText("画面自动转正")}</span>
      </label>
      <button type="button" className="rotate-reset" disabled={shown === 0} onClick={() => turnBy(-shown)}>{uiText("回正")}</button>
    </div>}
  </div>;
}
