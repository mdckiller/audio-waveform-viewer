export type ViewMode = "waveform" | "rms" | "features";

export interface AxisPositionPx {
  x: number;
  y: number;
}

export type UiSlot = "top" | "bottom" | "left" | "right" | "overlay";

export type ChannelToolbarPosition = "top" | "bottom" | "left" | "right";

export interface ChannelToolbarConfig {
  enabled?: boolean;
  position?: ChannelToolbarPosition;
  thicknessPx?: number;
}

export interface ResolvedChannelToolbarConfig {
  enabled: boolean;
  position: ChannelToolbarPosition;
  thicknessPx: number;
}

export interface UiInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface UiRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CursorGuidePrecision {
  xMs?: number;
  y?: number;
}

export type ViewChangeReason =
  | "init"
  | "wheel"
  | "autoYExpand"
  | "pan"
  | "resize"
  | "setChannelToolbar"
  | "uiLayout"
  | "setTimeWindow"
  | "setYWindow"
  | "setAxisPos"
  | "reset"
  | "liveTick";

export interface ViewChangePayload {
  timeWindow: number;
  yWindow: number;
  axisPos: AxisPositionPx;
  visibleTimeMs: [number, number];
  visibleY: [number, number];
  reason: ViewChangeReason;
}

export interface ViewerConfig {
  width?: number;
  height?: number;
  backgroundColor?: string;
  timeWindow?: number;
  yWindow?: number;
  axisPos?: AxisPositionPx;
  channelToolbar?: ChannelToolbarConfig;
  liveMode?: boolean;
  viewMode?: ViewMode;
  maxGapMs?: number;
  preserveContinuityOnHiddenTab?: boolean;
  enableCursorGuide?: boolean;
  cursorGuidePrecision?: CursorGuidePrecision;
  enableTooltip?: boolean;
  enableZoom?: boolean;
  enablePan?: boolean;
  onPointClick?: (payload: { channelId: string; channelName: string; point: DataPoint; value: number }) => void;
  onMarkerClick?: (payload: { marker: Marker; markerId: string }) => void;
  onViewChange?: (payload: ViewChangePayload) => void;
}

export interface ResolvedViewerConfig {
  width: number;
  height: number;
  backgroundColor: string;
  timeWindow: number;
  yWindow: number;
  axisPos: AxisPositionPx;
  channelToolbar: ResolvedChannelToolbarConfig;
  liveMode: boolean;
  viewMode: ViewMode;
  maxGapMs: number;
  preserveContinuityOnHiddenTab: boolean;
  enableCursorGuide: boolean;
  cursorGuidePrecision: CursorGuidePrecision;
  enableTooltip: boolean;
  enableZoom: boolean;
  enablePan: boolean;
  onPointClick?: (payload: { channelId: string; channelName: string; point: DataPoint; value: number }) => void;
  onMarkerClick?: (payload: { marker: Marker; markerId: string }) => void;
  onViewChange?: (payload: ViewChangePayload) => void;
}

export interface ViewerUiChannelState {
  id: string;
  config: ChannelConfig;
}

export interface ViewerUiComponentState {
  width: number;
  height: number;
  devicePixelRatio: number;
  channels: ViewerUiChannelState[];
  channelToolbar: ResolvedChannelToolbarConfig;
  plotRect: UiRect;
}

export interface ViewerUiPointerEvent {
  type: "pointermove" | "pointerdown" | "pointerup" | "click" | "wheel" | "mouseleave" | "dblclick";
  x: number;
  y: number;
  deltaX?: number;
  deltaY?: number;
  originalEvent?: Event;
}

export interface ViewerUiPointerResult {
  consumed: boolean;
}

export interface ViewerUiComponent {
  id: string;
  slot: UiSlot;
  mount(container: HTMLElement): void;
  unmount(): void;
  getReservedInsets(ctx: ViewerUiComponentState): UiInsets;
  setRect(rect: UiRect): void;
  sync(state: ViewerUiComponentState): void;
  render(): void;
  handlePointerEvent(evt: ViewerUiPointerEvent): ViewerUiPointerResult;
}

export interface DataPoint {
  timestamp: number;
  value?: number;
  rms?: number;
  featureValue?: number;
  color?: string;
  alpha?: number;
  lineStyle?: "solid" | "dashed" | "dotted" | "dash-dot" | number[];
  lineWidth?: number;
  metadata?: Record<string, unknown>;
}

export interface ChannelConfig {
  name: string;
  color: string;
  alpha: number;
  lineWidth: number;
  lineStyle: "solid" | "dashed" | "dotted" | "dash-dot" | number[];
  visible: boolean;
  zIndex?: number;
}

export interface Marker {
  timestamp: number;
  color: string;
  label: string;
  lineWidth?: number;
  lineStyle?: "solid" | "dashed";
  metadata?: Record<string, unknown>;
}

export interface DataSegment {
  points: DataPoint[];
  startTime: number;
  endTime: number;
}

export interface ChannelBuffer {
  channelId: string;
  segments: DataSegmentIndex[];
  maxTimestamp: number | null;
  minTimestamp: number | null;
}

export interface DataSegmentIndex {
  startIndex: number;
  endIndex: number;
  startTime: number;
  endTime: number;
}

export interface RenderStyle {
  color: string;
  alpha: number;
  lineWidth: number;
  lineStyle: "solid" | "dashed" | "dotted" | "dash-dot" | number[];
}

export interface RenderRun {
  points: Float32Array;
  style: RenderStyle;
}
