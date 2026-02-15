<p align="center">
  <h1 align="center">Audio Waveform Viewer</h1>
  <p align="center">
    High-performance WebGL real-time multi-channel waveform renderer for the browser.
    <br />
    Zero dependencies &middot; TypeScript &middot; React wrapper included
  </p>
</p>

<p align="center">
  <a href="#features">Features</a> &middot;
  <a href="#installation">Installation</a> &middot;
  <a href="#quick-start">Quick Start</a> &middot;
  <a href="https://mdckiller.github.io/audio-waveform-viewer/">Live Demo</a> &middot;
  <a href="#react">React</a> &middot;
  <a href="#api">API</a> &middot;
  <a href="#license">License</a>
</p>

---

## Features

| Category | Details |
|---|---|
| **Rendering** | WebGL-accelerated line rendering, per-channel canvas layers, dashed / dotted / custom dash patterns |
| **Multi-channel** | Up to 10 independent channels with individual color, alpha, line width, visibility and z-index |
| **Live mode** | Auto-panning timeline that follows incoming data; auto Y-axis expansion |
| **View model** | `timeWindow` (ms visible), `yWindow` (Y-units visible), `axisPos` (axis offset in px) |
| **Interaction** | Wheel zoom (X/Y), click-drag pan, cursor guide with configurable precision |
| **Markers** | Vertical marker lines with label, color, style and click callback |
| **Channel toolbar** | Built-in WebGL toolbar (top / bottom / left / right), toggle visibility, auto-contrast check icon, overflow scroll |
| **Pluggable UI** | Register custom `ViewerUiComponent` instances that reserve layout insets and receive pointer events |
| **View modes** | `waveform` · `rms` · `features` — switchable at runtime |
| **Per-point styling** | Override color, alpha, line width, line style and metadata on individual data points |
| **Responsive** | `setAutoSize("100%", "100%")` or fixed `setSize(w, h)`; built-in `ResizeObserver` |
| **Hidden-tab continuity** | Optional gap-bridging when the browser tab is backgrounded |
| **Tooltip** | Built-in tooltip on hover with channel name, timestamp and value |
| **Data buffer** | Segmented ring buffer with configurable `maxGapMs` for gap detection |
| **React wrapper** | `<AudioWaveform>` component + `useAudioWaveformViewer` hook (separate package) |

## Installation

```bash
# core library
npm install @mdckiller/audio-waveform-viewer

# React wrapper (optional)
npm install @mdckiller/audio-waveform-viewer-react
```

## Quick Start

```ts
import { AudioWaveformViewer } from "@mdckiller/audio-waveform-viewer";

const viewer = new AudioWaveformViewer(document.getElementById("viewer")!, {
  timeWindow: 8000,
  yWindow: 2,
  axisPos: { x: 0, y: 0 },
  liveMode: true,
  channelToolbar: { enabled: true, position: "top", thicknessPx: 40 },
  enableCursorGuide: true,
  onViewChange: (view) => console.log(view.reason, view.timeWindow),
});

viewer.addChannel("ch1", {
  name: "Sensor A",
  color: "#4da3ff",
  alpha: 1,
  lineWidth: 2,
  lineStyle: "solid",
  visible: true,
});

// push data (e.g. from a WebSocket)
viewer.addDataPoint("ch1", { timestamp: Date.now(), value: 0.42 });
```

## React

```tsx
import { useRef, useMemo } from "react";
import {
  AudioWaveform,
  type AudioWaveformHandle,
  type ViewerChannelDefinition,
} from "@mdckiller/audio-waveform-viewer-react";

function Live() {
  const ref = useRef<AudioWaveformHandle>(null);

  const channels = useMemo<ViewerChannelDefinition[]>(() => [
    {
      id: "sine",
      config: {
        name: "SINE",
        color: "#4da3ff",
        alpha: 1,
        lineWidth: 2,
        lineStyle: "solid",
        visible: true,
      },
    },
  ], []);

  return (
    <div style={{ width: 900, height: 420 }}>
      <AudioWaveform
        ref={ref}
        config={{
          timeWindow: 8000,
          yWindow: 2,
          axisPos: { x: 0, y: 0 },
          liveMode: true,
        }}
        channels={channels}
        onReady={(viewer) => {
          // start pushing data
        }}
      />
    </div>
  );
}
```

Access the core instance via `ref.current?.getViewer()`.

## API

### Constructor options (`ViewerConfig`)

| Option | Type | Description |
|---|---|---|
| `timeWindow` | `number` | Visible time span in milliseconds |
| `yWindow` | `number` | Visible Y-axis range (symmetric around origin) |
| `axisPos` | `{ x, y }` | Axis origin offset in pixels from bottom-right of plot area |
| `liveMode` | `boolean` | Auto-pan to latest data |
| `viewMode` | `"waveform" \| "rms" \| "features"` | Active view mode |
| `channelToolbar` | `{ enabled, position, thicknessPx }` | Built-in toolbar config |
| `enableCursorGuide` | `boolean` | Show crosshair cursor |
| `cursorGuidePrecision` | `{ xMs?, y? }` | Snap precision for cursor guide |
| `maxGapMs` | `number` | Threshold to split data into segments |
| `preserveContinuityOnHiddenTab` | `boolean` | Bridge gaps when tab is backgrounded |
| `enableTooltip` | `boolean` | Show tooltip on hover |
| `enableZoom` | `boolean` | Enable mouse-wheel zoom |
| `enablePan` | `boolean` | Enable click-drag panning |
| `backgroundColor` | `string` | Container background color |
| `width` / `height` | `number` | Fixed size (omit for auto-size) |
| `onViewChange` | `(payload) => void` | Callback on any view change |
| `onPointClick` | `(payload) => void` | Callback on data point click |
| `onMarkerClick` | `(payload) => void` | Callback on marker click |

### Instance methods

| Method | Description |
|---|---|
| `addChannel(id, config)` | Register a new channel |
| `removeChannel(id)` | Remove a channel |
| `updateChannelConfig(id, partial)` | Update channel style/visibility |
| `setChannelVisibility(id, visible)` | Toggle channel visibility |
| `addData(channelId, points[])` | Push a batch of data points |
| `addDataPoint(channelId, point)` | Push a single data point |
| `addMarker(marker)` | Add a vertical marker, returns `markerId` |
| `removeMarker(markerId)` | Remove a marker |
| `updateMarker(markerId, partial)` | Update marker properties |
| `setTimeWindow(ms)` | Set visible time span |
| `setYWindow(units)` | Set visible Y range |
| `setAxisPos({ x, y })` | Set axis origin offset |
| `setLiveMode(enabled)` | Toggle live auto-pan |
| `setViewMode(mode)` | Switch between waveform / rms / features |
| `setSize(width, height)` | Set fixed pixel size |
| `setAutoSize(wCss, hCss)` | Switch to responsive sizing |
| `setChannelToolbar(partial)` | Update toolbar config |
| `setEnableCursorGuide(enabled)` | Toggle cursor guide |
| `setCursorGuidePrecision(precision)` | Set cursor guide snap |
| `setPreserveContinuityOnHiddenTab(enabled)` | Toggle hidden-tab bridging |
| `registerUiComponent(component)` | Add a custom UI component |
| `unregisterUiComponent(componentId)` | Remove a custom UI component |
| `getViewState()` | Get current view snapshot |
| `getChannelToolbarState()` | Get resolved toolbar config |
| `resetView()` | Reset to initial view |
| `clear(channelId?)` | Clear data buffer |
| `destroy()` | Tear down the viewer |

### DataPoint

```ts
interface DataPoint {
  timestamp: number;
  value?: number;
  rms?: number;
  featureValue?: number;
  color?: string;          // per-point override
  alpha?: number;
  lineStyle?: "solid" | "dashed" | "dotted" | "dash-dot" | number[];
  lineWidth?: number;
  metadata?: Record<string, unknown>;
}
```

### Marker

```ts
interface Marker {
  timestamp: number;
  color: string;
  label: string;
  lineWidth?: number;
  lineStyle?: "solid" | "dashed";
  metadata?: Record<string, unknown>;
}
```

## Custom UI Components

Implement the `ViewerUiComponent` interface to inject fully custom UI into the viewer layout:

```ts
interface ViewerUiComponent {
  id: string;
  slot: "top" | "bottom" | "left" | "right" | "overlay";
  mount(container: HTMLElement): void;
  unmount(): void;
  getReservedInsets(ctx: ViewerUiComponentState): UiInsets;
  setRect(rect: UiRect): void;
  sync(state: ViewerUiComponentState): void;
  render(): void;
  handlePointerEvent(evt: ViewerUiPointerEvent): ViewerUiPointerResult;
}
```

## Building

```bash
# build everything (core + React wrapper)
npm run build

# core only
npm run build:core

# React wrapper only
npm run build:react
```

## Demo

Live demo index:

- `https://mdckiller.github.io/audio-waveform-viewer/`

Local demo files:

- `examples/multiChannel.html`
- `examples/microphoneReact.html`

### GitHub Pages

The repo includes automated deploy workflow at `.github/workflows/deploy-pages.yml`.

On push to `main`, it publishes:

- `index.html`
- `examples/`
- `dist/`
- `packages/react/dist/`

For repo `mdckiller/audio-waveform-viewer`, URLs will be:

- `https://mdckiller.github.io/audio-waveform-viewer/`
- `https://mdckiller.github.io/audio-waveform-viewer/examples/multiChannel.html`
- `https://mdckiller.github.io/audio-waveform-viewer/examples/microphoneReact.html`

## License

[MIT](./LICENSE)
