interface TextAtlasEntry {
  texture: WebGLTexture;
  width: number;
  height: number;
}

export class TextAtlas {
  private readonly gl: WebGLRenderingContext;
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly entries: Map<string, TextAtlasEntry> = new Map();

  constructor(gl: WebGLRenderingContext) {
    this.gl = gl;
    this.canvas = document.createElement("canvas");
    this.canvas.width = 1;
    this.canvas.height = 1;
    const context = this.canvas.getContext("2d");
    if (!context) {
      throw new Error("Unable to create text atlas context");
    }
    this.context = context;
  }

  measureText(text: string, font: string): number {
    this.context.font = font;
    return this.context.measureText(text).width;
  }

  truncateWithEllipsis(text: string, maxWidth: number, font: string): string {
    if (maxWidth <= 0) {
      return "";
    }
    if (this.measureText(text, font) <= maxWidth) {
      return text;
    }
    const ellipsis = "...";
    const ellipsisWidth = this.measureText(ellipsis, font);
    if (ellipsisWidth > maxWidth) {
      return "";
    }
    let low = 0;
    let high = text.length;
    let best = "";
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const candidate = `${text.slice(0, mid)}${ellipsis}`;
      const width = this.measureText(candidate, font);
      if (width <= maxWidth) {
        best = candidate;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    return best;
  }

  getOrCreate(text: string, font: string): TextAtlasEntry {
    const key = `${font}\n${text}`;
    const existing = this.entries.get(key);
    if (existing) {
      return existing;
    }

    this.context.font = font;
    this.context.textBaseline = "middle";
    this.context.textAlign = "left";
    const metrics = this.context.measureText(text);
    const width = Math.max(1, Math.ceil(metrics.width) + 2);
    const fontSize = extractFontSize(font);
    const height = Math.max(1, Math.ceil(fontSize * 1.4));

    this.canvas.width = width;
    this.canvas.height = height;
    this.context.clearRect(0, 0, width, height);
    this.context.font = font;
    this.context.textBaseline = "middle";
    this.context.textAlign = "left";
    this.context.fillStyle = "#ffffff";
    this.context.fillText(text, 1, height / 2);

    const texture = this.gl.createTexture();
    if (!texture) {
      throw new Error("Unable to create text texture");
    }
    this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
    this.gl.pixelStorei(this.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);
    this.gl.texImage2D(
      this.gl.TEXTURE_2D,
      0,
      this.gl.RGBA,
      this.gl.RGBA,
      this.gl.UNSIGNED_BYTE,
      this.canvas
    );
    this.gl.bindTexture(this.gl.TEXTURE_2D, null);

    const entry = { texture, width, height };
    this.entries.set(key, entry);
    return entry;
  }

  clear(): void {
    this.entries.forEach((entry) => {
      this.gl.deleteTexture(entry.texture);
    });
    this.entries.clear();
  }

  destroy(): void {
    this.clear();
  }
}

const extractFontSize = (font: string): number => {
  const match = font.match(/([0-9]+)px/);
  if (!match) {
    return 12;
  }
  return Number(match[1]);
};
