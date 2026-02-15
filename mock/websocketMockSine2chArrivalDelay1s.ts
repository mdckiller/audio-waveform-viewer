import { DataPoint } from "../src/types.js";

export const MOCK_LABEL = "sine-2ch-arrival-delay-1s";

export class Sine2chArrivalDelay1sMockWebSocket extends EventTarget {
  private timer: number | null = null;
  private running = false;
  private nextDue = 0;
  private perfOrigin = 0;
  private originTimestamp = 0;
  private readonly sampleIntervalMs: number;
  private readonly periodMs: number;
  private readonly secondChannelArrivalDelayMs: number;
  private readonly firstAmplitude: number;
  private readonly secondAmplitude: number;
  private readonly delayedDispatchTimers: Set<number> = new Set();

  constructor(
    sampleIntervalMs = 16,
    periodMs = 8000,
    secondChannelArrivalDelayMs = 1000,
    firstAmplitude = 1,
    secondAmplitude = 0.92
  ) {
    super();
    this.sampleIntervalMs = sampleIntervalMs;
    this.periodMs = periodMs;
    this.secondChannelArrivalDelayMs = secondChannelArrivalDelayMs;
    this.firstAmplitude = firstAmplitude;
    this.secondAmplitude = secondAmplitude;
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
    this.delayedDispatchTimers.forEach((timerId) => {
      window.clearTimeout(timerId);
    });
    this.delayedDispatchTimers.clear();
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

    this.dispatchPoint("SINE_A", timestamp, elapsedMs, this.firstAmplitude, 0);

    const delayedTimer = window.setTimeout(() => {
      this.delayedDispatchTimers.delete(delayedTimer);
      if (!this.running) {
        return;
      }
      this.dispatchPoint(
        "SINE_B",
        timestamp,
        elapsedMs,
        this.secondAmplitude,
        this.secondChannelArrivalDelayMs
      );
    }, this.secondChannelArrivalDelayMs);
    this.delayedDispatchTimers.add(delayedTimer);
  }

  private dispatchPoint(
    channelId: string,
    timestamp: number,
    elapsedMs: number,
    amplitude: number,
    arrivalDelayMs: number
  ): void {
    const value = amplitude * Math.sin((2 * Math.PI * elapsedMs) / this.periodMs) + 1;
    const point: DataPoint = {
      timestamp,
      value,
      rms: Math.abs(value),
      featureValue: value,
      metadata: {
        channel: channelId,
        elapsedMs,
        periodMs: this.periodMs,
        amplitude,
        secondChannelArrivalDelayMs: this.secondChannelArrivalDelayMs,
        arrivalDelayMs
      }
    };

    this.dispatchEvent(new CustomEvent("data", { detail: { channelId, point } }));
  }
}
