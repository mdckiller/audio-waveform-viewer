export class Timeline {
  private baseTimestamp: number | null = null;
  private maxTimestamp: number | null = null;

  updateMaxTimestamp(timestamp: number): boolean {
    let changed = false;
    if (this.baseTimestamp === null) {
      this.baseTimestamp = timestamp;
      changed = true;
    }
    if (this.maxTimestamp === null || timestamp > this.maxTimestamp) {
      this.maxTimestamp = timestamp;
      changed = true;
    }
    return changed;
  }

  getBaseTimestamp(): number | null {
    return this.baseTimestamp;
  }

  getMaxTimestamp(): number | null {
    return this.maxTimestamp;
  }

  reset(): void {
    this.baseTimestamp = null;
    this.maxTimestamp = null;
  }
}
