import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { PreviewBounds, PreviewDevice, PreviewFraming, PreviewLayout } from '../../shared/preview.ts';
import { DEFAULT_DEVICE_VIEW, DeviceControl, DevicePreview, type DeviceView } from './DevicePreview.tsx';
import { ZoomControl } from './ZoomControl.tsx';
import { PreviewBackgroundToggle } from './AppearanceToggle.tsx';
import type { ComponentTheme } from '../../shared/theme.ts';

interface AppearanceProps { background: ComponentTheme; onBackgroundChange: (value: ComponentTheme) => void }

function useWorkspaceState({ background, onBackgroundChange, fullscreen = false }: AppearanceProps & { fullscreen?: boolean }) {
  const [normalView, setNormalView] = useState<DeviceView>(DEFAULT_DEVICE_VIEW);
  const [fullView, setFullView] = useState<DeviceView>({ ...DEFAULT_DEVICE_VIEW, framing: 'device', zoom: 1 });
  const view = fullscreen ? fullView : normalView;
  const setView = fullscreen ? setFullView : setNormalView;
  const [fitScale, setFitScale] = useState(1);
  const state = useMemo(() => ({ view, setView, setFitScale, background, onBackgroundChange, fullscreen }), [view, setView, background, onBackgroundChange, fullscreen]);
  return { state, fitScale };
}

const WorkspaceContext = createContext<ReturnType<typeof useWorkspaceState>['state'] | null>(null);
const FitScaleContext = createContext(1);

function useWorkspace() {
  const state = useContext(WorkspaceContext);
  if (!state) throw new Error('Device controls require DeviceWorkspace');
  return state;
}

/** 旋转和缩放只更新订阅设备状态的控件与画布，不触发页面及复用内容重渲染。 */
export function DeviceWorkspace({ children, ...appearance }: AppearanceProps & { children: ReactNode; fullscreen?: boolean }) {
  const { state, fitScale } = useWorkspaceState(appearance);
  return <WorkspaceContext.Provider value={state}>
    <FitScaleContext.Provider value={fitScale}>{children}</FitScaleContext.Provider>
  </WorkspaceContext.Provider>;
}

export function DeviceTools() {
  const { view, setView, fullscreen } = useWorkspace();
  if (fullscreen) return <span className="panel-label">全屏预览</span>;
  return <DeviceControl view={view} onChange={setView} />;
}

export function DeviceBackground() {
  const { background, onBackgroundChange } = useWorkspace();
  return <PreviewBackgroundToggle value={background} onChange={onBackgroundChange} />;
}

export function DeviceZoom({ children }: { children?: ReactNode }) {
  const { view, setView } = useWorkspace();
  const fitScale = useContext(FitScaleContext);
  return <div className="preview-navigation"><ZoomControl value={view.zoom} fitScale={fitScale}
    onChange={zoom => setView(previous => ({ ...previous, zoom }))}
    panning={view.panMode ?? false} onPan={() => setView(previous => ({ ...previous, panMode: !previous.panMode }))}
    onFit={() => setView(previous => ({ ...previous, zoom: 'fit', panMode: false, fitRequest: (previous.fitRequest ?? 0) + 1 }))}
    onCenter={() => setView(previous => ({ ...previous, centerRequest: (previous.centerRequest ?? 0) + 1 }))} />
    {children}</div>;
}

export function DeviceCanvas({ active = true, children }: { active?: boolean; children: (device: PreviewDevice, onBounds: (bounds: PreviewBounds | null, layout?: PreviewLayout) => void, framing: PreviewFraming) => ReactNode }) {
  const { view, setView, setFitScale, fullscreen } = useWorkspace();
  const [measurement, setMeasurement] = useState<{ bounds: PreviewBounds | null; layout?: PreviewLayout }>();
  const receiveBounds = useCallback((bounds: PreviewBounds | null, layout?: PreviewLayout) => setMeasurement({ bounds, layout }), []);
  return <DevicePreview view={view} bounds={measurement?.bounds} boundsLayout={measurement?.layout} fullscreen={fullscreen} active={active} onFitScale={setFitScale}
    onZoomChange={zoom => setView(previous => ({ ...previous, zoom }))}>{children(view.device, receiveBounds, view.framing ?? 'device')}</DevicePreview>;
}
