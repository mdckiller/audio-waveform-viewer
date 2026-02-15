export const clamp = (value: number, min: number, max: number): number => {
  return Math.min(max, Math.max(min, value));
};

export const lerp = (start: number, end: number, t: number): number => {
  return start + (end - start) * t;
};

export const niceNum = (range: number, round: boolean): number => {
  if (range === 0) return 0;
  const exponent = Math.floor(Math.log10(Math.abs(range)));
  const fraction = range / Math.pow(10, exponent);
  let niceFraction: number;
  if (round) {
    if (fraction < 1.5) niceFraction = 1;
    else if (fraction < 3) niceFraction = 2;
    else if (fraction < 7) niceFraction = 5;
    else niceFraction = 10;
  } else {
    if (fraction <= 1) niceFraction = 1;
    else if (fraction <= 2) niceFraction = 2;
    else if (fraction <= 5) niceFraction = 5;
    else niceFraction = 10;
  }
  return niceFraction * Math.pow(10, exponent);
};

export const generateTicks = (min: number, max: number, maxTicks: number): number[] => {
  const range = max - min;
  if (range === 0) return [min];
  const tickSpacing = niceNum(niceNum(range, false) / (maxTicks - 1), true);
  if (tickSpacing <= 0) return [min];
  const graphMin = Math.floor(min / tickSpacing) * tickSpacing;
  const graphMax = Math.ceil(max / tickSpacing) * tickSpacing;
  const ticks: number[] = [];
  for (let t = graphMin; t <= graphMax + tickSpacing * 0.5; t += tickSpacing) {
    ticks.push(parseFloat(t.toPrecision(12)));
  }
  return ticks;
};
