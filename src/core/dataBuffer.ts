import { ChannelBuffer, DataPoint, DataSegment, DataSegmentIndex } from "../types.js";
import { findInsertIndex, findSegmentIndexByPointIndex } from "../utils/sortingUtils.js";

interface ChannelState {
  buffer: ChannelBuffer;
  points: DataPoint[];
}

export class DataBuffer {
  private readonly channels: Map<string, ChannelState> = new Map();
  private maxGapMs: number;
  private globalMaxTimestamp: number | null = null;
  private globalMinTimestamp: number | null = null;

  constructor(maxGapMs: number) {
    this.maxGapMs = maxGapMs;
  }

  setMaxGapMs(maxGapMs: number): void {
    if (!Number.isFinite(maxGapMs) && maxGapMs !== Number.POSITIVE_INFINITY) {
      throw new Error("maxGapMs must be a finite number or Infinity");
    }
    if (maxGapMs <= 0) {
      throw new Error("maxGapMs must be greater than zero");
    }
    this.maxGapMs = maxGapMs;
  }

  addChannel(channelId: string): void {
    if (this.channels.has(channelId)) {
      throw new Error("Channel already exists");
    }
    const buffer: ChannelBuffer = {
      channelId,
      segments: [],
      maxTimestamp: null,
      minTimestamp: null
    };
    this.channels.set(channelId, { buffer, points: [] });
  }

  removeChannel(channelId: string): void {
    if (!this.channels.delete(channelId)) {
      throw new Error("Channel not found");
    }
    this.recalculateGlobalRange();
  }

  addData(channelId: string, data: DataPoint[]): void {
    const state = this.getChannelState(channelId);
    data.forEach((point) => this.insertPoint(state, point));
  }

  addDataPoint(channelId: string, point: DataPoint): void {
    const state = this.getChannelState(channelId);
    this.insertPoint(state, point);
  }

  clear(channelId?: string): void {
    if (channelId) {
      const state = this.getChannelState(channelId);
      state.points.length = 0;
      state.buffer.segments.length = 0;
      state.buffer.maxTimestamp = null;
      state.buffer.minTimestamp = null;
    } else {
      this.channels.forEach((state) => {
        state.points.length = 0;
        state.buffer.segments.length = 0;
        state.buffer.maxTimestamp = null;
        state.buffer.minTimestamp = null;
      });
    }
    this.recalculateGlobalRange();
  }

  getSegmentsInRange(channelId: string, start: number, end: number): DataSegment[] {
    const state = this.getChannelState(channelId);
    const segments: DataSegment[] = [];
    state.buffer.segments.forEach((segment) => {
      if (segment.endTime < start || segment.startTime > end) {
        return;
      }
      const sliceStart = this.findFirstIndexAtOrAfter(state.points, segment.startIndex, segment.endIndex, start);
      const sliceEnd = this.findLastIndexAtOrBefore(state.points, segment.startIndex, segment.endIndex, end);
      if (sliceStart <= sliceEnd) {
        const points = state.points.slice(sliceStart, sliceEnd + 1);
        if (points.length > 0) {
          segments.push({
            points,
            startTime: points[0].timestamp,
            endTime: points[points.length - 1].timestamp
          });
        }
      }
    });
    return segments;
  }

  getMaxTimestamp(): number | null {
    return this.globalMaxTimestamp;
  }

  getMinTimestamp(): number | null {
    return this.globalMinTimestamp;
  }

  private getChannelState(channelId: string): ChannelState {
    const state = this.channels.get(channelId);
    if (!state) {
      throw new Error("Channel not found");
    }
    return state;
  }

  private insertPoint(state: ChannelState, point: DataPoint): void {
    const points = state.points;
    const segments = state.buffer.segments;
    const insertIndex = findInsertIndex(points, point.timestamp);
    const prevIndex = insertIndex - 1;
    const nextIndex = insertIndex + 1;
    const prevSegIndex = prevIndex >= 0 ? findSegmentIndexByPointIndex(segments, prevIndex) : -1;
    const nextSegIndex = insertIndex < points.length ? findSegmentIndexByPointIndex(segments, insertIndex) : -1;

    points.splice(insertIndex, 0, point);

    this.shiftSegments(segments, insertIndex, 1);

    const prevPoint = prevIndex >= 0 ? points[prevIndex] : null;
    const nextPoint = nextIndex < points.length ? points[nextIndex] : null;
    const gapPrev = prevPoint ? point.timestamp - prevPoint.timestamp : null;
    const gapNext = nextPoint ? nextPoint.timestamp - point.timestamp : null;

    if (segments.length === 0) {
      segments.push({
        startIndex: insertIndex,
        endIndex: insertIndex,
        startTime: point.timestamp,
        endTime: point.timestamp
      });
    } else if (!prevPoint && nextPoint) {
      if (gapNext !== null && gapNext <= this.maxGapMs) {
        this.extendSegmentStart(segments, nextSegIndex, points, insertIndex);
      } else {
        segments.splice(nextSegIndex >= 0 ? nextSegIndex : 0, 0, {
          startIndex: insertIndex,
          endIndex: insertIndex,
          startTime: point.timestamp,
          endTime: point.timestamp
        });
      }
    } else if (prevPoint && !nextPoint) {
      if (gapPrev !== null && gapPrev <= this.maxGapMs) {
        this.extendSegmentEnd(segments, prevSegIndex, points, insertIndex);
      } else {
        const insertAt = prevSegIndex >= 0 ? prevSegIndex + 1 : segments.length;
        segments.splice(insertAt, 0, {
          startIndex: insertIndex,
          endIndex: insertIndex,
          startTime: point.timestamp,
          endTime: point.timestamp
        });
      }
    } else if (prevPoint && nextPoint) {
      const joinPrev = gapPrev !== null && gapPrev <= this.maxGapMs;
      const joinNext = gapNext !== null && gapNext <= this.maxGapMs;
      if (joinPrev && joinNext) {
        if (prevSegIndex === nextSegIndex) {
          this.extendSegmentEnd(segments, prevSegIndex, points, insertIndex);
        } else {
          this.mergeSegments(segments, prevSegIndex, nextSegIndex, points);
        }
      } else if (joinPrev && !joinNext) {
        this.extendSegmentEnd(segments, prevSegIndex, points, insertIndex);
      } else if (!joinPrev && joinNext) {
        this.extendSegmentStart(segments, nextSegIndex, points, insertIndex);
      } else {
        const insertAt = prevSegIndex >= 0 ? prevSegIndex + 1 : 0;
        segments.splice(insertAt, 0, {
          startIndex: insertIndex,
          endIndex: insertIndex,
          startTime: point.timestamp,
          endTime: point.timestamp
        });
      }
    }

    this.updateChannelRange(state);
    this.updateGlobalRangeWithPoint(point.timestamp);
  }

  private extendSegmentEnd(segments: DataSegmentIndex[], segmentIndex: number, points: DataPoint[], insertIndex: number): void {
    if (segmentIndex < 0) {
      segments.push({
        startIndex: insertIndex,
        endIndex: insertIndex,
        startTime: points[insertIndex].timestamp,
        endTime: points[insertIndex].timestamp
      });
      return;
    }
    const segment = segments[segmentIndex];
    segment.endIndex = Math.max(segment.endIndex, insertIndex);
    segment.endTime = points[segment.endIndex].timestamp;
  }

  private extendSegmentStart(segments: DataSegmentIndex[], segmentIndex: number, points: DataPoint[], insertIndex: number): void {
    if (segmentIndex < 0) {
      segments.unshift({
        startIndex: insertIndex,
        endIndex: insertIndex,
        startTime: points[insertIndex].timestamp,
        endTime: points[insertIndex].timestamp
      });
      return;
    }
    const segment = segments[segmentIndex];
    segment.startIndex = Math.min(segment.startIndex, insertIndex);
    segment.startTime = points[segment.startIndex].timestamp;
  }

  private mergeSegments(segments: DataSegmentIndex[], prevIndex: number, nextIndex: number, points: DataPoint[]): void {
    if (prevIndex < 0 || nextIndex < 0) {
      return;
    }
    const prevSegment = segments[prevIndex];
    const nextSegment = segments[nextIndex];
    prevSegment.endIndex = nextSegment.endIndex;
    prevSegment.endTime = points[prevSegment.endIndex].timestamp;
    segments.splice(nextIndex, 1);
  }

  private shiftSegments(segments: DataSegmentIndex[], fromIndex: number, delta: number): void {
    segments.forEach((segment) => {
      if (segment.startIndex >= fromIndex) {
        segment.startIndex += delta;
        segment.endIndex += delta;
      } else if (segment.endIndex >= fromIndex) {
        segment.endIndex += delta;
      }
    });
  }

  private updateChannelRange(state: ChannelState): void {
    if (state.points.length === 0) {
      state.buffer.minTimestamp = null;
      state.buffer.maxTimestamp = null;
      return;
    }
    state.buffer.minTimestamp = state.points[0].timestamp;
    state.buffer.maxTimestamp = state.points[state.points.length - 1].timestamp;
  }

  private updateGlobalRangeWithPoint(timestamp: number): void {
    if (this.globalMaxTimestamp === null || timestamp > this.globalMaxTimestamp) {
      this.globalMaxTimestamp = timestamp;
    }
    if (this.globalMinTimestamp === null || timestamp < this.globalMinTimestamp) {
      this.globalMinTimestamp = timestamp;
    }
  }

  private recalculateGlobalRange(): void {
    let min: number | null = null;
    let max: number | null = null;
    this.channels.forEach((state) => {
      if (state.buffer.minTimestamp !== null) {
        min = min === null ? state.buffer.minTimestamp : Math.min(min, state.buffer.minTimestamp);
      }
      if (state.buffer.maxTimestamp !== null) {
        max = max === null ? state.buffer.maxTimestamp : Math.max(max, state.buffer.maxTimestamp);
      }
    });
    this.globalMinTimestamp = min;
    this.globalMaxTimestamp = max;
  }

  private findFirstIndexAtOrAfter(points: DataPoint[], startIndex: number, endIndex: number, timestamp: number): number {
    let low = startIndex;
    let high = endIndex;
    let result = endIndex + 1;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (points[mid].timestamp >= timestamp) {
        result = mid;
        high = mid - 1;
      } else {
        low = mid + 1;
      }
    }
    return result;
  }

  private findLastIndexAtOrBefore(points: DataPoint[], startIndex: number, endIndex: number, timestamp: number): number {
    let low = startIndex;
    let high = endIndex;
    let result = startIndex - 1;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (points[mid].timestamp <= timestamp) {
        result = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    return result;
  }
}
