import {
  DEVICE_ID,
  ONLINE_WINDOW_MS,
  TIMEZONE,
  type Desired,
  type MetarRow,
} from "./types";
import { isBool, percentFromBrightness } from "./validate";

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

function reportedSchedule(row: MetarRow) {
  const schedule = row.reported?.schedule;
  return {
    enabled: isBool(schedule?.enabled) ? schedule.enabled : row.desired.scheduleEnabled,
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
    typeof reported.brightness === "number" ? reported.brightness : row.desired.brightness;
  const brightnessPercent =
    typeof reported.brightnessPercent === "number"
      ? reported.brightnessPercent
      : percentFromBrightness(brightness);
  const appliedCommandId =
    typeof reported.appliedCommandId === "number" ? reported.appliedCommandId : 0;
  const pendingCommandId = row.commandId;
  const phase = typeof reported.phase === "string" ? reported.phase : lastSeenAt ? "unknown" : null;

  const status: Record<string, unknown> = {
    online,
    lastSeenAt,
    loading: Boolean(reported.loading) || phase === "fetching",
    phase,
    appliedCommandId,
    pendingCommandId,
    displayOn: isBool(reported.displayOn) ? reported.displayOn : row.desired.displayOn,
    brightness,
    brightnessPercent,
    refreshIntervalMs:
      typeof reported.refreshIntervalMs === "number"
        ? reported.refreshIntervalMs
        : row.desired.refreshIntervalMs,
    schedule: reportedSchedule(row),
    timeSynced: Boolean(reported.timeSynced),
    time: typeof reported.time === "string" ? reported.time : null,
    ip: typeof reported.ip === "string" ? reported.ip : null,
    lastError: typeof reported.lastError === "string" ? reported.lastError : "",
    lastRefreshAgoMs:
      typeof reported.lastRefreshAgoMs === "number" ? reported.lastRefreshAgoMs : -1,
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
