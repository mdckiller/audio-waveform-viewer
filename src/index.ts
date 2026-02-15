import { Channel } from "./components/channel.js";
import { MarkerStore } from "./components/marker.js";
import { Tooltip } from "./components/tooltip.js";
import { DataBuffer } from "./core/dataBuffer.js";
import { Timeline } from "./core/timeline.js";
import { ChannelToolbarComponent } from "./ui/channelToolbarComponent.js";
import { UiComponentHost } from "./ui/componentHost.js";
import { ZERO_INSETS, buildUiState, sameInsets } from "./ui/types.js";
import { clamp, generateTicks } from "./utils/mathUtils.js";
import {
  AxisPositionPx,
  ChannelToolbarConfig,
  ChannelConfig,
  ChannelToolbarPosition,
  CursorGuidePrecision,
  DataPoint,
  Marker,
  RenderRun,
  RenderStyle,
  ResolvedChannelToolbarConfig,
  ResolvedViewerConfig,
  UiInsets,
  ViewChangePayload,
  ViewChangeReason,
  ViewMode,
  ViewerUiComponent,
  ViewerUiComponentState,
  ViewerUiPointerEvent,
  ViewerConfig
} from "./types.js";

const BASE_INSETS: UiInsets = {
  top: 0,
  right: 0,
  bottom: 22,
  left: 55
};
const MIN_TIME_WINDOW = 1;
const MIN_Y_WINDOW = 1e-6;

interface PlotRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

interface ViewMapping {
  msPerPx: number;
  yPerPx: number;
  originX: number;
  originY: number;
}

interface VisibleRanges {
  timeMs: [number, number];
  y: [number, number];
}

interface ViewSnapshot {
  plotRect: PlotRect;
  mapping: ViewMapping;
  visible: VisibleRanges;
  baseTimestamp: number | null;
  timestampRange: [number, number] | null;
}

export class AudioWaveformViewer {
  private readonly container: HTMLElement;
  private readonly dataBuffer: DataBuffer;
  private readonly timeline: Timeline;
  private readonly channels: Map<string, Channel> = new Map();
  private readonly markerStore = new MarkerStore();
  private readonly markerCanvas: HTMLCanvasElement;
  private readonly markerContext: CanvasRenderingContext2D;
  private readonly tooltip: Tooltip | null;
  private readonly uiHost: UiComponentHost;
  private readonly channelToolbarComponent: ChannelToolbarComponent;
  private readonly cleanupCallbacks: Array<() => void> = [];

  private config: ResolvedViewerConfig;
  private resizeObserver: ResizeObserver | null = null;
  private destroyed = false;
  private needsRender = true;

  private timeWindow: number;
  private yWindow: number;
  private axisPos: AxisPositionPx;

  private readonly defaultTimeWindow: number;
  private readonly defaultYWindow: number;
  private readonly defaultAxisPos: AxisPositionPx;
  private readonly configuredMaxGapMs: number;
  private autoWidthFromContainer: boolean;
  private autoHeightFromContainer: boolean;
  private gapRelaxedForHiddenTab = false;
  private restoreGapThresholdOnNextData = false;

  private isPanning = false;
  private lastPanPoint: { x: number; y: number } | null = null;
  private pinchDistance: number | null = null;
  private cursorGuidePoint: { x: number; y: number } | null = null;

  private uiInsets: UiInsets = { ...ZERO_INSETS };
  private plotRect: PlotRect = {
    left: BASE_INSETS.left,
    top: BASE_INSETS.top,
    right: 1,
    bottom: 1,
    width: 1,
    height: 1
  };

  private lastView: ViewSnapshot | null = null;

  constructor(container: HTMLElement, config: ViewerConfig) {
    this.container = container;
    this.autoWidthFromContainer = config.width === undefined;
    this.autoHeightFromContainer = config.height === undefined;
    this.config = resolveViewerConfig(container, config);

    this.timeWindow = this.config.timeWindow;
    this.yWindow = this.config.yWindow;
    this.axisPos = { ...this.config.axisPos };

    this.defaultTimeWindow = this.config.timeWindow;
    this.defaultYWindow = this.config.yWindow;
    this.defaultAxisPos = { ...this.config.axisPos };
    this.configuredMaxGapMs = this.config.maxGapMs;

    this.dataBuffer = new DataBuffer(this.config.maxGapMs);
    this.timeline = new Timeline();

    this.container.style.position = "relative";
    if (!this.autoWidthFromContainer) {
      this.container.style.width = `${this.config.width}px`;
    }
    if (!this.autoHeightFromContainer) {
      this.container.style.height = `${this.config.height}px`;
    }
    this.container.style.backgroundColor = this.config.backgroundColor;
    this.container.style.userSelect = "none";

    const markerCanvas = document.createElement("canvas");
    markerCanvas.style.position = "absolute";
    markerCanvas.style.top = "0";
    markerCanvas.style.left = "0";
    markerCanvas.style.pointerEvents = "none";
    markerCanvas.style.zIndex = "100";
    this.container.appendChild(markerCanvas);
    const markerContext = markerCanvas.getContext("2d");
    if (!markerContext) {
      throw new Error("Unable to create marker canvas context");
    }
    this.markerCanvas = markerCanvas;
    this.markerContext = markerContext;

    this.tooltip = this.config.enableTooltip ? new Tooltip(this.container) : null;
    this.uiHost = new UiComponentHost(this.container, {
      onRequestRender: () => {
        this.needsRender = true;
      }
    });
    this.channelToolbarComponent = new ChannelToolbarComponent({
      onToggleChannel: (channelId, visible) => {
        if (!this.channels.has(channelId)) {
          return;
        }
        this.setChannelVisibility(channelId, visible);
      },
      onRequestRender: () => {
        this.needsRender = true;
      },
      onShowTooltip: (x, y, content) => {
        if (!this.tooltip || !this.config.enableTooltip) {
          return;
        }
        this.tooltip.show(x, y, content);
      },
      onHideTooltip: () => {
        if (!this.tooltip) {
          return;
        }
        this.tooltip.hide();
      }
    });
    this.uiHost.register(this.channelToolbarComponent);
    this.refreshUiLayout(false);

    this.resize();
    this.attachEvents();
    this.attachResizeObserver();
    this.renderLoop();
    this.emitViewChange("init");
  }

  addChannel(id: string, config: ChannelConfig): void {
    if (this.channels.size >= 10) {
      throw new Error("Maximum number of channels reached");
    }
    if (this.channels.has(id)) {
      throw new Error("Channel already exists");
    }
    validateChannelConfig(config);
    this.dataBuffer.addChannel(id);
    const channel = new Channel(this.container, id, config);
    channel.resize(this.config.width, this.config.height, window.devicePixelRatio || 1);
    this.channels.set(id, channel);
    this.refreshUiLayoutIfNeeded();
    this.needsRender = true;
  }

  removeChannel(id: string): void {
    const channel = this.channels.get(id);
    if (!channel) {
      throw new Error("Channel not found");
    }
    channel.destroy();
    this.channels.delete(id);
    this.dataBuffer.removeChannel(id);
    this.refreshUiLayoutIfNeeded();
    this.needsRender = true;
  }

  setChannelVisibility(id: string, visible: boolean): void {
    const channel = this.getChannel(id);
    channel.updateConfig({ visible });
    this.syncUiComponents();
    this.needsRender = true;
  }

  updateChannelConfig(id: string, config: Partial<ChannelConfig>): void {
    const channel = this.getChannel(id);
    channel.updateConfig(config);
    this.syncUiComponents();
    this.needsRender = true;
  }

  addData(channelId: string, data: DataPoint[]): void {
    this.dataBuffer.addData(channelId, data);
    const maxTimestamp = this.dataBuffer.getMaxTimestamp();
    if (maxTimestamp !== null) {
      const moved = this.timeline.updateMaxTimestamp(maxTimestamp);
      if (moved && this.config.liveMode) {
        this.emitViewChange("liveTick");
      }
    }
    if (data.length > 0) {
      this.maybeRestoreGapThresholdAfterForegroundData();
    }
    this.needsRender = true;
  }

  addDataPoint(channelId: string, point: DataPoint): void {
    this.dataBuffer.addDataPoint(channelId, point);
    const maxTimestamp = this.dataBuffer.getMaxTimestamp();
    if (maxTimestamp !== null) {
      const moved = this.timeline.updateMaxTimestamp(maxTimestamp);
      if (moved && this.config.liveMode) {
        this.emitViewChange("liveTick");
      }
    }
    this.maybeRestoreGapThresholdAfterForegroundData();
    this.needsRender = true;
  }

  addMarker(marker: Marker): string {
    const id = this.markerStore.add(marker);
    this.needsRender = true;
    return id;
  }

  removeMarker(markerId: string): void {
    this.markerStore.remove(markerId);
    this.needsRender = true;
  }

  updateMarker(markerId: string, marker: Partial<Marker>): void {
    this.markerStore.update(markerId, marker);
    this.needsRender = true;
  }

  setLiveMode(enabled: boolean): void {
    this.config.liveMode = enabled;
    this.emitViewChange("liveTick");
    this.needsRender = true;
  }

  setViewMode(mode: ViewMode): void {
    this.config.viewMode = mode;
    this.needsRender = true;
  }

  setPreserveContinuityOnHiddenTab(enabled: boolean): void {
    this.config.preserveContinuityOnHiddenTab = enabled;
    this.handleVisibilityStateChange();
    this.needsRender = true;
  }

  setEnableCursorGuide(enabled: boolean): void {
    this.config.enableCursorGuide = enabled;
    if (!enabled) {
      this.cursorGuidePoint = null;
    }
    this.needsRender = true;
  }

  setCursorGuidePrecision(precision?: CursorGuidePrecision): void {
    this.config.cursorGuidePrecision = normalizeCursorGuidePrecision(precision);
    this.needsRender = true;
  }

  setTimeWindow(milliseconds: number): void {
    if (!Number.isFinite(milliseconds) || milliseconds <= 0) {
      throw new Error("timeWindow must be greater than zero");
    }
    this.timeWindow = milliseconds;
    this.config.timeWindow = milliseconds;
    this.needsRender = true;
    this.emitViewChange("setTimeWindow");
  }

  setYWindow(units: number): void {
    if (!Number.isFinite(units) || units <= 0) {
      throw new Error("yWindow must be greater than zero");
    }
    this.yWindow = units;
    this.config.yWindow = units;
    this.needsRender = true;
    this.emitViewChange("setYWindow");
  }

  setAxisPos(axisPos: AxisPositionPx): void {
    if (!Number.isFinite(axisPos.x) || !Number.isFinite(axisPos.y)) {
      throw new Error("axisPos.x and axisPos.y must be finite numbers");
    }
    this.axisPos = { x: axisPos.x, y: axisPos.y };
    this.config.axisPos = { ...this.axisPos };
    this.needsRender = true;
    this.emitViewChange("setAxisPos");
  }

  setChannelToolbar(config: Partial<ChannelToolbarConfig>): void {
    const nextToolbar = resolveChannelToolbarConfig({
      ...this.config.channelToolbar,
      ...config
    });
    this.config.channelToolbar = nextToolbar;
    this.refreshUiLayout(true, "setChannelToolbar");
  }

  getChannelToolbarState(): ResolvedChannelToolbarConfig {
    return { ...this.config.channelToolbar };
  }

  registerUiComponent(component: ViewerUiComponent): void {
    const previousPlot = this.getPlotRect();
    this.uiHost.register(component);
    this.refreshUiLayoutWithBase(previousPlot, true, "uiLayout");
  }

  unregisterUiComponent(componentId: string): void {
    const previousPlot = this.getPlotRect();
    this.uiHost.unregister(componentId);
    this.refreshUiLayoutWithBase(previousPlot, true, "uiLayout");
  }

  setSize(width: number, height: number): void {
    if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
      throw new Error("Width and height must be positive numbers");
    }
    const prevPlot = this.getPlotRect();
    this.autoWidthFromContainer = false;
    this.autoHeightFromContainer = false;
    this.config.width = width;
    this.config.height = height;
    this.container.style.width = `${width}px`;
    this.container.style.height = `${height}px`;
    this.refreshUiLayoutWithBase(prevPlot, true, "resize");
    this.resize();
  }

  setAutoSize(widthCss = "100%", heightCss = "100%"): void {
    if (!widthCss || !heightCss) {
      throw new Error("widthCss and heightCss are required");
    }
    const prevPlot = this.getPlotRect();
    this.autoWidthFromContainer = true;
    this.autoHeightFromContainer = true;
    this.container.style.width = widthCss;
    this.container.style.height = heightCss;

    const measuredWidth = this.container.clientWidth > 0
      ? this.container.clientWidth
      : Math.round(this.container.getBoundingClientRect().width);
    const measuredHeight = this.container.clientHeight > 0
      ? this.container.clientHeight
      : Math.round(this.container.getBoundingClientRect().height);

    if (measuredWidth > 0 && measuredHeight > 0) {
      this.config.width = measuredWidth;
      this.config.height = measuredHeight;
      this.refreshUiLayoutWithBase(prevPlot, true, "resize");
      this.resize();
      return;
    }

    this.needsRender = true;
  }

  resetView(): void {
    this.timeWindow = this.defaultTimeWindow;
    this.yWindow = this.defaultYWindow;
    this.axisPos = { ...this.defaultAxisPos };
    this.config.timeWindow = this.defaultTimeWindow;
    this.config.yWindow = this.defaultYWindow;
    this.config.axisPos = { ...this.defaultAxisPos };
    this.needsRender = true;
    this.emitViewChange("reset");
  }

  clear(channelId?: string): void {
    this.dataBuffer.clear(channelId);
    if (!channelId) {
      this.timeline.reset();
    }
    this.needsRender = true;
  }

  destroy(): void {
    this.destroyed = true;
    this.cleanupCallbacks.forEach((cleanup) => cleanup());
    this.cleanupCallbacks.length = 0;
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    this.channels.forEach((channel) => channel.destroy());
    this.channels.clear();
    this.uiHost.destroy();
    this.markerCanvas.remove();
    if (this.tooltip) {
      this.tooltip.destroy();
    }
  }

  getCurrentTimeRange(): [number, number] {
    const snapshot = this.buildSnapshot();
    return snapshot.timestampRange ?? [0, 0];
  }

  getMaxTimestamp(): number | null {
    return this.dataBuffer.getMaxTimestamp();
  }

  getViewState(): Omit<ViewChangePayload, "reason"> {
    const snapshot = this.buildSnapshot();
    return {
      timeWindow: this.timeWindow,
      yWindow: this.yWindow,
      axisPos: { ...this.axisPos },
      visibleTimeMs: snapshot.visible.timeMs,
      visibleY: snapshot.visible.y
    };
  }

  private renderLoop(): void {
    const loop = () => {
      if (this.destroyed) {
        return;
      }
      if (this.needsRender) {
        this.renderFrame();
        this.needsRender = false;
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  private renderFrame(): void {
    let snapshot = this.buildSnapshot();

    if (this.config.liveMode && snapshot.baseTimestamp !== null) {
      if (this.autoPanXIfNeeded(snapshot)) {
        snapshot = this.buildSnapshot();
      }
    }

    if (this.config.liveMode && snapshot.baseTimestamp !== null) {
      const extents = this.getVisibleDataExtents(snapshot);
      if (extents && this.expandYWindowIfNeeded(extents, snapshot.plotRect, snapshot.mapping)) {
        snapshot = this.buildSnapshot();
      }
    }

    this.lastView = snapshot;

    const dpr = window.devicePixelRatio || 1;

    this.channels.forEach((channel, channelId) => {
      let runs: RenderRun[] = [];
      if (snapshot.baseTimestamp !== null && snapshot.timestampRange !== null) {
        const segments = this.dataBuffer.getSegmentsInRange(
          channelId,
          snapshot.timestampRange[0],
          snapshot.timestampRange[1]
        );
        runs = this.buildRenderRuns(
          channel.getConfig(),
          segments,
          snapshot.baseTimestamp,
          snapshot.mapping
        );
      }
      channel.setScissor(
        Math.floor(snapshot.plotRect.left * dpr),
        Math.floor((this.config.height - snapshot.plotRect.bottom) * dpr),
        Math.floor(snapshot.plotRect.width * dpr),
        Math.floor(snapshot.plotRect.height * dpr)
      );
      channel.render(runs);
      channel.clearScissor();
    });

    const ctx = this.markerContext;
    ctx.clearRect(0, 0, this.markerCanvas.width, this.markerCanvas.height);
    ctx.save();
    ctx.scale(dpr, dpr);
    this.drawAxes(ctx, snapshot.plotRect, snapshot.mapping, snapshot.visible);
    if (snapshot.baseTimestamp !== null) {
      this.drawMarkers(ctx, snapshot.plotRect, snapshot.mapping, snapshot.baseTimestamp);
    }
    this.drawCursorGuide(ctx, snapshot.plotRect, snapshot.mapping);
    ctx.restore();
    this.uiHost.renderAll();
  }

  private buildSnapshot(): ViewSnapshot {
    const plotRect = this.getPlotRect();
    const mapping = this.getViewMapping(plotRect);
    const visible = this.getVisibleRanges(plotRect, mapping);
    const baseTimestamp = this.timeline.getBaseTimestamp();
    const timestampRange = baseTimestamp === null
      ? null
      : this.toTimestampRange(baseTimestamp, visible.timeMs);

    return {
      plotRect,
      mapping,
      visible,
      baseTimestamp,
      timestampRange
    };
  }

  private buildRenderRuns(
    channelConfig: ChannelConfig,
    segments: Array<{ points: DataPoint[] }>,
    baseTimestamp: number,
    mapping: ViewMapping
  ): RenderRun[] {
    const runs: RenderRun[] = [];
    const defaultStyle: RenderStyle = {
      color: channelConfig.color,
      alpha: channelConfig.alpha,
      lineWidth: channelConfig.lineWidth,
      lineStyle: channelConfig.lineStyle
    };

    segments.forEach((segment) => {
      let currentStyle = defaultStyle;
      let buffer: number[] = [];

      segment.points.forEach((point) => {
        const value = getPointValue(point, this.config.viewMode);
        if (value === undefined) {
          return;
        }

        const style = getPointStyle(point, defaultStyle);
        if (!sameStyle(style, currentStyle) && buffer.length > 0) {
          runs.push({ points: new Float32Array(buffer), style: currentStyle });
          buffer = [];
        }
        currentStyle = style;

        const xElapsedMs = point.timestamp - baseTimestamp;
        const xPx = mapping.originX - xElapsedMs / mapping.msPerPx;
        const yPx = mapping.originY - value / mapping.yPerPx;

        const xGl = (xPx / this.config.width) * 2 - 1;
        const yGl = (1 - yPx / this.config.height) * 2 - 1;
        buffer.push(xGl, yGl);
      });

      if (buffer.length > 0) {
        runs.push({ points: new Float32Array(buffer), style: currentStyle });
      }
    });

    return runs;
  }

  private drawAxes(
    ctx: CanvasRenderingContext2D,
    plotRect: PlotRect,
    mapping: ViewMapping,
    visible: VisibleRanges
  ): void {
    const timeSpan = visible.timeMs[1] - visible.timeMs[0];
    const ySpan = visible.y[1] - visible.y[0];

    ctx.font = "10px monospace";

    if (ySpan > 0) {
      const yTickCount = Math.max(3, Math.floor(plotRect.height / 45));
      const yTicks = generateTicks(visible.y[0], visible.y[1], yTickCount);
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      yTicks.forEach((tick) => {
        if (tick < visible.y[0] || tick > visible.y[1]) {
          return;
        }
        const py = mapping.originY - tick / mapping.yPerPx;
        if (py < plotRect.top || py > plotRect.bottom) {
          return;
        }
        ctx.strokeStyle = "rgba(150,150,150,0.2)";
        ctx.lineWidth = 0.5;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(plotRect.left, py);
        ctx.lineTo(plotRect.right, py);
        ctx.stroke();
        ctx.fillStyle = "#888";
        ctx.setLineDash([]);
        ctx.fillText(formatYLabel(tick, ySpan), plotRect.left - 4, py);
      });
    }

    if (timeSpan > 0) {
      const xTickCount = Math.max(3, Math.floor(plotRect.width / 90));
      const xTicks = generateTicks(visible.timeMs[0], visible.timeMs[1], xTickCount);
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      xTicks.forEach((tick) => {
        if (tick < visible.timeMs[0] || tick > visible.timeMs[1]) {
          return;
        }
        const px = mapping.originX - tick / mapping.msPerPx;
        if (px < plotRect.left || px > plotRect.right) {
          return;
        }
        ctx.strokeStyle = "rgba(150,150,150,0.2)";
        ctx.lineWidth = 0.5;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(px, plotRect.top);
        ctx.lineTo(px, plotRect.bottom);
        ctx.stroke();
        ctx.fillStyle = "#888";
        ctx.setLineDash([]);
        ctx.fillText(formatTimeLabel(tick, timeSpan), px, plotRect.bottom + 3);
      });
    }

    ctx.setLineDash([]);
    ctx.strokeStyle = "#aaa";
    ctx.lineWidth = 1;
    ctx.strokeRect(plotRect.left, plotRect.top, plotRect.width, plotRect.height);

    ctx.strokeStyle = "#555";
    if (mapping.originX >= plotRect.left && mapping.originX <= plotRect.right) {
      ctx.beginPath();
      ctx.moveTo(mapping.originX, plotRect.top);
      ctx.lineTo(mapping.originX, plotRect.bottom);
      ctx.stroke();
    }
    if (mapping.originY >= plotRect.top && mapping.originY <= plotRect.bottom) {
      ctx.beginPath();
      ctx.moveTo(plotRect.left, mapping.originY);
      ctx.lineTo(plotRect.right, mapping.originY);
      ctx.stroke();
    }
  }

  private drawMarkers(
    ctx: CanvasRenderingContext2D,
    plotRect: PlotRect,
    mapping: ViewMapping,
    baseTimestamp: number
  ): void {
    this.markerStore.list().forEach(({ marker }) => {
      const xElapsedMs = marker.timestamp - baseTimestamp;
      const x = mapping.originX - xElapsedMs / mapping.msPerPx;
      if (x < plotRect.left || x > plotRect.right) {
        return;
      }
      ctx.beginPath();
      ctx.strokeStyle = marker.color;
      ctx.lineWidth = marker.lineWidth ?? 1;
      ctx.setLineDash(marker.lineStyle === "dashed" ? [6, 4] : []);
      ctx.moveTo(x, plotRect.top);
      ctx.lineTo(x, plotRect.bottom);
      ctx.stroke();
    });
    ctx.setLineDash([]);
  }

  private drawCursorGuide(
    ctx: CanvasRenderingContext2D,
    plotRect: PlotRect,
    mapping: ViewMapping
  ): void {
    if (!this.config.enableCursorGuide || !this.cursorGuidePoint) {
      return;
    }

    const x = clamp(this.cursorGuidePoint.x, plotRect.left, plotRect.right);
    const y = clamp(this.cursorGuidePoint.y, plotRect.top, plotRect.bottom);
    const xMs = this.pixelToTimeMs(x, mapping);
    const yValue = this.pixelToY(y, mapping);

    const xDecimals = resolveGuidePrecision(this.config.cursorGuidePrecision.xMs, mapping.msPerPx, 4);
    const yDecimals = resolveGuidePrecision(this.config.cursorGuidePrecision.y, mapping.yPerPx, 6);
    const xLabel = `${xMs.toFixed(xDecimals)} ms`;
    const yLabel = yValue.toFixed(yDecimals);

    ctx.save();

    ctx.strokeStyle = "rgba(70, 70, 70, 0.45)";
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 3]);
    ctx.beginPath();
    ctx.moveTo(x, plotRect.top);
    ctx.lineTo(x, plotRect.bottom);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(plotRect.left, y);
    ctx.lineTo(plotRect.right, y);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.font = "10px monospace";
    const padX = 4;
    const yBoxHeight = 14;
    const yLabelRight = plotRect.left - 4;
    const yBoxWidth = Math.ceil(ctx.measureText(yLabel).width) + padX * 2;
    const yBoxX = Math.max(0, yLabelRight - yBoxWidth);
    const yBoxY = clamp(y - yBoxHeight / 2, 0, this.config.height - yBoxHeight);
    ctx.fillStyle = "rgba(35, 35, 35, 0.9)";
    ctx.fillRect(yBoxX, yBoxY, yBoxWidth, yBoxHeight);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
    ctx.lineWidth = 1;
    ctx.strokeRect(yBoxX + 0.5, yBoxY + 0.5, yBoxWidth - 1, yBoxHeight - 1);
    ctx.fillStyle = "#f7fafc";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(yLabel, yLabelRight - padX, yBoxY + yBoxHeight / 2);

    const xBoxHeight = 14;
    const xBoxWidth = Math.ceil(ctx.measureText(xLabel).width) + padX * 2;
    const xBoxX = clamp(x - xBoxWidth / 2, 0, this.config.width - xBoxWidth);
    const xBoxY = clamp(plotRect.bottom + 3, 0, this.config.height - xBoxHeight);
    ctx.fillStyle = "rgba(35, 35, 35, 0.9)";
    ctx.fillRect(xBoxX, xBoxY, xBoxWidth, xBoxHeight);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
    ctx.lineWidth = 1;
    ctx.strokeRect(xBoxX + 0.5, xBoxY + 0.5, xBoxWidth - 1, xBoxHeight - 1);
    ctx.fillStyle = "#f7fafc";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(xLabel, xBoxX + xBoxWidth / 2, xBoxY + xBoxHeight / 2);

    ctx.restore();
  }

  private autoPanXIfNeeded(snapshot: ViewSnapshot): boolean {
    if (snapshot.baseTimestamp === null) {
      return false;
    }
    const maxTimestamp = this.timeline.getMaxTimestamp();
    if (maxTimestamp === null) {
      return false;
    }

    const latestElapsedMs = maxTimestamp - snapshot.baseTimestamp;
    const visibleMaxMs = snapshot.visible.timeMs[1];
    if (latestElapsedMs <= visibleMaxMs) {
      return false;
    }

    const shiftMs = latestElapsedMs - visibleMaxMs;
    const shiftPx = shiftMs / snapshot.mapping.msPerPx;
    if (!Number.isFinite(shiftPx) || shiftPx === 0) {
      return false;
    }

    this.axisPos = {
      x: this.axisPos.x - shiftPx,
      y: this.axisPos.y
    };
    this.config.axisPos = { ...this.axisPos };
    this.emitViewChange("liveTick");
    return true;
  }

  private getVisibleDataExtents(snapshot: ViewSnapshot): { min: number; max: number } | null {
    if (snapshot.timestampRange === null) {
      return null;
    }

    let dataMin = Number.POSITIVE_INFINITY;
    let dataMax = Number.NEGATIVE_INFINITY;

    this.channels.forEach((channel, channelId) => {
      if (!channel.getConfig().visible) {
        return;
      }
      const segments = this.dataBuffer.getSegmentsInRange(
        channelId,
        snapshot.timestampRange![0],
        snapshot.timestampRange![1]
      );

      segments.forEach((segment) => {
        segment.points.forEach((point) => {
          const value = getPointValue(point, this.config.viewMode);
          if (value === undefined) {
            return;
          }
          dataMin = Math.min(dataMin, value);
          dataMax = Math.max(dataMax, value);
        });
      });
    });

    if (!Number.isFinite(dataMin) || !Number.isFinite(dataMax)) {
      return null;
    }

    return { min: dataMin, max: dataMax };
  }

  private expandYWindowIfNeeded(
    extents: { min: number; max: number },
    plotRect: PlotRect,
    mapping: ViewMapping
  ): boolean {
    const visible = this.getVisibleRanges(plotRect, mapping).y;
    const visibleSpan = Math.max(MIN_Y_WINDOW, visible[1] - visible[0]);
    const tolerance = Math.max(1e-9, visibleSpan * 1e-4);
    if (extents.min >= visible[0] - tolerance && extents.max <= visible[1] + tolerance) {
      return false;
    }

    const span = Math.max(MIN_Y_WINDOW, extents.max - extents.min);
    const padding = span * 0.05;
    const targetMin = extents.min - padding;
    const targetMax = extents.max + padding;

    const topPx = mapping.originY - plotRect.top;
    const bottomPx = plotRect.bottom - mapping.originY;

    let requiredWindow = this.yWindow;

    if (targetMax > 0 && topPx > 0) {
      requiredWindow = Math.max(requiredWindow, (targetMax * plotRect.height) / topPx);
    }
    if (targetMin < 0 && bottomPx > 0) {
      requiredWindow = Math.max(requiredWindow, ((-targetMin) * plotRect.height) / bottomPx);
    }

    if (!Number.isFinite(requiredWindow) || requiredWindow <= this.yWindow) {
      return false;
    }

    this.yWindow = requiredWindow;
    this.config.yWindow = requiredWindow;
    this.emitViewChange("autoYExpand");
    return true;
  }

  private emitViewChange(reason: ViewChangeReason): void {
    if (!this.config.onViewChange) {
      return;
    }
    const snapshot = this.buildSnapshot();
    this.config.onViewChange({
      timeWindow: this.timeWindow,
      yWindow: this.yWindow,
      axisPos: { ...this.axisPos },
      visibleTimeMs: snapshot.visible.timeMs,
      visibleY: snapshot.visible.y,
      reason
    });
  }

  private attachEvents(): void {
    const visibilityHandler = () => {
      this.handleVisibilityStateChange();
    };
    this.bindEvent(document, "visibilitychange", visibilityHandler);
    visibilityHandler();

    const wheelHandler = (evt: Event) => {
      const event = evt as WheelEvent;
      const rect = this.container.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      if (this.dispatchUiPointerEvent({
        type: "wheel",
        x,
        y,
        deltaX: event.deltaX,
        deltaY: event.deltaY,
        originalEvent: event
      })) {
        event.preventDefault();
        return;
      }
      if (!this.config.enableZoom) {
        return;
      }
      const plotRect = this.getPlotRect();
      if (!this.isInsidePlot(plotRect, x, y)) {
        return;
      }

      event.preventDefault();
      const factor = event.deltaY > 0 ? 0.9 : 1.1;
      this.applyZoomAtPoint(factor, x, y, "wheel");
    };
    this.bindEvent(this.container, "wheel", wheelHandler, { passive: false });

    const mousedownHandler = (evt: Event) => {
      const event = evt as MouseEvent;
      const rect = this.container.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      if (this.dispatchUiPointerEvent({
        type: "pointerdown",
        x,
        y,
        originalEvent: event
      })) {
        return;
      }
      if (!this.config.enablePan) {
        return;
      }
      const plotRect = this.getPlotRect();
      if (!this.isInsidePlot(plotRect, x, y)) {
        return;
      }
      this.isPanning = true;
      this.lastPanPoint = { x: event.clientX, y: event.clientY };
    };
    this.bindEvent(this.container, "mousedown", mousedownHandler);

    const clickHandler = (evt: Event) => {
      const event = evt as MouseEvent;
      const rect = this.container.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      if (this.dispatchUiPointerEvent({
        type: "click",
        x,
        y,
        originalEvent: event
      })) {
        return;
      }
      const snapshot = this.lastView;
      if (!snapshot || !this.isInsidePlot(snapshot.plotRect, x, y)) {
        return;
      }

      const markerHit = this.findNearestMarkerWithId(x);
      if (markerHit && this.config.onMarkerClick) {
        this.config.onMarkerClick({ marker: markerHit.marker, markerId: markerHit.id });
        return;
      }

      const pointHit = this.findNearestPoint(x, y);
      if (pointHit && this.config.onPointClick) {
        this.config.onPointClick({
          channelId: pointHit.channelId,
          channelName: pointHit.channelName,
          point: pointHit.point,
          value: pointHit.value
        });
      }
    };
    this.bindEvent(this.container, "click", clickHandler);

    const mousemoveHandler = (evt: Event) => {
      const event = evt as MouseEvent;
      const rect = this.container.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const uiConsumed = this.dispatchUiPointerEvent({
        type: "pointermove",
        x,
        y,
        originalEvent: event
      });
      if (this.isPanning && this.lastPanPoint) {
        const dx = event.clientX - this.lastPanPoint.x;
        const dy = event.clientY - this.lastPanPoint.y;
        this.lastPanPoint = { x: event.clientX, y: event.clientY };

        this.axisPos = this.config.liveMode
          ? {
            x: this.axisPos.x,
            y: this.axisPos.y - dy
          }
          : {
            x: this.axisPos.x - dx,
            y: this.axisPos.y - dy
          };
        this.config.axisPos = { ...this.axisPos };
        this.needsRender = true;
        this.emitViewChange("pan");
      }
      if (uiConsumed && !this.isPanning) {
        this.setCursorGuidePoint(null);
        return;
      }
      this.handleHover(event.clientX, event.clientY);
    };
    this.bindEvent(window, "mousemove", mousemoveHandler);

    const mouseleaveHandler = () => {
      this.dispatchUiPointerEvent({
        type: "mouseleave",
        x: -1,
        y: -1
      });
      this.setCursorGuidePoint(null);
      if (this.tooltip) {
        this.tooltip.hide();
      }
    };
    this.bindEvent(this.container, "mouseleave", mouseleaveHandler);

    const mouseupHandler = (evt: Event) => {
      const event = evt as MouseEvent;
      const rect = this.container.getBoundingClientRect();
      this.dispatchUiPointerEvent({
        type: "pointerup",
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
        originalEvent: event
      });
      this.isPanning = false;
      this.lastPanPoint = null;
    };
    this.bindEvent(window, "mouseup", mouseupHandler);

    const dblclickHandler = (evt: Event) => {
      const event = evt as MouseEvent;
      const rect = this.container.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      if (this.dispatchUiPointerEvent({
        type: "dblclick",
        x,
        y,
        originalEvent: event
      })) {
        return;
      }
      this.resetView();
    };
    this.bindEvent(this.container, "dblclick", dblclickHandler);

    const touchstartHandler = (evt: Event) => {
      const event = evt as TouchEvent;
      this.setCursorGuidePoint(null);
      if (event.touches.length === 1) {
        if (!this.config.enablePan) {
          return;
        }
        const rect = this.container.getBoundingClientRect();
        const x = event.touches[0].clientX - rect.left;
        const y = event.touches[0].clientY - rect.top;
        const plotRect = this.getPlotRect();
        if (!this.isInsidePlot(plotRect, x, y)) {
          return;
        }
        this.isPanning = true;
        this.lastPanPoint = { x: event.touches[0].clientX, y: event.touches[0].clientY };
      } else if (event.touches.length === 2) {
        if (!this.config.enableZoom) {
          return;
        }
        const dx = event.touches[0].clientX - event.touches[1].clientX;
        const dy = event.touches[0].clientY - event.touches[1].clientY;
        this.pinchDistance = Math.hypot(dx, dy);
      }
    };
    this.bindEvent(this.container, "touchstart", touchstartHandler, { passive: false });

    const touchmoveHandler = (evt: Event) => {
      const event = evt as TouchEvent;
      if (event.touches.length === 1 && this.isPanning && this.lastPanPoint) {
        event.preventDefault();
        const dx = event.touches[0].clientX - this.lastPanPoint.x;
        const dy = event.touches[0].clientY - this.lastPanPoint.y;
        this.lastPanPoint = { x: event.touches[0].clientX, y: event.touches[0].clientY };

        this.axisPos = this.config.liveMode
          ? {
            x: this.axisPos.x,
            y: this.axisPos.y - dy
          }
          : {
            x: this.axisPos.x - dx,
            y: this.axisPos.y - dy
          };
        this.config.axisPos = { ...this.axisPos };
        this.needsRender = true;
        this.emitViewChange("pan");
      } else if (event.touches.length === 2 && this.config.enableZoom) {
        event.preventDefault();
        const dx = event.touches[0].clientX - event.touches[1].clientX;
        const dy = event.touches[0].clientY - event.touches[1].clientY;
        const distance = Math.hypot(dx, dy);
        if (this.pinchDistance) {
          const factor = distance / this.pinchDistance;
          const rect = this.container.getBoundingClientRect();
          const centerX = (event.touches[0].clientX + event.touches[1].clientX) / 2 - rect.left;
          const centerY = (event.touches[0].clientY + event.touches[1].clientY) / 2 - rect.top;
          this.applyZoomAtPoint(factor, centerX, centerY, "wheel");
        }
        this.pinchDistance = distance;
      }
    };
    this.bindEvent(this.container, "touchmove", touchmoveHandler, { passive: false });

    const touchendHandler = () => {
      this.isPanning = false;
      this.lastPanPoint = null;
      this.pinchDistance = null;
    };
    this.bindEvent(this.container, "touchend", touchendHandler);
  }

  private dispatchUiPointerEvent(event: ViewerUiPointerEvent): boolean {
    const result = this.uiHost.handlePointerEvent(event);
    if (result.consumed) {
      this.needsRender = true;
      return true;
    }
    return false;
  }

  private applyZoomAtPoint(factor: number, pivotX: number, pivotY: number, reason: ViewChangeReason): void {
    if (!Number.isFinite(factor) || factor <= 0) {
      return;
    }

    const plotRect = this.getPlotRect();
    const before = this.getViewMapping(plotRect);
    const xWorldAtMouse = this.pixelToTimeMs(pivotX, before);
    const yWorldAtMouse = this.pixelToY(pivotY, before);

    const newTimeWindow = clamp(this.timeWindow / factor, MIN_TIME_WINDOW, Number.MAX_SAFE_INTEGER);
    const newYWindow = clamp(this.yWindow / factor, MIN_Y_WINDOW, Number.MAX_SAFE_INTEGER);

    this.timeWindow = newTimeWindow;
    this.yWindow = newYWindow;
    this.config.timeWindow = newTimeWindow;
    this.config.yWindow = newYWindow;

    const msPerPx = this.timeWindow / plotRect.width;
    const yPerPx = this.yWindow / plotRect.height;

    const newOriginX = pivotX + xWorldAtMouse / msPerPx;
    const newOriginY = pivotY + yWorldAtMouse / yPerPx;

    this.axisPos = {
      x: plotRect.right - newOriginX,
      y: plotRect.bottom - newOriginY
    };
    this.config.axisPos = { ...this.axisPos };

    this.needsRender = true;
    this.emitViewChange(reason);
  }

  private handleHover(clientX: number, clientY: number): void {
    const snapshot = this.lastView;
    if (!snapshot) {
      this.setCursorGuidePoint(null);
      if (this.tooltip) {
        this.tooltip.hide();
      }
      return;
    }
    const rect = this.container.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const insidePlot = this.isInsidePlot(snapshot.plotRect, x, y);
    this.setCursorGuidePoint(insidePlot ? { x, y } : null);

    if (!this.tooltip || !this.config.enableTooltip) {
      return;
    }
    if (!insidePlot) {
      this.tooltip.hide();
      return;
    }

    const marker = this.findNearestMarker(x);
    if (marker) {
      const content = `${marker.label}\n${JSON.stringify(marker.metadata ?? {}, null, 2)}`;
      this.tooltip.show(x + 8, y + 8, content);
      return;
    }

    const pointResult = this.findNearestPoint(x, y);
    if (!pointResult) {
      this.tooltip.hide();
      return;
    }

    const metadata = pointResult.point.metadata ? `\n${JSON.stringify(pointResult.point.metadata, null, 2)}` : "";
    const content = `Canale: ${pointResult.channelName}\nTimestamp: ${pointResult.point.timestamp}\nValore: ${pointResult.value}${metadata}`;
    this.tooltip.show(x + 8, y + 8, content);
  }

  private findNearestMarker(x: number): Marker | null {
    const snapshot = this.lastView;
    if (!snapshot || snapshot.baseTimestamp === null) {
      return null;
    }

    let closest: Marker | null = null;
    let minDistance = 6;
    this.markerStore.list().forEach(({ marker }) => {
      const xElapsedMs = marker.timestamp - snapshot.baseTimestamp!;
      const markerX = snapshot.mapping.originX - xElapsedMs / snapshot.mapping.msPerPx;
      if (markerX < snapshot.plotRect.left || markerX > snapshot.plotRect.right) {
        return;
      }
      const distance = Math.abs(markerX - x);
      if (distance < minDistance) {
        minDistance = distance;
        closest = marker;
      }
    });
    return closest;
  }

  private findNearestMarkerWithId(x: number): { id: string; marker: Marker } | null {
    const snapshot = this.lastView;
    if (!snapshot || snapshot.baseTimestamp === null) {
      return null;
    }

    let closest: { id: string; marker: Marker } | null = null;
    let minDistance = 6;
    this.markerStore.list().forEach(({ id, marker }) => {
      const xElapsedMs = marker.timestamp - snapshot.baseTimestamp!;
      const markerX = snapshot.mapping.originX - xElapsedMs / snapshot.mapping.msPerPx;
      if (markerX < snapshot.plotRect.left || markerX > snapshot.plotRect.right) {
        return;
      }
      const distance = Math.abs(markerX - x);
      if (distance < minDistance) {
        minDistance = distance;
        closest = { id, marker };
      }
    });
    return closest;
  }

  private findNearestPoint(
    x: number,
    y: number
  ): { point: DataPoint; value: number; channelName: string; channelId: string } | null {
    const snapshot = this.lastView;
    if (!snapshot || snapshot.baseTimestamp === null || snapshot.timestampRange === null) {
      return null;
    }

    let closest: { point: DataPoint; value: number; channelName: string; channelId: string } | null = null;
    let minDistance = 10;

    this.channels.forEach((channel, channelId) => {
      const config = channel.getConfig();
      if (!config.visible) {
        return;
      }
      const segments = this.dataBuffer.getSegmentsInRange(
        channelId,
        snapshot.timestampRange![0],
        snapshot.timestampRange![1]
      );
      segments.forEach((segment) => {
        segment.points.forEach((point) => {
          const value = getPointValue(point, this.config.viewMode);
          if (value === undefined) {
            return;
          }

          const xElapsedMs = point.timestamp - snapshot.baseTimestamp!;
          const px = snapshot.mapping.originX - xElapsedMs / snapshot.mapping.msPerPx;
          const py = snapshot.mapping.originY - value / snapshot.mapping.yPerPx;

          if (!this.isInsidePlot(snapshot.plotRect, px, py)) {
            return;
          }

          const dx = px - x;
          const dy = py - y;
          const distance = Math.sqrt(dx * dx + dy * dy);
          if (distance < minDistance) {
            minDistance = distance;
            closest = { point, value, channelName: config.name, channelId };
          }
        });
      });
    });

    return closest;
  }

  private attachResizeObserver(): void {
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    this.resizeObserver = new ResizeObserver((entries) => {
      entries.forEach((entry) => {
        const measuredWidth = this.container.clientWidth > 0
          ? this.container.clientWidth
          : Math.round(entry.contentRect.width);
        const measuredHeight = this.container.clientHeight > 0
          ? this.container.clientHeight
          : Math.round(entry.contentRect.height);
        if ((this.autoWidthFromContainer && measuredWidth <= 0) || (this.autoHeightFromContainer && measuredHeight <= 0)) {
          return;
        }
        const prevPlot = this.getPlotRect();
        const nextWidth = this.autoWidthFromContainer ? measuredWidth : this.config.width;
        const nextHeight = this.autoHeightFromContainer ? measuredHeight : this.config.height;
        if (nextWidth === this.config.width && nextHeight === this.config.height) {
          return;
        }
        this.config.width = nextWidth;
        this.config.height = nextHeight;
        this.refreshUiLayoutWithBase(prevPlot, true, "resize");
        this.resize();
      });
    });
    this.resizeObserver.observe(this.container);
  }

  private resize(): void {
    const dpr = window.devicePixelRatio || 1;
    this.markerCanvas.width = Math.floor(this.config.width * dpr);
    this.markerCanvas.height = Math.floor(this.config.height * dpr);
    this.markerCanvas.style.width = `${this.config.width}px`;
    this.markerCanvas.style.height = `${this.config.height}px`;
    this.channels.forEach((channel) => {
      channel.resize(this.config.width, this.config.height, dpr);
    });
  }

  private refreshUiLayout(reframeView: boolean, reason?: ViewChangeReason): void {
    const previousPlot = this.getPlotRect();
    this.refreshUiLayoutWithBase(previousPlot, reframeView, reason);
  }

  private refreshUiLayoutIfNeeded(): void {
    const previousPlot = this.getPlotRect();
    this.refreshUiLayoutWithBase(previousPlot, false);
  }

  private refreshUiLayoutWithBase(previousPlot: PlotRect, reframeView: boolean, reason?: ViewChangeReason): void {
    const provisionalState = this.buildUiComponentState(previousPlot);
    const nextInsets = this.uiHost.computeReservedInsets(provisionalState);
    const nextPlot = this.getPlotRectFromSize(this.config.width, this.config.height, nextInsets);
    const insetsChanged = !sameInsets(this.uiInsets, nextInsets);
    const plotChanged = insetsChanged || !samePlotRect(previousPlot, nextPlot);
    if (reframeView && plotChanged) {
      this.reframeViewForResize(previousPlot, nextPlot);
    }

    this.uiInsets = nextInsets;
    this.plotRect = nextPlot;

    const finalState = this.buildUiComponentState(nextPlot);
    this.uiHost.sync(finalState);
    this.uiHost.layout(finalState, nextInsets);
    this.needsRender = true;

    if (reason) {
      this.emitViewChange(reason);
      return;
    }
    if (plotChanged) {
      this.emitViewChange("uiLayout");
    }
  }

  private syncUiComponents(): void {
    const state = this.buildUiComponentState(this.getPlotRect());
    this.uiHost.sync(state);
    this.uiHost.layout(state, this.uiInsets);
    this.needsRender = true;
  }

  private buildUiComponentState(plotRect: PlotRect): ViewerUiComponentState {
    const channels = Array.from(this.channels.entries()).map(([id, channel]) => ({
      id,
      config: { ...channel.getConfig() }
    }));
    return buildUiState(
      this.config.width,
      this.config.height,
      window.devicePixelRatio || 1,
      channels,
      { ...this.config.channelToolbar },
      {
        x: plotRect.left,
        y: plotRect.top,
        width: plotRect.width,
        height: plotRect.height
      }
    );
  }

  private getChannel(id: string): Channel {
    const channel = this.channels.get(id);
    if (!channel) {
      throw new Error("Channel not found");
    }
    return channel;
  }

  private bindEvent(
    target: EventTarget,
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: AddEventListenerOptions | boolean
  ): void {
    target.addEventListener(type, listener, options);
    this.cleanupCallbacks.push(() => {
      target.removeEventListener(type, listener, options);
    });
  }

  private getPlotRect(): PlotRect {
    return this.plotRect;
  }

  private getPlotRectFromSize(width: number, height: number, uiInsets: UiInsets): PlotRect {
    const rawRight = width - uiInsets.right;
    const rawBottom = height - BASE_INSETS.bottom - uiInsets.bottom;
    const rawLeft = BASE_INSETS.left + uiInsets.left;
    const rawTop = BASE_INSETS.top + uiInsets.top;
    const left = clamp(rawLeft, 0, Math.max(0, width - 1));
    const top = clamp(rawTop, 0, Math.max(0, height - 1));
    const right = clamp(rawRight, left + 1, Math.max(left + 1, width));
    const bottom = clamp(rawBottom, top + 1, Math.max(top + 1, height));
    return {
      left,
      top,
      right,
      bottom,
      width: Math.max(1, right - left),
      height: Math.max(1, bottom - top)
    };
  }

  private reframeViewForResize(previousPlot: PlotRect, nextPlot: PlotRect): void {
    if (previousPlot.width <= 0 || previousPlot.height <= 0) {
      return;
    }
    const widthScale = nextPlot.width / previousPlot.width;
    const heightScale = nextPlot.height / previousPlot.height;
    if (Number.isFinite(widthScale) && widthScale > 0) {
      this.timeWindow = Math.max(MIN_TIME_WINDOW, this.timeWindow * widthScale);
      this.config.timeWindow = this.timeWindow;
    }
    if (Number.isFinite(heightScale) && heightScale > 0) {
      this.yWindow = Math.max(MIN_Y_WINDOW, this.yWindow * heightScale);
      this.config.yWindow = this.yWindow;
    }
    this.axisPos = {
      x: this.axisPos.x + (nextPlot.right - previousPlot.right),
      y: this.axisPos.y + (nextPlot.bottom - previousPlot.bottom)
    };
    this.config.axisPos = { ...this.axisPos };
  }

  private getViewMapping(plotRect: PlotRect): ViewMapping {
    const msPerPx = this.timeWindow / plotRect.width;
    const yPerPx = this.yWindow / plotRect.height;
    const originX = plotRect.right - this.axisPos.x;
    const originY = plotRect.bottom - this.axisPos.y;
    return {
      msPerPx,
      yPerPx,
      originX,
      originY
    };
  }

  private getVisibleRanges(plotRect: PlotRect, mapping: ViewMapping): VisibleRanges {
    const leftTime = this.pixelToTimeMs(plotRect.left, mapping);
    const rightTime = this.pixelToTimeMs(plotRect.right, mapping);
    const topY = this.pixelToY(plotRect.top, mapping);
    const bottomY = this.pixelToY(plotRect.bottom, mapping);

    return {
      timeMs: [Math.min(leftTime, rightTime), Math.max(leftTime, rightTime)],
      y: [Math.min(topY, bottomY), Math.max(topY, bottomY)]
    };
  }

  private toTimestampRange(baseTimestamp: number, timeMsRange: [number, number]): [number, number] {
    const start = baseTimestamp + timeMsRange[0];
    const end = baseTimestamp + timeMsRange[1];
    return [Math.min(start, end), Math.max(start, end)];
  }

  private pixelToTimeMs(xPx: number, mapping: ViewMapping): number {
    return (mapping.originX - xPx) * mapping.msPerPx;
  }

  private pixelToY(yPx: number, mapping: ViewMapping): number {
    return (mapping.originY - yPx) * mapping.yPerPx;
  }

  private isInsidePlot(plotRect: PlotRect, x: number, y: number): boolean {
    return x >= plotRect.left && x <= plotRect.right && y >= plotRect.top && y <= plotRect.bottom;
  }

  private setCursorGuidePoint(point: { x: number; y: number } | null): void {
    if (!this.config.enableCursorGuide) {
      if (this.cursorGuidePoint !== null) {
        this.cursorGuidePoint = null;
        this.needsRender = true;
      }
      return;
    }

    if (point === null) {
      if (this.cursorGuidePoint !== null) {
        this.cursorGuidePoint = null;
        this.needsRender = true;
      }
      return;
    }

    if (
      this.cursorGuidePoint !== null &&
      Math.abs(this.cursorGuidePoint.x - point.x) < 0.1 &&
      Math.abs(this.cursorGuidePoint.y - point.y) < 0.1
    ) {
      return;
    }

    this.cursorGuidePoint = { x: point.x, y: point.y };
    this.needsRender = true;
  }

  private maybeRestoreGapThresholdAfterForegroundData(): void {
    if (!this.restoreGapThresholdOnNextData) {
      return;
    }
    this.restoreGapThresholdOnNextData = false;
    this.gapRelaxedForHiddenTab = false;
    this.dataBuffer.setMaxGapMs(this.configuredMaxGapMs);
  }

  private handleVisibilityStateChange(): void {
    if (!this.config.preserveContinuityOnHiddenTab) {
      this.gapRelaxedForHiddenTab = false;
      this.restoreGapThresholdOnNextData = false;
      this.dataBuffer.setMaxGapMs(this.configuredMaxGapMs);
      return;
    }

    if (document.visibilityState === "hidden") {
      this.gapRelaxedForHiddenTab = true;
      this.restoreGapThresholdOnNextData = false;
      this.dataBuffer.setMaxGapMs(Number.POSITIVE_INFINITY);
      return;
    }

    if (this.gapRelaxedForHiddenTab) {
      this.restoreGapThresholdOnNextData = true;
    } else {
      this.dataBuffer.setMaxGapMs(this.configuredMaxGapMs);
    }
    this.needsRender = true;
    if (this.config.liveMode) {
      this.emitViewChange("liveTick");
    }
  }
}

const resolveViewerConfig = (container: HTMLElement, config: ViewerConfig): ResolvedViewerConfig => {
  const width = config.width ?? container.clientWidth;
  const height = config.height ?? container.clientHeight;
  if (!width || !height) {
    throw new Error("Viewer size is required");
  }

  const timeWindow = config.timeWindow ?? 5000;
  const yWindow = config.yWindow ?? 2;

  if (timeWindow <= 0) {
    throw new Error("timeWindow must be greater than zero");
  }
  if (yWindow <= 0) {
    throw new Error("yWindow must be greater than zero");
  }

  const axisPos: AxisPositionPx = {
    x: config.axisPos?.x ?? 0,
    y: config.axisPos?.y ?? 0
  };

  return {
    width,
    height,
    backgroundColor: config.backgroundColor ?? "#FFFFFF",
    timeWindow,
    yWindow,
    axisPos,
    channelToolbar: resolveChannelToolbarConfig(config.channelToolbar),
    liveMode: config.liveMode ?? true,
    viewMode: config.viewMode ?? "waveform",
    maxGapMs: config.maxGapMs ?? 50,
    preserveContinuityOnHiddenTab: config.preserveContinuityOnHiddenTab ?? false,
    enableCursorGuide: config.enableCursorGuide ?? true,
    cursorGuidePrecision: normalizeCursorGuidePrecision(config.cursorGuidePrecision),
    enableTooltip: config.enableTooltip ?? true,
    enableZoom: config.enableZoom ?? true,
    enablePan: config.enablePan ?? true,
    onPointClick: config.onPointClick,
    onMarkerClick: config.onMarkerClick,
    onViewChange: config.onViewChange
  };
};

const validateChannelConfig = (config: ChannelConfig): void => {
  if (!config.name) {
    throw new Error("Channel name is required");
  }
  if (!config.color) {
    throw new Error("Channel color is required");
  }
  if (config.alpha === undefined) {
    throw new Error("Channel alpha is required");
  }
  if (config.lineWidth === undefined) {
    throw new Error("Channel lineWidth is required");
  }
  if (config.lineStyle === undefined) {
    throw new Error("Channel lineStyle is required");
  }
  if (config.visible === undefined) {
    throw new Error("Channel visible flag is required");
  }
};

const getPointValue = (point: DataPoint, mode: ViewMode): number | undefined => {
  if (mode === "waveform") {
    return point.value;
  }
  if (mode === "rms") {
    return point.rms;
  }
  return point.featureValue;
};

const getPointStyle = (point: DataPoint, fallback: RenderStyle): RenderStyle => {
  return {
    color: point.color ?? fallback.color,
    alpha: point.alpha ?? fallback.alpha,
    lineWidth: point.lineWidth ?? fallback.lineWidth,
    lineStyle: point.lineStyle ?? fallback.lineStyle
  };
};

const sameStyle = (a: RenderStyle, b: RenderStyle): boolean => {
  if (a.color !== b.color) {
    return false;
  }
  if (a.alpha !== b.alpha || a.lineWidth !== b.lineWidth) {
    return false;
  }
  if (Array.isArray(a.lineStyle) || Array.isArray(b.lineStyle)) {
    return JSON.stringify(a.lineStyle) === JSON.stringify(b.lineStyle);
  }
  return a.lineStyle === b.lineStyle;
};

const normalizeCursorGuidePrecision = (precision?: CursorGuidePrecision): CursorGuidePrecision => {
  if (!precision) {
    return {};
  }

  return {
    xMs: normalizePrecisionValue(precision.xMs, "cursorGuidePrecision.xMs"),
    y: normalizePrecisionValue(precision.y, "cursorGuidePrecision.y")
  };
};

const normalizePrecisionValue = (value: number | undefined, fieldName: string): number | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${fieldName} must be a non-negative finite number`);
  }
  return Math.floor(value);
};

const resolveGuidePrecision = (configured: number | undefined, unitsPerPx: number, maxDecimals: number): number => {
  if (configured !== undefined) {
    return configured;
  }
  if (!Number.isFinite(unitsPerPx) || unitsPerPx <= 0) {
    return 0;
  }
  const decimals = Math.ceil(-Math.log10(unitsPerPx));
  return Math.max(0, Math.min(maxDecimals, decimals));
};

const formatYLabel = (value: number, span: number): string => {
  if (span === 0) {
    return String(value);
  }
  if (span < 0.01) {
    return value.toExponential(1);
  }
  if (span < 0.1) {
    return value.toFixed(4);
  }
  if (span < 1) {
    return value.toFixed(3);
  }
  if (span < 10) {
    return value.toFixed(2);
  }
  if (span < 100) {
    return value.toFixed(1);
  }
  return value.toFixed(0);
};

const formatTimeLabel = (tick: number, timeSpan: number): string => {
  if (timeSpan < 2000) {
    return `${tick.toFixed(0)} ms`;
  }
  if (timeSpan < 60000) {
    return `${(tick / 1000).toFixed(2)} s`;
  }
  return `${(tick / 1000).toFixed(1)} s`;
};

const samePlotRect = (a: PlotRect, b: PlotRect): boolean => {
  return (
    a.left === b.left &&
    a.top === b.top &&
    a.right === b.right &&
    a.bottom === b.bottom &&
    a.width === b.width &&
    a.height === b.height
  );
};

const resolveChannelToolbarConfig = (config?: ChannelToolbarConfig): ResolvedChannelToolbarConfig => {
  const enabled = config?.enabled ?? false;
  const position = resolveChannelToolbarPosition(config?.position);
  const thicknessPx = resolveToolbarThickness(config?.thicknessPx);
  return {
    enabled,
    position,
    thicknessPx
  };
};

const resolveChannelToolbarPosition = (position: ChannelToolbarPosition | undefined): ChannelToolbarPosition => {
  if (!position) {
    return "top";
  }
  if (position === "top" || position === "bottom" || position === "left" || position === "right") {
    return position;
  }
  throw new Error("channelToolbar.position must be one of top|bottom|left|right");
};

const resolveToolbarThickness = (thicknessPx: number | undefined): number => {
  if (thicknessPx === undefined) {
    return 40;
  }
  if (!Number.isFinite(thicknessPx) || thicknessPx < 0) {
    throw new Error("channelToolbar.thicknessPx must be a non-negative finite number");
  }
  return Math.floor(thicknessPx);
};

export * from "./types.js";
