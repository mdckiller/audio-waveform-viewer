import { DataPoint, DataSegmentIndex } from "../types.js";

export const findInsertIndex = (points: DataPoint[], timestamp: number): number => {
  let low = 0;
  let high = points.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (points[mid].timestamp <= timestamp) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low;
};

export const findSegmentIndexByPointIndex = (segments: DataSegmentIndex[], pointIndex: number): number => {
  let low = 0;
  let high = segments.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const segment = segments[mid];
    if (pointIndex < segment.startIndex) {
      high = mid - 1;
    } else if (pointIndex > segment.endIndex) {
      low = mid + 1;
    } else {
      return mid;
    }
  }
  return -1;
};
