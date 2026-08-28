CREATE TABLE IF NOT EXISTS metar_map (
  device_id TEXT PRIMARY KEY,
  command_id INTEGER NOT NULL DEFAULT 0,
  refresh_now INTEGER NOT NULL DEFAULT 0,
  desired_json TEXT NOT NULL,
  reported_json TEXT,
  last_seen_at TEXT
);
