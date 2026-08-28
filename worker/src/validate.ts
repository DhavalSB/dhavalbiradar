import {
  DEFAULT_BRIGHTNESS,
  DEFAULT_REFRESH_INTERVAL_MS,
  MIN_REFRESH_INTERVAL_MS,
  type Desired,
  type Reported,
} from "./types";

export class HttpError extends Error {
  status: number;
  body: Record<string, string>;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.body = { error: message };
  }
}

export function isBool(value: unknown): value is boolean {
  return value === true || value === false;
}

export function coerceBool(value: unknown): boolean | undefined {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return undefined;
}

export function coerceInt(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return Math.trunc(n);
  }
  return undefined;
}

export function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function normalizeTime(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/.exec(value.trim());
  if (!match) return null;
  const hours = match[1].padStart(2, "0");
  return `${hours}:${match[2]}`;
}

export function brightnessFromPercent(percent: number): number {
  return clampInt((percent * 255) / 100, 0, 255);
}

export function percentFromBrightness(brightness: number): number {
  return clampInt((brightness * 100) / 255, 0, 100);
}

export function parseJsonBody(text: string): unknown {
  if (!text || !text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "invalid json");
  }
}

export function requireObject(body: unknown): Record<string, unknown> {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "invalid json");
  }
  return body as Record<string, unknown>;
}

export function parseBrightnessBody(body: unknown): number {
  const obj = requireObject(body);
  if (obj.value !== undefined) {
    if (typeof obj.value !== "number" || !Number.isFinite(obj.value)) {
      throw new HttpError(400, "brightness must be 0-255");
    }
    if (obj.value < 0 || obj.value > 255) {
      throw new HttpError(400, "brightness must be 0-255");
    }
    return clampInt(obj.value, 0, 255);
  }
  if (obj.percent !== undefined) {
    if (typeof obj.percent !== "number" || !Number.isFinite(obj.percent)) {
      throw new HttpError(400, "percent must be 0-100");
    }
    if (obj.percent < 0 || obj.percent > 100) {
      throw new HttpError(400, "percent must be 0-100");
    }
    return brightnessFromPercent(obj.percent);
  }
  throw new HttpError(400, "expected value or percent");
}

export function parseScheduleBody(body: unknown): Partial<Pick<Desired, "scheduleEnabled" | "on" | "off">> {
  const obj = requireObject(body);
  const patch: Partial<Pick<Desired, "scheduleEnabled" | "on" | "off">> = {};
  if (obj.enabled !== undefined) {
    if (!isBool(obj.enabled)) throw new HttpError(400, "enabled must be true or false");
    patch.scheduleEnabled = obj.enabled;
  }
  if (obj.on !== undefined) {
    const on = normalizeTime(obj.on);
    if (!on) throw new HttpError(400, "on must be HH:MM");
    patch.on = on;
  }
  if (obj.off !== undefined) {
    const off = normalizeTime(obj.off);
    if (!off) throw new HttpError(400, "off must be HH:MM");
    patch.off = off;
  }
  if (patch.scheduleEnabled === undefined && !patch.on && !patch.off) {
    throw new HttpError(400, "expected enabled, on, or off");
  }
  return patch;
}

export function parseRefreshBody(body: unknown): number {
  const obj = requireObject(body);
  let ms: number | null = null;
  if (obj.intervalMs !== undefined) {
    if (typeof obj.intervalMs !== "number" || !Number.isFinite(obj.intervalMs)) {
      throw new HttpError(400, "intervalMs must be a number");
    }
    ms = obj.intervalMs;
  } else if (obj.intervalMinutes !== undefined) {
    if (typeof obj.intervalMinutes !== "number" || !Number.isFinite(obj.intervalMinutes)) {
      throw new HttpError(400, "intervalMinutes must be a number");
    }
    ms = obj.intervalMinutes * 60_000;
  }
  if (ms === null) throw new HttpError(400, "expected intervalMs or intervalMinutes");
  ms = Math.round(ms);
  if (ms < MIN_REFRESH_INTERVAL_MS) {
    throw new HttpError(400, "interval must be at least 15000 ms");
  }
  return ms;
}

export function parsePowerBody(body: unknown): boolean {
  const obj = requireObject(body);
  if (!isBool(obj.on)) throw new HttpError(400, "on must be true or false");
  return obj.on;
}

export function parseLoginBody(body: unknown): string {
  const obj = requireObject(body);
  if (typeof obj.password !== "string") throw new HttpError(400, "password required");
  return obj.password;
}

export function desiredFromReported(reported: Reported): Desired {
  const schedule = reported.schedule && typeof reported.schedule === "object" ? reported.schedule : {};
  let brightness = DEFAULT_BRIGHTNESS;
  const parsedBrightness = coerceInt(reported.brightness);
  if (parsedBrightness !== undefined) {
    brightness = clampInt(parsedBrightness, 0, 255);
  } else {
    const percent = coerceInt(reported.brightnessPercent);
    if (percent !== undefined) brightness = brightnessFromPercent(percent);
  }

  let refreshIntervalMs = DEFAULT_REFRESH_INTERVAL_MS;
  const parsedInterval = coerceInt(reported.refreshIntervalMs);
  if (parsedInterval !== undefined) {
    refreshIntervalMs = Math.max(MIN_REFRESH_INTERVAL_MS, parsedInterval);
  } else {
    const minutes = coerceInt(reported.refreshIntervalMinutes);
    if (minutes !== undefined) {
      refreshIntervalMs = Math.max(MIN_REFRESH_INTERVAL_MS, minutes * 60_000);
    }
  }

  return {
    brightness,
    displayOn: coerceBool(reported.displayOn) ?? true,
    scheduleEnabled: coerceBool(schedule.enabled) ?? true,
    on: normalizeTime(schedule.on) ?? "10:00",
    off: normalizeTime(schedule.off) ?? "22:00",
    refreshIntervalMs,
  };
}

export function cloneDesired(desired: Desired): Desired {
  return { ...desired };
}
