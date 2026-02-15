export interface RgbaColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

const HEX_REGEX = /^#([0-9a-f]{6}|[0-9a-f]{3})$/i;
const RGB_REGEX = /^rgba?\(([^)]+)\)$/i;

export const parseColor = (input: string, alphaOverride?: number): RgbaColor => {
  const trimmed = input.trim();
  if (HEX_REGEX.test(trimmed)) {
    const hex = trimmed.slice(1);
    const full = hex.length === 3
      ? hex.split("").map((c) => c + c).join("")
      : hex;
    const r = parseInt(full.slice(0, 2), 16);
    const g = parseInt(full.slice(2, 4), 16);
    const b = parseInt(full.slice(4, 6), 16);
    const a = alphaOverride ?? 1;
    return { r, g, b, a };
  }
  const rgbMatch = trimmed.match(RGB_REGEX);
  if (rgbMatch) {
    const parts = rgbMatch[1].split(",").map((part) => part.trim());
    if (parts.length < 3) {
      throw new Error("Invalid RGB color");
    }
    const r = Number(parts[0]);
    const g = Number(parts[1]);
    const b = Number(parts[2]);
    const aFromInput = parts.length >= 4 ? Number(parts[3]) : 1;
    const a = alphaOverride ?? aFromInput;
    return { r, g, b, a };
  }
  throw new Error("Unsupported color format");
};

export const toNormalizedRgba = (color: RgbaColor): [number, number, number, number] => {
  return [color.r / 255, color.g / 255, color.b / 255, color.a];
};
