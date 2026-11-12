import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { playPath } from '../../shared/paths.ts';
import { CARD_VIEWPORT, fitPreview, previewKind, previewScale, thumbnailTransform, type PreviewBounds, type PreviewDevice, type PreviewFraming, type PreviewViewport } from '../../shared/preview.ts';
import { usePreviewActivity } from './PreviewActivity.tsx';

export type StageTheme = 'light' | 'dark';

const SANDBOX = 'allow-scripts allow-forms allow-modals allow-pointer-lock';

interface StageProps {
  /** 已保存素材传 id，草稿传 /play/~draft/... 地址 */
  assetId?: string;
  /** 播放哪个框架的实现，不传时播放第一个 */
  framework?: string;
  src?: string;
  title: string;
  theme?: StageTheme;
  componentTheme?: StageTheme | 'original';
  /** 变化时重新加载（重播） */
  reloadKey?: number | string;
  /** 内容版本，变化时绕过缓存 */
  version?: string;
  className?: string;
  /** 卡片里的预览不接收键盘焦点，避免 Tab 键陷进几十个 iframe */
  inert?: boolean;
  active?: boolean;
  onResume?: () => void;
  zoom?: number;
  onReady?: () => void;
  loadingIndicator?: boolean;
  viewport?: PreviewViewport | null;
  device?: PreviewDevice;
  framing?: PreviewFraming;
  /** 内容实际占的区域，列表缩略图用来裁掉舞台留白 */
  onBounds?: (bounds: PreviewBounds | null) => void;
  visibleArea?: PreviewBounds | null;
  thumbnail?: boolean;
}

/**
 * 所有素材都通过统一的 /play/<id>/<framework>/ 地址播放，HTML、React、Vue 一样。
 * iframe 在沙箱里运行，主题通过 postMessage 切换，不用重新加载。
 */
export const Stage = memo(function Stage({ assetId, framework, src, title, theme = 'light', componentTheme = 'original', reloadKey = 0, version, className, inert, active = true, onResume, onReady, onBounds, visibleArea, loadingIndicator = true, device = 'desktop', framing = 'content', thumbnail = false }: StageProps) {
  const [initialTheme] = useState(theme);
  const [initialComponentTheme] = useState(componentTheme);
  const [initialActive] = useState(active);
  const [initialInteractive] = useState(!!onResume);
  const [initialDevice] = useState(device);
  const [initialFraming] = useState(framing);
  // 草稿地址也带上初始状态，编辑页的卡片样张和列表缩略图一样先播完入场再暂停
  const query = `theme=${initialTheme}&componentTheme=${initialComponentTheme}&active=${initialActive ? '1' : '0'}&interactive=${initialInteractive ? '1' : '0'}&device=${initialDevice}&framing=${initialFraming}${thumbnail ? '&thumbnail=1' : ''}`;
  const url = src ? `${src}${src.includes('?') ? '&' : '?'}${query}` : `${playPath(assetId!, framework)}?${query}${version ? `&v=${encodeURIComponent(version)}` : ''}`;
  const request = JSON.stringify([url, reloadKey]);
  const [displayed, setDisplayed] = useState<{ request: string; url: string } | null>(null);
  const pending = displayed?.request !== request;
  return (
    <div className="stage-host" aria-busy={pending} data-theme={theme}>
      {displayed && <StageFrame key={displayed.request} src={displayed.url} title={title} className={className}
        theme={theme} componentTheme={componentTheme} device={device} framing={framing} visibleArea={visibleArea} active={pending ? false : active} inert={pending || inert} standby={pending} onResume={pending ? undefined : onResume} onBounds={pending ? undefined : onBounds} />}
      {pending && <StageFrame key={request} src={url} title={title} className={className}
        theme={theme} componentTheme={componentTheme} device={device} framing={framing} visibleArea={visibleArea} active={active} inert={inert} onResume={onResume}
        onReady={() => { setDisplayed({ request, url }); onReady?.(); }} onBounds={onBounds} />}
      {loadingIndicator && <PreviewLoading busy={pending} />}
    </div>
  );
});

function StageFrame({ src, title, theme, componentTheme, device, framing, active, inert, standby, onResume, className, onReady, onBounds, visibleArea }: StageProps & { standby?: boolean }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const hasRuntime = useRef(false);
  const readyReported = useRef(false);
  const fallback = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [loaded, setLoaded] = useState(false);
  const callbacks = useRef({ onReady, onResume, onBounds });
  callbacks.current = { onReady, onResume, onBounds };
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== ref.current?.contentWindow) return;
      if (event.data?.type === 'cea:boot') hasRuntime.current = true;
      if (event.data?.type === 'cea:ready') {
        hasRuntime.current = true;
        clearTimeout(fallback.current);
        if (readyReported.current) return;
        readyReported.current = true;
        if ('bounds' in event.data) callbacks.current.onBounds?.(event.data.bounds ?? null);
        setLoaded(true);
        callbacks.current.onReady?.();
      }
      if (event.data?.type === 'cea:resume') callbacks.current.onResume?.();
      if (event.data?.type === 'cea:bounds') callbacks.current.onBounds?.(event.data.value ?? null);
    };
    window.addEventListener('message', receive);
    return () => {
      window.removeEventListener('message', receive);
      clearTimeout(fallback.current);
    };
  }, []);
  useEffect(() => {
    ref.current?.contentWindow?.postMessage({ type: 'cea:theme', value: theme }, '*');
  }, [theme, loaded]);
  useEffect(() => {
    ref.current?.contentWindow?.postMessage({ type: 'cea:component-theme', value: componentTheme }, '*');
  }, [componentTheme, loaded]);
  useLayoutEffect(() => {
    ref.current?.contentWindow?.postMessage({ type: 'cea:device', value: device }, '*');
  }, [device, loaded]);
  useLayoutEffect(() => {
    ref.current?.contentWindow?.postMessage({ type: 'cea:framing', value: framing }, '*');
  }, [framing, loaded]);
  useEffect(() => {
    if (visibleArea !== undefined) ref.current?.contentWindow?.postMessage({ type: 'cea:visible-area', value: visibleArea }, '*');
  }, [visibleArea, loaded]);

  useEffect(() => {
    ref.current?.contentWindow?.postMessage({ type: 'cea:active', value: active, interactive: !!onResume }, '*');
  }, [active, loaded, onResume]);

  return (
    <iframe
      ref={ref}
      className={`stage-frame${loaded ? ' is-loaded' : ''}${className ? ' ' + className : ''}`}
      title={`${title} 预览`}
      sandbox={SANDBOX}
      src={src}
      onLoad={() => {
        ref.current?.contentWindow?.postMessage({ type: 'cea:probe' }, '*');
        clearTimeout(fallback.current);
        fallback.current = setTimeout(() => {
          // 404 等普通响应没有播放脚本，仍显示服务端返回的错误内容。
          if (!hasRuntime.current) {
            readyReported.current = true;
            callbacks.current.onBounds?.(null);
            setLoaded(true);
            callbacks.current.onReady?.();
          }
        }, 1200);
      }}
      tabIndex={inert || !loaded ? -1 : undefined}
      aria-hidden={standby || !loaded || undefined}
      // src 只在首次挂载时决定主题，之后都通过 postMessage 切换
      data-theme={theme}
    />
  );
}

export const PreviewStages = memo(function PreviewStages({ framework, reloadKey = 0, active = true, onResume, onBounds, zoom = 1, viewport, ...props }: StageProps & { framework: string }) {
  const [visited, setVisited] = useState<string[]>([framework]);
  const [generations, setGenerations] = useState<Record<string, number>>({});
  const [ready, setReady] = useState<Record<string, boolean>>({});
  const [lastShown, setLastShown] = useState(framework);
  const bounds = useRef<Record<string, PreviewBounds | null>>({});
  useEffect(() => {
    if (framework in bounds.current) onBounds?.(bounds.current[framework]);
  }, [framework, onBounds]);
  const displayed = ready[framework] ? framework : lastShown;
  useEffect(() => {
    if (ready[framework]) setLastShown(framework);
  }, [framework, ready]);
  const lastReplay = useRef(reloadKey);
  useEffect(() => {
    if (lastReplay.current === reloadKey) return;
    lastReplay.current = reloadKey;
    setGenerations(prev => ({ ...prev, [framework]: (prev[framework] ?? 0) + 1 }));
  }, [reloadKey, framework]);
  useEffect(() => {
    setVisited(list => list.includes(framework) ? list : [...list, framework]);
  }, [framework]);
  return (
    <div className="preview-stages" aria-busy={!ready[framework]}>
      {[...new Set([...visited, framework])].map(f => (
        <div key={f} className="preview-layer" hidden={f !== framework && f !== displayed} data-pending={f !== displayed || undefined}
          aria-hidden={f !== displayed || undefined} inert={f !== displayed}>
          <ZoomStage zoom={zoom} viewport={viewport}>
            <Stage {...props} loadingIndicator={false} framework={f} active={active && f === framework} onResume={f === framework ? onResume : undefined} reloadKey={generations[f] ?? 0}
              onBounds={value => { bounds.current[f] = value; if (f === framework) onBounds?.(value); }}
              onReady={() => setReady(prev => prev[f] ? prev : { ...prev, [f]: true })} />
          </ZoomStage>
        </div>
      ))}
      <PreviewLoading busy={!ready[framework]} />
    </div>
  );
});

export function PreviewLoading({ busy = true }: { busy?: boolean }) {
  return <span className="stage-loading" data-busy={busy || undefined} role={busy ? 'status' : undefined}
    aria-label={busy ? '正在加载预览' : undefined} aria-hidden={!busy || undefined}>
    <span className="stage-loading-indicator" aria-hidden="true" />
  </span>;
}

/** 卡片进入视口才挂载预览，离开后卸载，滚动长列表时不会同时跑几十个页面 */
export function useInView<T extends Element>(rootMargin = '200px', threshold = 0) {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting && entry.intersectionRatio >= threshold), { rootMargin, threshold });
    observer.observe(el);
    return () => observer.disconnect();
  }, [rootMargin, threshold]);
  return { ref, inView };
}

/**
 * 列表缩略图。iframe 按固定视口排版，再按内容实际占的区域缩放、居中：
 * 组件最多显示到原始大小，四周留白一致；区块完整铺进卡片；整页按宽度铺满、截取首屏。
 * 视口足够宽，组件不会在小卡片里切成手机布局。
 */
export function FitStage({ viewport, zoom = 1, ...props }: StageProps) {
  const { activity } = usePreviewActivity();
  const { ref, inView } = useInView<HTMLDivElement>('0px', 0.1);
  const [box, setBox] = useState<PreviewViewport | null>(null);
  const [bounds, setBounds] = useState<PreviewBounds | null>(null);
  const receiveBounds = (next: PreviewBounds | null) => setBounds(previous =>
    previous?.x === next?.x && previous?.y === next?.y && previous?.width === next?.width && previous?.height === next?.height ? previous : next);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (inView && !ready) return activity?.begin();
  }, [activity, inView, ready]);
  const kind = previewKind(viewport);
  const view = viewport ?? CARD_VIEWPORT;
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setBox({ width, height });
    });
    observer.observe(ref.current!);
    return () => observer.disconnect();
  }, []);
  const t = box && thumbnailTransform(box, view, kind === 'page' ? null : bounds, kind, zoom);
  const visibleArea = useMemo(() => t && box ? {
    x: -t.x / t.scale, y: -t.y / t.scale, width: box.width / t.scale, height: box.height / t.scale,
  } : null, [t?.x, t?.y, t?.scale, box?.width, box?.height]);
  return (
    <div ref={ref} className="fit-stage" data-ready={ready || undefined}>
      {t && (
        <div className="fit-stage-inner" data-measured={bounds ? '' : undefined} aria-hidden={!ready || undefined} inert={!ready}
          style={{ opacity: ready ? 1 : 0, width: view.width, height: view.height, transform: `translate(${Math.round(t.x)}px, ${Math.round(t.y)}px) scale(${t.scale})` }}>
          <Stage {...props} thumbnail visibleArea={visibleArea} loadingIndicator={false} onBounds={receiveBounds} onReady={() => { setReady(true); props.onReady?.(); }} />
        </div>
      )}
      {!activity && <PreviewLoading busy={!ready} />}
    </div>
  );
}

export function ZoomStage({ zoom = 1, viewport, children }: { zoom?: number; viewport?: PreviewViewport | null; children: React.ReactNode }) {
  if (viewport) return <FixedStage viewport={viewport} zoom={zoom}>{children}</FixedStage>;
  const scale = previewScale(zoom);
  return <div className="zoom-stage">
    <div className="zoom-stage-inner" style={{
      width: `${100 / scale}%`, height: `${100 / scale}%`,
      transform: `translate(-50%, -50%) scale(${scale})`,
    }}>{children}</div>
  </div>;
}

function FixedStage({ viewport, zoom, children }: { viewport: PreviewViewport; zoom: number; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 0 && entry.contentRect.height > 0) setScale(fitPreview(entry.contentRect, viewport, zoom));
    });
    observer.observe(ref.current!);
    return () => observer.disconnect();
  }, [viewport.width, viewport.height, zoom]);
  return <div ref={ref} className="zoom-stage">
    <div className="zoom-stage-inner" style={{ width: viewport.width, height: viewport.height, transform: `translate(-50%, -50%) scale(${scale})` }}>{children}</div>
  </div>;
}
