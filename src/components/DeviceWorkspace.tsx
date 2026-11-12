import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import type { PreviewBounds, PreviewDevice, PreviewFraming } from '../../shared/preview.ts';
import { DEFAULT_DEVICE_VIEW, DeviceControl, DevicePreview, type DeviceView } from './DevicePreview.tsx';
import { ZoomControl } from './ZoomControl.tsx';
import { PreviewBackgroundToggle } from './AppearanceToggle.tsx';
import type { ComponentTheme } from '../../shared/theme.ts';

interface AppearanceProps { background: ComponentTheme; onBackgroundChange: (value: ComponentTheme) => void }

function useWorkspaceState({ background, onBackgroundChange }: AppearanceProps) {
  const [view, setView] = useState<DeviceView>(DEFAULT_DEVICE_VIEW);
  const [fitScale, setFitScale] = useState(1);
  const state = useMemo(() => ({ view, setView, setFitScale, background, onBackgroundChange }), [view, background, onBackgroundChange]);
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
export function DeviceWorkspace({ children, ...appearance }: AppearanceProps & { children: ReactNode }) {
  const { state, fitScale } = useWorkspaceState(appearance);
  return <WorkspaceContext.Provider value={state}>
    <FitScaleContext.Provider value={fitScale}>{children}</FitScaleContext.Provider>
  </WorkspaceContext.Provider>;
}

export function DeviceTools() {
  const { view, setView } = useWorkspace();
  return <DeviceControl view={view} onChange={setView} />;
}

export function DeviceBackground() {
  const { background, onBackgroundChange } = useWorkspace();
  return <PreviewBackgroundToggle value={background} onChange={onBackgroundChange} />;
}

export function DeviceZoom() {
  const { view, setView } = useWorkspace();
  const fitScale = useContext(FitScaleContext);
  return <ZoomControl value={view.zoom} fitScale={fitScale}
    onChange={zoom => setView(previous => ({ ...previous, zoom }))}
    panning={view.panMode ?? false} onPan={() => setView(previous => ({ ...previous, panMode: !previous.panMode }))}
    onFit={() => setView(previous => ({ ...previous, zoom: 'fit', panMode: false, fitRequest: (previous.fitRequest ?? 0) + 1 }))}
    onCenter={() => setView(previous => ({ ...previous, centerRequest: (previous.centerRequest ?? 0) + 1 }))} />;
}

export function DeviceCanvas({ fullscreen, active = true, children }: { fullscreen: boolean; active?: boolean; children: (device: PreviewDevice, onBounds: (bounds: PreviewBounds | null) => void, framing: PreviewFraming) => ReactNode }) {
  const { view, setView, setFitScale } = useWorkspace();
  const [bounds, setBounds] = useState<PreviewBounds | null>();
  return <DevicePreview view={view} bounds={bounds} fullscreen={fullscreen} active={active} onFitScale={setFitScale}
    onZoomChange={zoom => setView(previous => ({ ...previous, zoom }))}>{children(view.device, setBounds, fullscreen ? 'device' : view.framing ?? 'device')}</DevicePreview>;
}
