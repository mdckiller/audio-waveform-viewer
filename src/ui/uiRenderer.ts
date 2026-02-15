import { parseColor, toNormalizedRgba } from "../utils/colorUtils.js";

type ColorInput = string | [number, number, number, number];

export class UiRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly gl: WebGLRenderingContext;
  private readonly program: WebGLProgram;
  private readonly positionLocation: number;
  private readonly texCoordLocation: number;
  private readonly colorLocation: WebGLUniformLocation;
  private readonly useTextureLocation: WebGLUniformLocation;
  private readonly textureLocation: WebGLUniformLocation;
  private readonly positionBuffer: WebGLBuffer;
  private readonly texCoordBuffer: WebGLBuffer;
  private width = 1;
  private height = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext("webgl", { antialias: true, alpha: true });
    if (!gl) {
      throw new Error("WebGL not supported for UI renderer");
    }
    this.gl = gl;

    const vertexShader = this.createShader(gl.VERTEX_SHADER, `
      attribute vec2 a_position;
      attribute vec2 a_texCoord;
      varying vec2 v_texCoord;
      void main() {
        gl_Position = vec4(a_position, 0.0, 1.0);
        v_texCoord = a_texCoord;
      }
    `);

    const fragmentShader = this.createShader(gl.FRAGMENT_SHADER, `
      precision mediump float;
      uniform vec4 u_color;
      uniform bool u_useTexture;
      uniform sampler2D u_texture;
      varying vec2 v_texCoord;

      void main() {
        if (u_useTexture) {
          vec4 sampleColor = texture2D(u_texture, v_texCoord);
          gl_FragColor = vec4(u_color.rgb, u_color.a * sampleColor.a);
          return;
        }
        gl_FragColor = u_color;
      }
    `);

    const program = gl.createProgram();
    if (!program) {
      throw new Error("Unable to create UI renderer program");
    }
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error("Failed to link UI renderer program");
    }
    this.program = program;

    const positionLocation = gl.getAttribLocation(program, "a_position");
    const texCoordLocation = gl.getAttribLocation(program, "a_texCoord");
    const colorLocation = gl.getUniformLocation(program, "u_color");
    const useTextureLocation = gl.getUniformLocation(program, "u_useTexture");
    const textureLocation = gl.getUniformLocation(program, "u_texture");
    if (!colorLocation || !useTextureLocation || !textureLocation) {
      throw new Error("Missing UI renderer uniforms");
    }
    this.positionLocation = positionLocation;
    this.texCoordLocation = texCoordLocation;
    this.colorLocation = colorLocation;
    this.useTextureLocation = useTextureLocation;
    this.textureLocation = textureLocation;

    const positionBuffer = gl.createBuffer();
    const texCoordBuffer = gl.createBuffer();
    if (!positionBuffer || !texCoordBuffer) {
      throw new Error("Unable to create UI renderer buffers");
    }
    this.positionBuffer = positionBuffer;
    this.texCoordBuffer = texCoordBuffer;

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(program);
    gl.uniform1i(this.textureLocation, 0);
  }

  getGlContext(): WebGLRenderingContext {
    return this.gl;
  }

  resize(width: number, height: number, devicePixelRatio: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.canvas.width = Math.floor(this.width * devicePixelRatio);
    this.canvas.height = Math.floor(this.height * devicePixelRatio);
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  clear(): void {
    const gl = this.gl;
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  drawRect(x: number, y: number, width: number, height: number, color: ColorInput): void {
    if (width <= 0 || height <= 0) {
      return;
    }
    const position = this.rectToNdc(x, y, width, height);
    const tex = new Float32Array([
      0, 0,
      1, 0,
      0, 1,
      1, 1
    ]);
    this.drawTriangles(position, tex, color, null);
  }

  drawRectStroke(
    x: number,
    y: number,
    width: number,
    height: number,
    color: ColorInput,
    thickness = 1
  ): void {
    if (width <= 0 || height <= 0 || thickness <= 0) {
      return;
    }
    const t = Math.min(thickness, Math.max(1, Math.floor(Math.min(width, height) / 2)));
    this.drawRect(x, y, width, t, color);
    this.drawRect(x, y + height - t, width, t, color);
    this.drawRect(x, y + t, t, Math.max(0, height - t * 2), color);
    this.drawRect(x + width - t, y + t, t, Math.max(0, height - t * 2), color);
  }

  drawLine(points: Array<{ x: number; y: number }>, color: ColorInput, lineWidth = 1): void {
    if (points.length < 2) {
      return;
    }
    const gl = this.gl;
    const vertices = new Float32Array(points.length * 2);
    points.forEach((point, index) => {
      const offset = index * 2;
      vertices[offset] = this.toNdcX(point.x);
      vertices[offset + 1] = this.toNdcY(point.y);
    });
    const tex = new Float32Array(points.length * 2);
    this.prepareDraw(color, null, false);
    gl.lineWidth(lineWidth);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STREAM_DRAW);
    gl.enableVertexAttribArray(this.positionLocation);
    gl.vertexAttribPointer(this.positionLocation, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, tex, gl.STREAM_DRAW);
    gl.enableVertexAttribArray(this.texCoordLocation);
    gl.vertexAttribPointer(this.texCoordLocation, 2, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.LINE_STRIP, 0, points.length);
  }

  drawTexturedRect(
    texture: WebGLTexture,
    x: number,
    y: number,
    width: number,
    height: number,
    color: ColorInput = "#ffffff"
  ): void {
    if (width <= 0 || height <= 0) {
      return;
    }
    const position = this.rectToNdc(x, y, width, height);
    const tex = new Float32Array([
      0, 0,
      1, 0,
      0, 1,
      1, 1
    ]);
    this.drawTriangles(position, tex, color, texture);
  }

  destroy(): void {
    const gl = this.gl;
    gl.deleteBuffer(this.positionBuffer);
    gl.deleteBuffer(this.texCoordBuffer);
    gl.deleteProgram(this.program);
    this.canvas.remove();
  }

  private drawTriangles(
    position: Float32Array,
    texCoords: Float32Array,
    color: ColorInput,
    texture: WebGLTexture | null
  ): void {
    const gl = this.gl;
    this.prepareDraw(color, texture, texture !== null);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, position, gl.STREAM_DRAW);
    gl.enableVertexAttribArray(this.positionLocation);
    gl.vertexAttribPointer(this.positionLocation, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, texCoords, gl.STREAM_DRAW);
    gl.enableVertexAttribArray(this.texCoordLocation);
    gl.vertexAttribPointer(this.texCoordLocation, 2, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  private prepareDraw(color: ColorInput, texture: WebGLTexture | null, useTexture: boolean): void {
    const gl = this.gl;
    gl.useProgram(this.program);
    const [r, g, b, a] = this.resolveColor(color);
    gl.uniform4f(this.colorLocation, r, g, b, a);
    gl.uniform1i(this.useTextureLocation, useTexture ? 1 : 0);
    if (texture) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
    } else {
      gl.bindTexture(gl.TEXTURE_2D, null);
    }
  }

  private rectToNdc(x: number, y: number, width: number, height: number): Float32Array {
    const x0 = this.toNdcX(x);
    const y0 = this.toNdcY(y);
    const x1 = this.toNdcX(x + width);
    const y1 = this.toNdcY(y + height);
    return new Float32Array([
      x0, y0,
      x1, y0,
      x0, y1,
      x1, y1
    ]);
  }

  private toNdcX(x: number): number {
    return (x / this.width) * 2 - 1;
  }

  private toNdcY(y: number): number {
    return 1 - (y / this.height) * 2;
  }

  private resolveColor(input: ColorInput): [number, number, number, number] {
    if (Array.isArray(input)) {
      return input;
    }
    return toNormalizedRgba(parseColor(input));
  }

  private createShader(type: number, source: string): WebGLShader {
    const shader = this.gl.createShader(type);
    if (!shader) {
      throw new Error("Unable to create UI shader");
    }
    this.gl.shaderSource(shader, source);
    this.gl.compileShader(shader);
    if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
      throw new Error("Failed to compile UI shader");
    }
    return shader;
  }
}
