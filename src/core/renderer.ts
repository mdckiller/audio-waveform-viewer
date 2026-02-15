import { RenderRun } from "../types.js";
import { parseColor, toNormalizedRgba } from "../utils/colorUtils.js";

export class Renderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly gl: WebGLRenderingContext;
  private readonly program: WebGLProgram;
  private readonly positionLocation: number;
  private readonly colorLocation: WebGLUniformLocation;
  private readonly buffer: WebGLBuffer;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext("webgl", { antialias: true, alpha: true });
    if (!gl) {
      throw new Error("WebGL not supported");
    }
    this.gl = gl;
    const vertexShader = this.createShader(gl.VERTEX_SHADER, `
      attribute vec2 a_position;
      void main() {
        gl_Position = vec4(a_position, 0.0, 1.0);
      }
    `);
    const fragmentShader = this.createShader(gl.FRAGMENT_SHADER, `
      precision mediump float;
      uniform vec4 u_color;
      void main() {
        gl_FragColor = u_color;
      }
    `);
    const program = gl.createProgram();
    if (!program) {
      throw new Error("Unable to create program");
    }
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error("Shader program failed to link");
    }
    this.program = program;
    this.positionLocation = gl.getAttribLocation(program, "a_position");
    const colorLocation = gl.getUniformLocation(program, "u_color");
    if (!colorLocation) {
      throw new Error("Uniform not found");
    }
    this.colorLocation = colorLocation;
    const buffer = gl.createBuffer();
    if (!buffer) {
      throw new Error("Unable to create buffer");
    }
    this.buffer = buffer;
  }

  resize(width: number, height: number, devicePixelRatio: number): void {
    this.canvas.width = Math.floor(width * devicePixelRatio);
    this.canvas.height = Math.floor(height * devicePixelRatio);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  clear(): void {
    const gl = this.gl;
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  render(runs: RenderRun[]): void {
    const gl = this.gl;
    gl.useProgram(this.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.enableVertexAttribArray(this.positionLocation);
    gl.vertexAttribPointer(this.positionLocation, 2, gl.FLOAT, false, 0, 0);

    runs.forEach((run) => {
      if (run.points.length < 4) {
        return;
      }
      const color = parseColor(run.style.color, run.style.alpha);
      const [r, g, b, a] = toNormalizedRgba(color);
      gl.uniform4f(this.colorLocation, r, g, b, a);
      gl.lineWidth(run.style.lineWidth);
      const lineDash = getLineDash(run.style.lineStyle);
      if (lineDash.length === 0) {
        gl.bufferData(gl.ARRAY_BUFFER, run.points, gl.STREAM_DRAW);
        gl.drawArrays(gl.LINE_STRIP, 0, run.points.length / 2);
        return;
      }
      const dashedRuns = buildDashedRuns(run.points, lineDash, this.canvas.width, this.canvas.height);
      dashedRuns.forEach((segment) => {
        if (segment.length < 4) {
          return;
        }
        gl.bufferData(gl.ARRAY_BUFFER, segment, gl.STREAM_DRAW);
        gl.drawArrays(gl.LINE_STRIP, 0, segment.length / 2);
      });
    });
  }

  private createShader(type: number, source: string): WebGLShader {
    const shader = this.gl.createShader(type);
    if (!shader) {
      throw new Error("Unable to create shader");
    }
    this.gl.shaderSource(shader, source);
    this.gl.compileShader(shader);
    if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
      throw new Error("Shader compilation failed");
    }
    return shader;
  }

  setScissor(x: number, y: number, width: number, height: number): void {
    const gl = this.gl;
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(x, y, width, height);
  }

  clearScissor(): void {
    this.gl.disable(this.gl.SCISSOR_TEST);
  }
}

const getLineDash = (lineStyle: RenderRun["style"]["lineStyle"]): number[] => {
  if (Array.isArray(lineStyle)) {
    return lineStyle;
  }
  if (lineStyle === "dashed") {
    return [5, 3];
  }
  if (lineStyle === "dotted") {
    return [1, 3];
  }
  if (lineStyle === "dash-dot") {
    return [5, 3, 1, 3];
  }
  return [];
};

const buildDashedRuns = (
  points: Float32Array,
  pattern: number[],
  width: number,
  height: number
): Float32Array[] => {
  const segments: Float32Array[] = [];
  if (points.length < 4) {
    return segments;
  }
  const toPixels = (nx: number, ny: number): [number, number] => {
    const x = (nx + 1) * 0.5 * width;
    const y = (1 - (ny + 1) * 0.5) * height;
    return [x, y];
  };
  const toNormalized = (x: number, y: number): [number, number] => {
    const nx = (x / width) * 2 - 1;
    const ny = (1 - y / height) * 2 - 1;
    return [nx, ny];
  };

  let patternIndex = 0;
  let remaining = pattern[0];
  let draw = true;
  let current: number[] = [];

  for (let i = 0; i < points.length - 2; i += 2) {
    const [x0, y0] = toPixels(points[i], points[i + 1]);
    const [x1, y1] = toPixels(points[i + 2], points[i + 3]);
    const dx = x1 - x0;
    const dy = y1 - y0;
    const segmentLength = Math.hypot(dx, dy);
    if (segmentLength === 0) {
      continue;
    }
    let traveled = 0;
    while (traveled < segmentLength) {
      const step = Math.min(remaining, segmentLength - traveled);
      const startT = traveled / segmentLength;
      const endT = (traveled + step) / segmentLength;
      const sx = x0 + dx * startT;
      const sy = y0 + dy * startT;
      const ex = x0 + dx * endT;
      const ey = y0 + dy * endT;

      if (draw) {
        if (current.length === 0) {
          const [snx, sny] = toNormalized(sx, sy);
          current.push(snx, sny);
        }
        const [enx, eny] = toNormalized(ex, ey);
        current.push(enx, eny);
      } else if (current.length > 0) {
        segments.push(new Float32Array(current));
        current = [];
      }

      traveled += step;
      remaining -= step;
      if (remaining <= 0) {
        patternIndex = (patternIndex + 1) % pattern.length;
        remaining = pattern[patternIndex];
        draw = !draw;
      }
    }
  }

  if (current.length > 0) {
    segments.push(new Float32Array(current));
  }
  return segments;
};
