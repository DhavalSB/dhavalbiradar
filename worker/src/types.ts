export const DEVICE_ID = "metar-map";
export const ONLINE_WINDOW_MS = 15_000;
export const MIN_REFRESH_INTERVAL_MS = 15_000;
export const DEFAULT_REFRESH_INTERVAL_MS = 900_000;
export const DEFAULT_BRIGHTNESS = 20;
export const DEFAULT_ON = "10:00";
export const DEFAULT_OFF = "22:00";
export const TIMEZONE = "America/Los_Angeles";
export const SESSION_COOKIE = "metar_session";
export const SESSION_MAX_AGE_S = 60 * 60 * 24 * 30;

export type Desired = {
  brightness: number;
  displayOn: boolean;
  scheduleEnabled: boolean;
  on: string;
  off: string;
  refreshIntervalMs: number;
};

export type Reported = Record<string, unknown> & {
  appliedCommandId?: number;
  loading?: boolean;
  phase?: string;
  displayOn?: boolean;
  brightness?: number;
  brightnessPercent?: number;
  refreshIntervalMs?: number;
  schedule?: {
    enabled?: boolean;
    on?: string;
    off?: string;
    timezone?: string;
  };
  timeSynced?: boolean;
  time?: string;
  ip?: string;
  lastError?: string;
  lastRefreshAgoMs?: number;
};

export type MetarRow = {
  deviceId: string;
  commandId: number;
  refreshNow: boolean;
  desired: Desired;
  reported: Reported | null;
  lastSeenAt: string | null;
};

export type Bindings = {
  DB: D1Database;
  METAR_MAP_DEVICE_TOKEN: string;
  METAR_MAP_PASSWORD: string;
  SESSION_SECRET: string;
  ASSETS?: Fetcher;
};

export type AppEnv = {
  Bindings: Bindings;
  Variables: {
    store: MetarStore;
  };
};

export interface MetarStore {
  get(deviceId: string): Promise<MetarRow | null>;
  upsert(row: MetarRow): Promise<void>;
}

export const DEFAULT_DESIRED: Desired = {
  brightness: DEFAULT_BRIGHTNESS,
  displayOn: true,
  scheduleEnabled: true,
  on: DEFAULT_ON,
  off: DEFAULT_OFF,
  refreshIntervalMs: DEFAULT_REFRESH_INTERVAL_MS,
};
