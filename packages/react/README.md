# @mdckiller/audio-waveform-viewer-react

React wrapper for `@mdckiller/audio-waveform-viewer`.

## Install

```bash
npm i @mdckiller/audio-waveform-viewer @mdckiller/audio-waveform-viewer-react
```

## Usage

```tsx
import { useMemo, useRef } from "react";
import {
  AudioWaveform,
  type AudioWaveformHandle,
  type ViewerChannelDefinition
} from "@mdckiller/audio-waveform-viewer-react";

export function Example() {
  const viewerRef = useRef<AudioWaveformHandle>(null);
  const channels = useMemo<ViewerChannelDefinition[]>(
    () => [
      {
        id: "sine",
        config: {
          name: "SINE",
          color: "#4da3ff",
          alpha: 1,
          lineWidth: 2,
          lineStyle: "solid",
          visible: true
        }
      }
    ],
    []
  );

  return (
    <div style={{ width: 900, height: 420 }}>
      <AudioWaveform
        ref={viewerRef}
        config={{
          timeWindow: 8000,
          yWindow: 2,
          axisPos: { x: 0, y: 0 },
          liveMode: true
        }}
        channels={channels}
        onReady={(viewer) => {
          viewer.addDataPoint("sine", { timestamp: Date.now(), value: 1 });
        }}
      />
    </div>
  );
}
```

`ref.current?.getViewer()` returns the core `AudioWaveformViewer` instance, so you can call API methods (`addDataPoint`, `setLiveMode`, `setTimeWindow`, etc.).
