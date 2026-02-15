import { ChannelConfig, RenderRun } from "../types.js";
import { Renderer } from "../core/renderer.js";

export class Channel {
  readonly id: string;
  private config: ChannelConfig;
  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: Renderer;

  constructor(container: HTMLElement, id: string, config: ChannelConfig) {
    this.id = id;
    this.config = config;
    const canvas = document.createElement("canvas");
    canvas.style.position = "absolute";
    canvas.style.top = "0";
    canvas.style.left = "0";
    canvas.style.pointerEvents = "none";
    canvas.style.zIndex = String(config.zIndex ?? 1);
    container.appendChild(canvas);
    this.canvas = canvas;
    this.renderer = new Renderer(canvas);
    this.setVisible(config.visible);
  }

  updateConfig(config: Partial<ChannelConfig>): void {
    this.config = { ...this.config, ...config };
    this.canvas.style.zIndex = String(this.config.zIndex ?? 1);
    this.setVisible(this.config.visible);
  }

  getConfig(): ChannelConfig {
    return this.config;
  }

  setVisible(visible: boolean): void {
    this.canvas.style.display = visible ? "block" : "none";
  }

  resize(width: number, height: number, devicePixelRatio: number): void {
    this.renderer.resize(width, height, devicePixelRatio);
  }

  clear(): void {
    this.renderer.clear();
  }

  render(runs: RenderRun[]): void {
    this.renderer.clear();
    if (!this.config.visible) {
      return;
    }
    this.renderer.render(runs);
  }

  setScissor(x: number, y: number, width: number, height: number): void {
    this.renderer.setScissor(x, y, width, height);
  }

  clearScissor(): void {
    this.renderer.clearScissor();
  }

  destroy(): void {
    this.canvas.remove();
  }
}
