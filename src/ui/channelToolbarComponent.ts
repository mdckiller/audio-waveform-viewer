import {
  UiInsets,
  UiRect,
  ViewerUiComponent,
  ViewerUiComponentState,
  ViewerUiPointerEvent,
  ViewerUiPointerResult
} from "../types.js";
import { parseColor } from "../utils/colorUtils.js";
import { TextAtlas } from "./textAtlas.js";
import { UiRenderer } from "./uiRenderer.js";

interface ToolbarItemLayout {
  channelId: string;
  name: string;
  truncatedName: string;
  isTruncated: boolean;
  visible: boolean;
  color: string;
  rect: UiRect;
}

interface ChannelToolbarCallbacks {
  onToggleChannel: (channelId: string, visible: boolean) => void;
  onRequestRender: () => void;
  onShowTooltip: (x: number, y: number, content: string) => void;
  onHideTooltip: () => void;
}

const PADDING = 6;
const GAP = 6;
const MIN_HORIZONTAL_ITEM = 90;
const MAX_HORIZONTAL_ITEM = 260;
const MIN_VERTICAL_ITEM = 24;
const MAX_VERTICAL_ITEM = 36;

export class ChannelToolbarComponent implements ViewerUiComponent {
  readonly id = "channel-toolbar";
  slot: ViewerUiComponent["slot"] = "top";

  private readonly callbacks: ChannelToolbarCallbacks;
  private canvas: HTMLCanvasElement | null = null;
  private renderer: UiRenderer | null = null;
  private textAtlas: TextAtlas | null = null;
  private rect: UiRect = { x: 0, y: 0, width: 0, height: 0 };
  private state: ViewerUiComponentState | null = null;
  private items: ToolbarItemLayout[] = [];
  private scrollOffset = 0;
  private overflowPx = 0;
  private hoverIndex = -1;

  constructor(callbacks: ChannelToolbarCallbacks) {
    this.callbacks = callbacks;
  }

  mount(container: HTMLElement): void {
    if (this.canvas) {
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.style.position = "absolute";
    canvas.style.top = "0";
    canvas.style.left = "0";
    canvas.style.pointerEvents = "none";
    canvas.style.zIndex = "140";
    container.appendChild(canvas);
    this.canvas = canvas;
    this.renderer = new UiRenderer(canvas);
    this.textAtlas = new TextAtlas(this.renderer.getGlContext());
  }

  unmount(): void {
    this.callbacks.onHideTooltip();
    this.hoverIndex = -1;
    this.items = [];
    if (this.textAtlas) {
      this.textAtlas.destroy();
      this.textAtlas = null;
    }
    if (this.renderer) {
      this.renderer.destroy();
      this.renderer = null;
    }
    if (this.canvas) {
      this.canvas.remove();
      this.canvas = null;
    }
  }

  getReservedInsets(ctx: ViewerUiComponentState): UiInsets {
    this.slot = ctx.channelToolbar.position;
    if (!ctx.channelToolbar.enabled) {
      return { top: 0, right: 0, bottom: 0, left: 0 };
    }
    const thickness = Math.max(0, Math.floor(ctx.channelToolbar.thicknessPx));
    if (this.slot === "top") {
      return { top: thickness, right: 0, bottom: 0, left: 0 };
    }
    if (this.slot === "bottom") {
      return { top: 0, right: 0, bottom: thickness, left: 0 };
    }
    if (this.slot === "left") {
      return { top: 0, right: 0, bottom: 0, left: thickness };
    }
    return { top: 0, right: thickness, bottom: 0, left: 0 };
  }

  setRect(rect: UiRect): void {
    this.rect = { ...rect };
    this.rebuildItems();
  }

  sync(state: ViewerUiComponentState): void {
    this.state = state;
    this.slot = state.channelToolbar.position;
    if (this.renderer) {
      this.renderer.resize(state.width, state.height, state.devicePixelRatio);
    }
    if (this.canvas) {
      this.canvas.style.display = state.channelToolbar.enabled ? "block" : "none";
    }
    this.rebuildItems();
  }

  render(): void {
    if (!this.renderer || !this.state || !this.textAtlas) {
      return;
    }
    this.renderer.clear();
    if (!this.state.channelToolbar.enabled || this.rect.width <= 0 || this.rect.height <= 0) {
      return;
    }

    this.renderer.drawRect(
      this.rect.x,
      this.rect.y,
      this.rect.width,
      this.rect.height,
      "rgba(15, 23, 42, 0.78)"
    );
    this.renderer.drawRectStroke(this.rect.x, this.rect.y, this.rect.width, this.rect.height, "#334155", 1);

    this.items.forEach((item, index) => {
      if (!isRectVisible(item.rect, this.rect)) {
        return;
      }
      const isHovered = index === this.hoverIndex;
      const chipColor = item.visible
        ? (isHovered ? "#334155" : "#1f2937")
        : (isHovered ? "#4b5563" : "#374151");
      const borderColor = isHovered ? "#93c5fd" : "#64748b";
      const vertical = this.slot === "left" || this.slot === "right";
      this.renderer!.drawRect(item.rect.x, item.rect.y, item.rect.width, item.rect.height, chipColor);
      this.renderer!.drawRectStroke(item.rect.x, item.rect.y, item.rect.width, item.rect.height, borderColor, 1);

      const toggleSize = vertical
        ? Math.max(12, Math.min(item.rect.width - 8, item.rect.height - 8, 24))
        : Math.max(12, Math.min(item.rect.height - 10, item.rect.width - 16, 18));
      const toggleX = vertical
        ? Math.round(item.rect.x + (item.rect.width - toggleSize) / 2)
        : Math.round(item.rect.x + 8);
      const toggleY = Math.round(item.rect.y + (item.rect.height - toggleSize) / 2);
      this.renderer!.drawRect(toggleX, toggleY, toggleSize, toggleSize, item.color);
      this.renderer!.drawRectStroke(
        toggleX,
        toggleY,
        toggleSize,
        toggleSize,
        isHovered ? "#e2e8f0" : "rgba(255,255,255,0.75)",
        1
      );
      if (!item.visible) {
        this.renderer!.drawRect(toggleX, toggleY, toggleSize, toggleSize, "rgba(15, 23, 42, 0.45)");
      }
      if (item.visible) {
        const checkColor = getContrastingCheckColor(item.color);
        this.renderer!.drawLine([
          { x: toggleX + Math.max(2, toggleSize * 0.18), y: toggleY + toggleSize * 0.56 },
          { x: toggleX + toggleSize * 0.44, y: toggleY + toggleSize - Math.max(2, toggleSize * 0.18) },
          { x: toggleX + toggleSize - Math.max(2, toggleSize * 0.16), y: toggleY + Math.max(2, toggleSize * 0.18) }
        ], checkColor, toggleSize >= 16 ? 2 : 1);
      }

      if (vertical) {
        return;
      }

      const centerY = item.rect.y + item.rect.height / 2;
      const font = "12px monospace";
      const textLeft = toggleX + toggleSize + 8;
      const textureInfo = this.textAtlas!.getOrCreate(item.truncatedName, font);
      const textY = Math.round(centerY - textureInfo.height / 2);
      this.renderer!.drawTexturedRect(
        textureInfo.texture,
        textLeft,
        textY,
        textureInfo.width,
        textureInfo.height,
        item.visible ? "#e2e8f0" : "#94a3b8"
      );
    });
  }

  handlePointerEvent(evt: ViewerUiPointerEvent): ViewerUiPointerResult {
    if (!this.state?.channelToolbar.enabled || this.rect.width <= 0 || this.rect.height <= 0) {
      this.clearHover();
      return { consumed: false };
    }

    if (evt.type === "mouseleave") {
      this.clearHover();
      return { consumed: false };
    }

    const inside = pointInRect(evt.x, evt.y, this.rect);
    if (!inside) {
      if (evt.type === "pointermove") {
        this.clearHover();
      }
      return { consumed: false };
    }

    if (evt.type === "wheel") {
      const prev = this.scrollOffset;
      if (this.overflowPx > 0) {
        const delta = Math.abs(evt.deltaY ?? 0) >= Math.abs(evt.deltaX ?? 0)
          ? (evt.deltaY ?? 0)
          : (evt.deltaX ?? 0);
        this.scrollOffset = clamp(this.scrollOffset + delta, 0, this.overflowPx);
        if (this.scrollOffset !== prev) {
          this.rebuildItems();
          this.callbacks.onRequestRender();
        }
      }
      return { consumed: true };
    }

    if (evt.type === "pointerdown" || evt.type === "pointerup" || evt.type === "dblclick") {
      return { consumed: true };
    }

    const hoveredIndex = this.findItemIndexAt(evt.x, evt.y);
    if (evt.type === "pointermove") {
      const changed = hoveredIndex !== this.hoverIndex;
      this.hoverIndex = hoveredIndex;
      if (hoveredIndex >= 0) {
        const item = this.items[hoveredIndex];
        const showNameTooltip = this.slot === "left" || this.slot === "right" || item.isTruncated;
        if (showNameTooltip) {
          this.callbacks.onShowTooltip(evt.x + 8, evt.y + 8, item.name);
        } else {
          this.callbacks.onHideTooltip();
        }
      } else {
        this.callbacks.onHideTooltip();
      }
      if (changed) {
        this.callbacks.onRequestRender();
      }
      return { consumed: true };
    }

    if (evt.type === "click" && hoveredIndex >= 0) {
      const item = this.items[hoveredIndex];
      this.callbacks.onToggleChannel(item.channelId, !item.visible);
      this.callbacks.onRequestRender();
      return { consumed: true };
    }

    return { consumed: true };
  }

  private rebuildItems(): void {
    const state = this.state;
    const atlas = this.textAtlas;
    if (!state || !atlas) {
      this.items = [];
      return;
    }
    if (!state.channelToolbar.enabled || state.channels.length === 0 || this.rect.width <= 0 || this.rect.height <= 0) {
      this.items = [];
      this.hoverIndex = -1;
      this.scrollOffset = 0;
      this.overflowPx = 0;
      return;
    }

    const horizontal = this.slot === "top" || this.slot === "bottom";
    const count = state.channels.length;
    const availableMain = Math.max(0, (horizontal ? this.rect.width : this.rect.height) - PADDING * 2);
    const gaps = Math.max(0, count - 1) * GAP;
    const baseMain = count > 0 ? (availableMain - gaps) / count : availableMain;
    const itemMain = horizontal
      ? clamp(baseMain, MIN_HORIZONTAL_ITEM, MAX_HORIZONTAL_ITEM)
      : clamp(baseMain, MIN_VERTICAL_ITEM, MAX_VERTICAL_ITEM);
    const totalMain = count * itemMain + gaps;
    this.overflowPx = Math.max(0, totalMain - availableMain);
    this.scrollOffset = clamp(this.scrollOffset, 0, this.overflowPx);
    const lead = this.overflowPx > 0 ? 0 : Math.max(0, (availableMain - totalMain) / 2);
    const startMain = (horizontal ? this.rect.x : this.rect.y) + PADDING + lead - this.scrollOffset;

    const itemCross = horizontal
      ? Math.max(MIN_VERTICAL_ITEM, this.rect.height - PADDING * 2)
      : Math.max(18, this.rect.width - PADDING * 2);
    const startCross = horizontal
      ? this.rect.y + (this.rect.height - itemCross) / 2
      : this.rect.x + (this.rect.width - itemCross) / 2;

    this.items = state.channels.map((channel, index) => {
      const main = startMain + index * (itemMain + GAP);
      const rect = horizontal
        ? { x: main, y: startCross, width: itemMain, height: itemCross }
        : { x: startCross, y: main, width: itemCross, height: itemMain };
      const toggleSize = Math.max(12, Math.min(rect.height - 10, rect.width - 16, 18));
      const textAreaWidth = Math.max(0, rect.width - (8 + toggleSize + 8) - 8);
      const truncatedName = horizontal
        ? atlas.truncateWithEllipsis(channel.config.name, textAreaWidth, "12px monospace")
        : "";
      return {
        channelId: channel.id,
        name: channel.config.name,
        truncatedName,
        isTruncated: horizontal ? truncatedName !== channel.config.name : false,
        visible: channel.config.visible,
        color: channel.config.color,
        rect
      };
    });

    if (this.hoverIndex >= this.items.length) {
      this.hoverIndex = -1;
      this.callbacks.onHideTooltip();
    }
  }

  private findItemIndexAt(x: number, y: number): number {
    for (let index = 0; index < this.items.length; index += 1) {
      if (pointInRect(x, y, this.items[index].rect)) {
        return index;
      }
    }
    return -1;
  }

  private clearHover(): void {
    if (this.hoverIndex >= 0) {
      this.hoverIndex = -1;
      this.callbacks.onHideTooltip();
      this.callbacks.onRequestRender();
    }
  }
}

const pointInRect = (x: number, y: number, rect: UiRect): boolean => {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
};

const isRectVisible = (rect: UiRect, clip: UiRect): boolean => {
  const rectRight = rect.x + rect.width;
  const rectBottom = rect.y + rect.height;
  const clipRight = clip.x + clip.width;
  const clipBottom = clip.y + clip.height;
  return rectRight >= clip.x && rect.x <= clipRight && rectBottom >= clip.y && rect.y <= clipBottom;
};

const getContrastingCheckColor = (background: string): string => {
  try {
    const color = parseColor(background);
    const r = color.r / 255;
    const g = color.g / 255;
    const b = color.b / 255;
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return luminance > 0.55 ? "#0f172a" : "#f8fafc";
  } catch {
    return "#f8fafc";
  }
};

const clamp = (value: number, min: number, max: number): number => {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
};
