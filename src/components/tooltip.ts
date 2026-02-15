export class Tooltip {
  private readonly container: HTMLElement;
  private readonly element: HTMLDivElement;

  constructor(container: HTMLElement) {
    this.container = container;
    const element = document.createElement("div");
    element.style.position = "fixed";
    element.style.pointerEvents = "none";
    element.style.background = "rgba(0, 0, 0, 0.8)";
    element.style.color = "#ffffff";
    element.style.padding = "6px 8px";
    element.style.borderRadius = "4px";
    element.style.fontSize = "12px";
    element.style.fontFamily = "sans-serif";
    element.style.display = "none";
    element.style.whiteSpace = "pre";
    element.style.zIndex = "2147483647";
    document.body.appendChild(element);
    this.element = element;
  }

  show(x: number, y: number, content: string): void {
    this.element.textContent = content;
    this.element.style.display = "block";

    const rect = this.container.getBoundingClientRect();
    const rawLeft = rect.left + x;
    const rawTop = rect.top + y;
    const margin = 8;
    const maxLeft = Math.max(margin, window.innerWidth - this.element.offsetWidth - margin);
    const maxTop = Math.max(margin, window.innerHeight - this.element.offsetHeight - margin);
    const left = clamp(rawLeft, margin, maxLeft);
    const top = clamp(rawTop, margin, maxTop);

    this.element.style.left = `${left}px`;
    this.element.style.top = `${top}px`;
  }

  hide(): void {
    this.element.style.display = "none";
  }

  destroy(): void {
    this.element.remove();
  }
}

const clamp = (value: number, min: number, max: number): number => {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
};
