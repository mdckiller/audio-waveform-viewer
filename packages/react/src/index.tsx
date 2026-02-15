import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  type CSSProperties,
  type MutableRefObject
} from "react";
import { AudioWaveformViewer } from "@mdckiller/audio-waveform-viewer";
import type {
  AxisPositionPx,
  ChannelConfig,
  ChannelToolbarConfig,
  CursorGuidePrecision,
  ViewerConfig
} from "@mdckiller/audio-waveform-viewer";

export interface ViewerChannelDefinition {
  id: string;
  config: ChannelConfig;
}

export interface AudioWaveformProps {
  config: ViewerConfig;
  channels?: ViewerChannelDefinition[];
  className?: string;
  style?: CSSProperties;
  onReady?: (viewer: AudioWaveformViewer) => void;
}

export interface AudioWaveformHandle {
  getViewer: () => AudioWaveformViewer | null;
}

export interface UseAudioWaveformViewerOptions {
  config: ViewerConfig;
  channels?: ViewerChannelDefinition[];
  onReady?: (viewer: AudioWaveformViewer) => void;
}

export interface UseAudioWaveformViewerResult {
  containerRef: MutableRefObject<HTMLDivElement | null>;
  viewerRef: MutableRefObject<AudioWaveformViewer | null>;
}

const cloneAxisPos = (axisPos?: AxisPositionPx): AxisPositionPx | undefined => {
  if (!axisPos) {
    return undefined;
  }
  return { ...axisPos };
};

const cloneCursorGuidePrecision = (
  precision?: CursorGuidePrecision
): CursorGuidePrecision | undefined => {
  if (!precision) {
    return undefined;
  }
  return { ...precision };
};

const cloneChannelToolbar = (toolbar?: ChannelToolbarConfig): ChannelToolbarConfig | undefined => {
  if (!toolbar) {
    return undefined;
  }
  return { ...toolbar };
};

const cloneChannelConfig = (config: ChannelConfig): ChannelConfig => {
  return {
    ...config,
    lineStyle: Array.isArray(config.lineStyle) ? [...config.lineStyle] : config.lineStyle
  };
};

const cloneViewerConfig = (config: ViewerConfig): ViewerConfig => {
  return {
    ...config,
    axisPos: cloneAxisPos(config.axisPos),
    cursorGuidePrecision: cloneCursorGuidePrecision(config.cursorGuidePrecision),
    channelToolbar: cloneChannelToolbar(config.channelToolbar)
  };
};

const sameAxisPos = (a?: AxisPositionPx, b?: AxisPositionPx): boolean => {
  if (!a && !b) {
    return true;
  }
  if (!a || !b) {
    return false;
  }
  return a.x === b.x && a.y === b.y;
};

const sameCursorGuidePrecision = (a?: CursorGuidePrecision, b?: CursorGuidePrecision): boolean => {
  if (!a && !b) {
    return true;
  }
  if (!a || !b) {
    return false;
  }
  return a.xMs === b.xMs && a.y === b.y;
};

const sameChannelToolbarConfig = (a?: ChannelToolbarConfig, b?: ChannelToolbarConfig): boolean => {
  if (!a && !b) {
    return true;
  }
  if (!a || !b) {
    return false;
  }
  return a.enabled === b.enabled && a.position === b.position && a.thicknessPx === b.thicknessPx;
};

const sameLineStyle = (a: ChannelConfig["lineStyle"], b: ChannelConfig["lineStyle"]): boolean => {
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return false;
    }
    for (let i = 0; i < a.length; i += 1) {
      if (a[i] !== b[i]) {
        return false;
      }
    }
    return true;
  }
  return a === b;
};

const sameChannelConfig = (a: ChannelConfig, b: ChannelConfig): boolean => {
  return (
    a.name === b.name &&
    a.color === b.color &&
    a.alpha === b.alpha &&
    a.lineWidth === b.lineWidth &&
    a.visible === b.visible &&
    a.zIndex === b.zIndex &&
    sameLineStyle(a.lineStyle, b.lineStyle)
  );
};

const syncChannels = (
  viewer: AudioWaveformViewer,
  previous: Map<string, ChannelConfig>,
  nextChannels: ViewerChannelDefinition[]
): void => {
  const nextMap = new Map<string, ChannelConfig>();
  nextChannels.forEach((entry) => {
    nextMap.set(entry.id, cloneChannelConfig(entry.config));
  });

  previous.forEach((_config, channelId) => {
    if (!nextMap.has(channelId)) {
      viewer.removeChannel(channelId);
    }
  });

  nextMap.forEach((nextConfig, channelId) => {
    const prevConfig = previous.get(channelId);
    if (!prevConfig) {
      viewer.addChannel(channelId, nextConfig);
      return;
    }
    if (!sameChannelConfig(prevConfig, nextConfig)) {
      viewer.updateChannelConfig(channelId, nextConfig);
    }
  });

  previous.clear();
  nextMap.forEach((config, channelId) => {
    previous.set(channelId, cloneChannelConfig(config));
  });
};

const applyConfigDiff = (
  viewer: AudioWaveformViewer,
  previous: ViewerConfig,
  next: ViewerConfig
): void => {
  const prevHasFixedSize = typeof previous.width === "number" && typeof previous.height === "number";
  const nextHasFixedSize = typeof next.width === "number" && typeof next.height === "number";

  if (nextHasFixedSize) {
    if (!prevHasFixedSize || previous.width !== next.width || previous.height !== next.height) {
      viewer.setSize(next.width!, next.height!);
    }
  } else if (prevHasFixedSize) {
    viewer.setAutoSize("100%", "100%");
  }

  if (typeof next.timeWindow === "number" && next.timeWindow !== previous.timeWindow) {
    viewer.setTimeWindow(next.timeWindow);
  }
  if (typeof next.yWindow === "number" && next.yWindow !== previous.yWindow) {
    viewer.setYWindow(next.yWindow);
  }
  if (next.axisPos && !sameAxisPos(previous.axisPos, next.axisPos)) {
    viewer.setAxisPos(next.axisPos);
  }
  if (
    next.channelToolbar &&
    !sameChannelToolbarConfig(previous.channelToolbar, next.channelToolbar)
  ) {
    viewer.setChannelToolbar(next.channelToolbar);
  }
  if (typeof next.liveMode === "boolean" && next.liveMode !== previous.liveMode) {
    viewer.setLiveMode(next.liveMode);
  }
  if (next.viewMode && next.viewMode !== previous.viewMode) {
    viewer.setViewMode(next.viewMode);
  }
  if (
    typeof next.enableCursorGuide === "boolean" &&
    next.enableCursorGuide !== previous.enableCursorGuide
  ) {
    viewer.setEnableCursorGuide(next.enableCursorGuide);
  }
  if (!sameCursorGuidePrecision(previous.cursorGuidePrecision, next.cursorGuidePrecision)) {
    viewer.setCursorGuidePrecision(next.cursorGuidePrecision);
  }
  if (
    typeof next.preserveContinuityOnHiddenTab === "boolean" &&
    next.preserveContinuityOnHiddenTab !== previous.preserveContinuityOnHiddenTab
  ) {
    viewer.setPreserveContinuityOnHiddenTab(next.preserveContinuityOnHiddenTab);
  }
};

export const useAudioWaveformViewer = (
  options: UseAudioWaveformViewerOptions
): UseAudioWaveformViewerResult => {
  const { config, channels = [], onReady } = options;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<AudioWaveformViewer | null>(null);
  const previousConfigRef = useRef<ViewerConfig | null>(null);
  const previousChannelsRef = useRef<Map<string, ChannelConfig>>(new Map());

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const initialConfig = cloneViewerConfig(config);
    const viewer = new AudioWaveformViewer(container, initialConfig);
    viewerRef.current = viewer;
    previousConfigRef.current = initialConfig;
    syncChannels(viewer, previousChannelsRef.current, channels);
    if (onReady) {
      onReady(viewer);
    }

    return () => {
      viewer.destroy();
      viewerRef.current = null;
      previousConfigRef.current = null;
      previousChannelsRef.current.clear();
    };
  }, []);

  useEffect(() => {
    const viewer = viewerRef.current;
    const previous = previousConfigRef.current;
    if (!viewer || !previous) {
      return;
    }
    const next = cloneViewerConfig(config);
    applyConfigDiff(viewer, previous, next);
    previousConfigRef.current = next;
  }, [config]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) {
      return;
    }
    syncChannels(viewer, previousChannelsRef.current, channels);
  }, [channels]);

  return {
    containerRef,
    viewerRef
  };
};

export const AudioWaveform = forwardRef<AudioWaveformHandle, AudioWaveformProps>(
  ({ config, channels = [], className, style, onReady }, ref) => {
    const { containerRef, viewerRef } = useAudioWaveformViewer({
      config,
      channels,
      onReady
    });

    useImperativeHandle(
      ref,
      () => ({
        getViewer: () => viewerRef.current
      }),
      [viewerRef]
    );

    return (
      <div
        ref={containerRef}
        className={className}
        style={{ width: "100%", height: "100%", ...style }}
      />
    );
  }
);

AudioWaveform.displayName = "AudioWaveform";

export { AudioWaveformViewer };
export type {
  AxisPositionPx,
  ChannelConfig,
  ChannelToolbarConfig,
  CursorGuidePrecision,
  ViewerConfig
} from "@mdckiller/audio-waveform-viewer";
