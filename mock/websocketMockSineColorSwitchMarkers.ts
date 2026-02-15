import { DataPoint, Marker } from "../src/types.js";

export const MOCK_LABEL = "sine-8s-color-markers";

const MARKER_COLORS = ["#00C853", "#FF9800", "#8E24AA", "#00ACC1", "#D81B60"];

export class Sine8sColorSwitchMarkersMockWebSocket extends EventTarget {
  private timer: number | null = null;
  private running = false;
  private nextDue = 0;
  private perfOrigin = 0;
  private originTimestamp = 0;
  private nextMarkerIndex = 1;
  private readonly sampleIntervalMs: number;
  private readonly periodMs: number;
  private readonly colorSwitchAtMs: number;
  private readonly markerEveryMs: number;

  constructor(sampleIntervalMs = 16, periodMs = 8000, colorSwitchAtMs = 4000, markerEveryMs = 2000) {
    super();
    this.sampleIntervalMs = sampleIntervalMs;
    this.periodMs = periodMs;
    this.colorSwitchAtMs = colorSwitchAtMs;
    this.markerEveryMs = markerEveryMs;
  }

  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    this.originTimestamp = Date.now();
    this.perfOrigin = performance.now();
    this.nextDue = this.perfOrigin;
    this.nextMarkerIndex = 1;
    this.tick();
  }

  stop(): void {
    this.running = false;
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private tick(): void {
    if (!this.running) {
      return;
    }

    const nowPerf = performance.now();
    let emitted = 0;
    while (nowPerf >= this.nextDue && emitted < 512) {
      const elapsedMs = Math.max(0, Math.round(this.nextDue - this.perfOrigin));
      this.emitFrame(elapsedMs);
      this.nextDue += this.sampleIntervalMs;
      emitted += 1;
    }

    const delay = Math.max(0, this.nextDue - performance.now());
    this.timer = window.setTimeout(() => this.tick(), delay);
  }

  private emitFrame(elapsedMs: number): void {
    const timestamp = this.originTimestamp + elapsedMs;
    const value = Math.sin((2 * Math.PI * elapsedMs) / this.periodMs) + 1;
    const pointColor = elapsedMs >= this.colorSwitchAtMs ? "#E53E3E" : "#1A73E8";

    const point: DataPoint = {
      timestamp,
      value,
      rms: Math.abs(value),
      featureValue: value,
      color: pointColor,
      metadata: {
        channel: "SINE",
        elapsedMs,
        periodMs: this.periodMs,
        colorSwitchAtMs: this.colorSwitchAtMs,
        markerEveryMs: this.markerEveryMs
      }
    };

    this.dispatchEvent(new CustomEvent("data", { detail: { channelId: "SINE", point } }));
    this.emitDueMarkers(elapsedMs);
  }

  private emitDueMarkers(elapsedMs: number): void {
    while (elapsedMs >= this.nextMarkerIndex * this.markerEveryMs) {
      const markerElapsedMs = this.nextMarkerIndex * this.markerEveryMs;
      const markerTimestamp = this.originTimestamp + markerElapsedMs;
      const markerColor = MARKER_COLORS[(this.nextMarkerIndex - 1) % MARKER_COLORS.length];

      const marker: Marker = {
        timestamp: markerTimestamp,
        color: markerColor,
        lineWidth: 2,
        lineStyle: "dashed",
        label: `M${markerElapsedMs}ms`,
        metadata: {
          elapsedMs: markerElapsedMs,
          periodMs: this.periodMs,
          colorSwitchAtMs: this.colorSwitchAtMs,
          markerEveryMs: this.markerEveryMs
        }
      };

      this.dispatchEvent(new CustomEvent("marker", { detail: { marker } }));
      this.nextMarkerIndex += 1;
    }
  }
}
