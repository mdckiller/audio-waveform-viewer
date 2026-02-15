import { Marker } from "../types.js";

export class MarkerStore {
  private readonly markers: Map<string, Marker> = new Map();
  private counter = 0;

  add(marker: Marker): string {
    const id = `m_${this.counter++}`;
    this.markers.set(id, marker);
    return id;
  }

  remove(markerId: string): void {
    if (!this.markers.delete(markerId)) {
      throw new Error("Marker not found");
    }
  }

  update(markerId: string, marker: Partial<Marker>): void {
    const current = this.markers.get(markerId);
    if (!current) {
      throw new Error("Marker not found");
    }
    this.markers.set(markerId, { ...current, ...marker });
  }

  list(): Array<{ id: string; marker: Marker }> {
    return Array.from(this.markers.entries()).map(([id, marker]) => ({ id, marker }));
  }
}
