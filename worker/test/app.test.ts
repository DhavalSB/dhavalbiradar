import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { MemoryStore } from "../src/memory-store";
import { createSessionToken } from "../src/auth";
import { ONLINE_WINDOW_MS } from "../src/types";

const TOKEN = "test-device-token-0123456789abcdef";
const PASSWORD = "test-site-password";
const SESSION_SECRET = "session-secret-0123456789abcdef0123456789abcdef";

const env = {
  METAR_MAP_DEVICE_TOKEN: TOKEN,
  METAR_MAP_PASSWORD: PASSWORD,
  SESSION_SECRET,
};

function reported(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    deviceId: "metar-map",
    appliedCommandId: 0,
    loading: false,
    phase: "idle",
    displayOn: true,
    brightness: 20,
    brightnessPercent: 8,
    refreshIntervalMs: 900000,
    lastRefreshAgoMs: 12000,
    uptimeMs: 3600000,
    schedule: {
      enabled: true,
      on: "10:00",
      off: "22:00",
      timezone: "America/Los_Angeles",
    },
    timeSynced: true,
    time: "2026-08-28T10:30:00",
    ip: "192.168.1.50",
    wifiConnected: true,
    lastError: "",
    cloudConfigured: true,
    cloudOnline: true,
    ...overrides,
  };
}

function deviceHeaders(token = TOKEN) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "X-Device-Id": "metar-map",
  };
}

async function setup() {
  const store = new MemoryStore();
  const app = createApp({ store });
  return { store, app };
}

async function sync(app: ReturnType<typeof createApp>, body: unknown, token?: string) {
  return app.request(
    "/api/metar-map/sync",
    {
      method: "POST",
      headers: deviceHeaders(token),
      body: JSON.stringify(body),
    },
    env,
  );
}

async function login(app: ReturnType<typeof createApp>, password = PASSWORD) {
  const res = await app.request(
    "/api/metar-map/login",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    },
    env,
  );
  const data = (await res.json()) as { token?: string };
  return { res, token: data.token };
}

async function sessionReq(
  app: ReturnType<typeof createApp>,
  path: string,
  init: RequestInit,
  token: string,
) {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return app.request(path, { ...init, headers }, env);
}

describe("auth gates", () => {
  it("rejects unauthenticated status with 401", async () => {
    const { app } = await setup();
    const res = await app.request("/api/metar-map/status", {}, env);
    expect(res.status).toBe(401);
  });

  it("rejects sync without a token", async () => {
    const { app } = await setup();
    const res = await app.request(
      "/api/metar-map/sync",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reported()),
      },
      env,
    );
    expect(res.status).toBe(401);
  });

  it("rejects sync with a bad token", async () => {
    const { app } = await setup();
    const res = await sync(app, reported(), "wrong-token");
    expect(res.status).toBe(401);
  });

  it("does not send CORS on sync", async () => {
    const { app } = await setup();
    const res = await app.request(
      "/api/metar-map/sync",
      {
        method: "OPTIONS",
        headers: { Origin: "https://dhavalbiradar.com" },
      },
      env,
    );
    expect(res.status).toBe(404);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});

describe("device sync", () => {
  it("initializes desired from reported on first seen", async () => {
    const { app } = await setup();
    const res = await sync(app, reported({ brightness: 40, appliedCommandId: 0 }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      commandId: 0,
      brightness: 40,
      displayOn: true,
      schedule: { enabled: true, on: "10:00", off: "22:00" },
      refreshIntervalMs: 900000,
      refreshNow: false,
    });
  });

  it("uses the device appliedCommandId when first seen is non-zero", async () => {
    const { app } = await setup();
    const res = await sync(app, reported({ appliedCommandId: 4, brightness: 10 }));
    const body = await res.json();
    expect(body.commandId).toBe(4);
    expect(body.refreshNow).toBe(false);
  });

  it("does not increment commandId on later heartbeats", async () => {
    const { app } = await setup();
    await sync(app, reported());
    const second = await sync(app, reported({ appliedCommandId: 0, brightness: 99 }));
    const body = await second.json();
    expect(body.commandId).toBe(0);
    expect(body.brightness).toBe(99);
  });
});

describe("user mutations", () => {
  it("increments commandId on brightness PUT and keeps it on the next sync", async () => {
    const { app } = await setup();
    await sync(app, reported());
    const { token } = await login(app);
    const put = await sessionReq(
      app,
      "/api/metar-map/brightness",
      { method: "PUT", body: JSON.stringify({ value: 80 }) },
      token!,
    );
    expect(put.status).toBe(200);
    const status = await put.json();
    expect(status.pendingCommandId).toBe(1);

    const heartbeat = await sync(app, reported({ appliedCommandId: 0 }));
    const command = await heartbeat.json();
    expect(command.commandId).toBe(1);
    expect(command.brightness).toBe(80);

    const acked = await sync(app, reported({ appliedCommandId: 1, brightness: 80 }));
    const after = await acked.json();
    expect(after.commandId).toBe(1);
  });

  it("sets refreshNow until the device applies that command", async () => {
    const { app } = await setup();
    await sync(app, reported());
    const { token } = await login(app);
    await sessionReq(
      app,
      "/api/metar-map/brightness",
      { method: "PUT", body: JSON.stringify({ value: 30 }) },
      token!,
    );
    const refresh = await sessionReq(app, "/api/metar-map/refresh", { method: "POST" }, token!);
    const refreshStatus = await refresh.json();
    expect(refreshStatus.pendingCommandId).toBe(2);

    const pending = await sync(app, reported({ appliedCommandId: 1 }));
    const pendingBody = await pending.json();
    expect(pendingBody.refreshNow).toBe(true);
    expect(pendingBody.commandId).toBe(2);

    const done = await sync(app, reported({ appliedCommandId: 2 }));
    const doneBody = await done.json();
    expect(doneBody.commandId).toBe(2);
    expect(doneBody.refreshNow).toBe(false);
  });

  it("marks the device online after sync and offline after 15s", async () => {
    const { app, store } = await setup();
    const token = await createSessionToken(SESSION_SECRET);
    await sync(app, reported());

    const online = await sessionReq(app, "/api/metar-map/status", { method: "GET" }, token);
    expect((await online.json()).online).toBe(true);

    const row = await store.get("metar-map");
    row!.lastSeenAt = new Date(Date.now() - (ONLINE_WINDOW_MS + 5000)).toISOString();
    await store.upsert(row!);

    const offline = await sessionReq(app, "/api/metar-map/status", { method: "GET" }, token);
    expect((await offline.json()).online).toBe(false);
  });

  it("does not undo a pending power-off when schedule is disabled", async () => {
    const { app } = await setup();
    await sync(app, reported({ displayOn: true }));
    const { token } = await login(app);
    await sessionReq(
      app,
      "/api/metar-map/power",
      { method: "PUT", body: JSON.stringify({ on: false }) },
      token!,
    );
    const res = await sessionReq(
      app,
      "/api/metar-map/schedule",
      { method: "PUT", body: JSON.stringify({ enabled: false }) },
      token!,
    );
    const command = await (
      await sync(app, reported({ displayOn: true, appliedCommandId: 1 }))
    ).json();
    expect(command.displayOn).toBe(false);
    expect(command.schedule.enabled).toBe(false);
    expect(res.status).toBe(200);
  });

  it("does not force displayOn when schedule is disabled", async () => {
    const { app } = await setup();
    await sync(app, reported({ displayOn: false }));
    const { token } = await login(app);
    const res = await sessionReq(
      app,
      "/api/metar-map/schedule",
      { method: "PUT", body: JSON.stringify({ enabled: false }) },
      token!,
    );
    const status = await res.json();
    expect(status.pendingCommandId).toBe(1);

    const command = await (await sync(app, reported({ displayOn: false, appliedCommandId: 0 }))).json();
    expect(command.schedule.enabled).toBe(false);
    expect(command.displayOn).toBe(false);
  });

  it("accepts brightness percent and refresh minutes", async () => {
    const { app } = await setup();
    const { token } = await login(app);
    const bright = await sessionReq(
      app,
      "/api/metar-map/brightness",
      { method: "PUT", body: JSON.stringify({ percent: 100 }) },
      token!,
    );
    expect((await bright.json()).desired.brightness).toBe(255);

    const refresh = await sessionReq(
      app,
      "/api/metar-map/refresh",
      { method: "PUT", body: JSON.stringify({ intervalMinutes: 15 }) },
      token!,
    );
    expect((await refresh.json()).desired.refreshIntervalMs).toBe(900000);
  });

  it("rejects an interval below 15 seconds", async () => {
    const { app } = await setup();
    const { token } = await login(app);
    const res = await sessionReq(
      app,
      "/api/metar-map/refresh",
      { method: "PUT", body: JSON.stringify({ intervalMs: 10000 }) },
      token!,
    );
    expect(res.status).toBe(400);
  });
});
