import { DataPoint } from "../src/types.js";

export const MOCK_LABEL = "sine-8s";

export class Sine8sMockWebSocket extends EventTarget {
  private timer: number | null = null;
  private running = false;
  private nextDue = 0;
  private perfOrigin = 0;
  private originTimestamp = 0;
  private readonly sampleIntervalMs: number;
  private readonly periodMs: number;

  constructor(sampleIntervalMs = 16, periodMs = 8000) {
    super();
    this.sampleIntervalMs = sampleIntervalMs;
    this.periodMs = periodMs;
  }

  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    this.originTimestamp = Date.now();
    this.perfOrigin = performance.now();
    this.nextDue = this.perfOrigin;
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
      this.emitData(elapsedMs);
      this.nextDue += this.sampleIntervalMs;
      emitted += 1;
    }

    const delay = Math.max(0, this.nextDue - performance.now());
    this.timer = window.setTimeout(() => this.tick(), delay);
  }

  private emitData(elapsedMs: number): void {
    const timestamp = this.originTimestamp + elapsedMs;
    const value = Math.sin((2 * Math.PI * elapsedMs) / this.periodMs) + 1;

    const point: DataPoint = {
      timestamp,
      value,
      rms: Math.abs(value),
      featureValue: value,
      metadata: {
        channel: "SINE",
        elapsedMs,
        periodMs: this.periodMs
      }
    };

    this.dispatchEvent(new CustomEvent("data", { detail: { channelId: "SINE", point } }));
  }
}
