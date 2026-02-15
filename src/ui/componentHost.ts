import { UiInsets, UiRect, ViewerUiComponent, ViewerUiComponentState, ViewerUiPointerEvent, ViewerUiPointerResult } from "../types.js";
import { UiComponentHostOptions, ZERO_INSETS, cloneInsets } from "./types.js";

export class UiComponentHost {
  private readonly container: HTMLElement;
  private readonly options: UiComponentHostOptions;
  private readonly components: ViewerUiComponent[] = [];
  private readonly reservedById: Map<string, UiInsets> = new Map();

  constructor(container: HTMLElement, options: UiComponentHostOptions) {
    this.container = container;
    this.options = options;
  }

  register(component: ViewerUiComponent): void {
    if (this.components.some((entry) => entry.id === component.id)) {
      throw new Error(`UI component already registered: ${component.id}`);
    }
    component.mount(this.container);
    this.components.push(component);
    this.options.onRequestRender();
  }

  unregister(componentId: string): void {
    const index = this.components.findIndex((entry) => entry.id === componentId);
    if (index < 0) {
      return;
    }
    const [component] = this.components.splice(index, 1);
    component.unmount();
    this.reservedById.delete(componentId);
    this.options.onRequestRender();
  }

  destroy(): void {
    while (this.components.length > 0) {
      const component = this.components.pop();
      component?.unmount();
    }
    this.reservedById.clear();
  }

  computeReservedInsets(state: ViewerUiComponentState): UiInsets {
    const reserved = { ...ZERO_INSETS };
    this.components.forEach((component) => {
      const requested = component.getReservedInsets(state);
      const normalized = normalizeInsetsForSlot(requested, component.slot);
      this.reservedById.set(component.id, normalized);
      reserved.top += normalized.top;
      reserved.right += normalized.right;
      reserved.bottom += normalized.bottom;
      reserved.left += normalized.left;
    });
    return reserved;
  }

  sync(state: ViewerUiComponentState): void {
    this.components.forEach((component) => component.sync(state));
  }

  layout(state: ViewerUiComponentState, reservedInsets: UiInsets): void {
    const topInset = Math.max(0, reservedInsets.top);
    const rightInset = Math.max(0, reservedInsets.right);
    const bottomInset = Math.max(0, reservedInsets.bottom);
    const leftInset = Math.max(0, reservedInsets.left);

    const innerX = leftInset;
    const innerY = topInset;
    const innerWidth = Math.max(0, state.width - leftInset - rightInset);
    const innerHeight = Math.max(0, state.height - topInset - bottomInset);

    let topCursor = 0;
    let bottomCursor = state.height;
    let leftCursor = 0;
    let rightCursor = state.width;

    this.components.forEach((component) => {
      const reserved = cloneInsets(this.reservedById.get(component.id) ?? ZERO_INSETS);
      let rect: UiRect = { x: 0, y: 0, width: 0, height: 0 };
      if (component.slot === "top") {
        const thickness = reserved.top;
        rect = { x: innerX, y: topCursor, width: innerWidth, height: thickness };
        topCursor += thickness;
      } else if (component.slot === "bottom") {
        const thickness = reserved.bottom;
        bottomCursor -= thickness;
        rect = { x: innerX, y: bottomCursor, width: innerWidth, height: thickness };
      } else if (component.slot === "left") {
        const thickness = reserved.left;
        rect = { x: leftCursor, y: innerY, width: thickness, height: innerHeight };
        leftCursor += thickness;
      } else if (component.slot === "right") {
        const thickness = reserved.right;
        rightCursor -= thickness;
        rect = { x: rightCursor, y: innerY, width: thickness, height: innerHeight };
      } else {
        rect = { x: 0, y: 0, width: state.width, height: state.height };
      }
      component.setRect(rect);
    });
  }

  renderAll(): void {
    this.components.forEach((component) => component.render());
  }

  handlePointerEvent(event: ViewerUiPointerEvent): ViewerUiPointerResult {
    for (let index = this.components.length - 1; index >= 0; index -= 1) {
      const result = this.components[index].handlePointerEvent(event);
      if (result.consumed) {
        return { consumed: true };
      }
    }
    return { consumed: false };
  }
}

const normalizeInsetsForSlot = (requested: UiInsets, slot: ViewerUiComponent["slot"]): UiInsets => {
  if (slot === "top") {
    return { top: sanitizeInset(requested.top), right: 0, bottom: 0, left: 0 };
  }
  if (slot === "bottom") {
    return { top: 0, right: 0, bottom: sanitizeInset(requested.bottom), left: 0 };
  }
  if (slot === "left") {
    return { top: 0, right: 0, bottom: 0, left: sanitizeInset(requested.left) };
  }
  if (slot === "right") {
    return { top: 0, right: sanitizeInset(requested.right), bottom: 0, left: 0 };
  }
  return { top: 0, right: 0, bottom: 0, left: 0 };
};

const sanitizeInset = (value: number): number => {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.floor(value);
};
