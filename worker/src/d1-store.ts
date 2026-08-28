import type { MetarRow, MetarStore } from "./types";

type DbRow = {
  device_id: string;
  command_id: number;
  refresh_now: number;
  desired_json: string;
  reported_json: string | null;
  last_seen_at: string | null;
};

export class D1Store implements MetarStore {
  private ready: Promise<void> | null = null;

  constructor(private db: D1Database) {}

  private ensure(): Promise<void> {
    if (!this.ready) {
      this.ready = this.db
        .prepare(
          `CREATE TABLE IF NOT EXISTS metar_map (
            device_id TEXT PRIMARY KEY,
            command_id INTEGER NOT NULL DEFAULT 0,
            refresh_now INTEGER NOT NULL DEFAULT 0,
            desired_json TEXT NOT NULL,
            reported_json TEXT,
            last_seen_at TEXT
          )`,
        )
        .run()
        .then(() => undefined);
    }
    return this.ready;
  }

  async get(deviceId: string): Promise<MetarRow | null> {
    await this.ensure();
    const row = await this.db
      .prepare(
        "SELECT device_id, command_id, refresh_now, desired_json, reported_json, last_seen_at FROM metar_map WHERE device_id = ?",
      )
      .bind(deviceId)
      .first<DbRow>();
    if (!row) return null;
    return {
      deviceId: row.device_id,
      commandId: Number(row.command_id) || 0,
      refreshNow: Boolean(row.refresh_now),
      desired: JSON.parse(row.desired_json),
      reported: row.reported_json ? JSON.parse(row.reported_json) : null,
      lastSeenAt: row.last_seen_at,
    };
  }

  async upsert(row: MetarRow): Promise<void> {
    await this.ensure();
    await this.db
      .prepare(
        `INSERT INTO metar_map (device_id, command_id, refresh_now, desired_json, reported_json, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(device_id) DO UPDATE SET
           command_id = excluded.command_id,
           refresh_now = excluded.refresh_now,
           desired_json = excluded.desired_json,
           reported_json = excluded.reported_json,
           last_seen_at = excluded.last_seen_at`,
      )
      .bind(
        row.deviceId,
        row.commandId,
        row.refreshNow ? 1 : 0,
        JSON.stringify(row.desired),
        row.reported ? JSON.stringify(row.reported) : null,
        row.lastSeenAt,
      )
      .run();
  }
}
