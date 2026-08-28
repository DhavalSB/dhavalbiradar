import type { MetarRow, MetarStore } from "./types";

export class MemoryStore implements MetarStore {
  private row: MetarRow | null = null;

  async get(deviceId: string): Promise<MetarRow | null> {
    if (!this.row || this.row.deviceId !== deviceId) return null;
    return structuredClone(this.row);
  }

  async upsert(row: MetarRow): Promise<void> {
    this.row = structuredClone(row);
  }
}
