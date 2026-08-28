import {
  DEVICE_ID,
  ONLINE_WINDOW_MS,
  TIMEZONE,
  type Desired,
  type MetarRow,
} from "./types";
import { coerceBool, coerceInt, percentFromBrightness } from "./validate";

export function commandSnapshot(row: MetarRow) {
  return {
    commandId: row.commandId,
    brightness: row.desired.brightness,
    displayOn: row.desired.displayOn,
    schedule: {
      enabled: row.desired.scheduleEnabled,
      on: row.desired.on,
      off: row.desired.off,
    },
    refreshIntervalMs: row.desired.refreshIntervalMs,
    refreshNow: row.refreshNow,
  };
}

export function reportedMatchesDesired(reported: MetarRow["reported"], desired: Desired): boolean {
  if (!reported) return false;
  const brightness = coerceInt(reported.brightness);
  if (brightness === undefined || brightness !== desired.brightness) return false;
  const displayOn = coerceBool(reported.displayOn);
  if (displayOn !== undefined && displayOn !== desired.displayOn) return false;
  const interval = coerceInt(reported.refreshIntervalMs);
  if (interval !== undefined && interval !== desired.refreshIntervalMs) return false;
  const schedule = reported.schedule;
  if (schedule && typeof schedule === "object") {
    const enabled = coerceBool(schedule.enabled);
    if (enabled !== undefined && enabled !== desired.scheduleEnabled) return false;
    if (typeof schedule.on === "string" && schedule.on.slice(0, 5) !== desired.on) return false;
    if (typeof schedule.off === "string" && schedule.off.slice(0, 5) !== desired.off) return false;
  }
  return true;
}

function reportedSchedule(row: MetarRow) {
  const schedule = row.reported?.schedule;
  return {
    enabled: coerceBool(schedule?.enabled) ?? row.desired.scheduleEnabled,
    on: typeof schedule?.on === "string" ? schedule.on : row.desired.on,
    off: typeof schedule?.off === "string" ? schedule.off : row.desired.off,
    timezone: typeof schedule?.timezone === "string" ? schedule.timezone : TIMEZONE,
  };
}

export function toStatus(row: MetarRow | null, now = Date.now()) {
  if (!row) {
    return {
      online: false,
      lastSeenAt: null,
      loading: false,
      phase: null,
      appliedCommandId: 0,
      pendingCommandId: 0,
      displayOn: true,
      brightness: 20,
      brightnessPercent: 8,
      refreshIntervalMs: 900_000,
      schedule: {
        enabled: true,
        on: "10:00",
        off: "22:00",
        timezone: TIMEZONE,
      },
      timeSynced: false,
      time: null,
      ip: null,
      lastError: "",
      lastRefreshAgoMs: -1,
    };
  }

  const reported = row.reported ?? {};
  const lastSeenAt = row.lastSeenAt;
  const online = Boolean(lastSeenAt && now - Date.parse(lastSeenAt) < ONLINE_WINDOW_MS);
  const brightness =
    coerceInt(reported.brightness) ?? row.desired.brightness;
  const brightnessPercent =
    coerceInt(reported.brightnessPercent) ?? percentFromBrightness(brightness);
  const reportedApplied = coerceInt(reported.appliedCommandId) ?? 0;
  const pendingCommandId = coerceInt(row.commandId) ?? 0;
  const acked =
    reportedApplied >= pendingCommandId ||
    (!row.refreshNow && reportedMatchesDesired(row.reported, row.desired));
  const appliedCommandId = acked ? pendingCommandId : reportedApplied;
  const phase = typeof reported.phase === "string" ? reported.phase : lastSeenAt ? "unknown" : null;
  const loadingFlag = coerceBool(reported.loading);
  const loading = loadingFlag === true || (phase === "fetching" && loadingFlag !== false && online);
  const displayOn = coerceBool(reported.displayOn) ?? row.desired.displayOn;

  const status: Record<string, unknown> = {
    online,
    lastSeenAt,
    loading,
    phase,
    appliedCommandId,
    pendingCommandId,
    displayOn,
    brightness,
    brightnessPercent,
    refreshIntervalMs: coerceInt(reported.refreshIntervalMs) ?? row.desired.refreshIntervalMs,
    schedule: reportedSchedule(row),
    timeSynced: Boolean(reported.timeSynced),
    time: typeof reported.time === "string" ? reported.time : null,
    ip: typeof reported.ip === "string" ? reported.ip : null,
    lastError: typeof reported.lastError === "string" ? reported.lastError : "",
    lastRefreshAgoMs: coerceInt(reported.lastRefreshAgoMs) ?? -1,
  };

  if (pendingCommandId > appliedCommandId) {
    status.desired = desiredPublic(row.desired);
  }

  return status;
}

export function desiredPublic(desired: Desired) {
  return {
    brightness: desired.brightness,
    displayOn: desired.displayOn,
    schedule: {
      enabled: desired.scheduleEnabled,
      on: desired.on,
      off: desired.off,
      timezone: TIMEZONE,
    },
    refreshIntervalMs: desired.refreshIntervalMs,
  };
}

export function emptyRow(): import("./types").MetarRow {
  return {
    deviceId: DEVICE_ID,
    commandId: 0,
    refreshNow: false,
    desired: {
      brightness: 20,
      displayOn: true,
      scheduleEnabled: true,
      on: "10:00",
      off: "22:00",
      refreshIntervalMs: 900_000,
    },
    reported: null,
    lastSeenAt: null,
  };
}
