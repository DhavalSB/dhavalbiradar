import { Hono } from "hono";
import {
  bearerToken,
  clearSessionCookie,
  createSessionToken,
  safeEqual,
  sessionCookieValue,
  sessionFromRequest,
} from "./auth";
import { corsHeaders } from "./cors";
import { D1Store } from "./d1-store";
import { commandSnapshot, emptyRow, toStatus } from "./status";
import {
  DEVICE_ID,
  type AppEnv,
  type Bindings,
  type MetarRow,
  type MetarStore,
  type Reported,
} from "./types";
import {
  cloneDesired,
  desiredFromReported,
  HttpError,
  isBool,
  parseBrightnessBody,
  parseJsonBody,
  parseLoginBody,
  parsePowerBody,
  parseRefreshBody,
  parseScheduleBody,
} from "./validate";

const SYNC_PATH = "/api/metar-map/sync";

function json(data: unknown, status = 200, extra: Record<string, string> = {}): Response {
  const body = JSON.stringify(data);
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Length": String(new TextEncoder().encode(body).byteLength),
      ...extra,
    },
  });
}

function applyCors(response: Response, origin: string | null): Response {
  const headers = corsHeaders(origin);
  if (!Object.keys(headers).length) return response;
  const next = new Headers(response.headers);
  for (const [key, value] of Object.entries(headers)) next.set(key, value);
  return new Response(response.body, { status: response.status, headers: next });
}

async function readReported(request: Request): Promise<Reported> {
  const text = await request.text();
  const parsed = parseJsonBody(text);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new HttpError(400, "invalid json");
  }
  return parsed as Reported;
}

function deviceIdOk(request: Request, reported: Reported): boolean {
  const headerId = request.headers.get("X-Device-Id");
  if (headerId && headerId !== DEVICE_ID) return false;
  if (typeof reported.deviceId === "string" && reported.deviceId !== DEVICE_ID) return false;
  return true;
}

async function requireDevice(c: { env: Bindings; req: { raw: Request; header: (n: string) => string | undefined } }) {
  const expected = c.env.METAR_MAP_DEVICE_TOKEN;
  if (!expected) throw new HttpError(500, "server misconfigured");
  const token = bearerToken(c.req.header("Authorization"));
  if (!token || !safeEqual(token, expected)) throw new HttpError(401, "unauthorized");
}

export function createApp(opts: { store?: MetarStore } = {}) {
  const app = new Hono<AppEnv>();

  app.use("/api/metar-map/*", async (c, next) => {
    c.set("store", opts.store ?? new D1Store(c.env.DB));
    await next();
  });

  app.onError((err, c) => {
    if (!(err instanceof HttpError)) {
      console.error("metar-map error", err instanceof Error ? err.message : "unknown");
    }
    const origin = c.req.path === SYNC_PATH ? null : c.req.header("Origin") ?? null;
    if (err instanceof HttpError) {
      return applyCors(json(err.body, err.status), origin);
    }
    return applyCors(json({ error: "internal error" }, 500), origin);
  });

  app.options("/api/metar-map/*", (c) => {
    if (c.req.path === SYNC_PATH) return c.body(null, 404);
    const headers = corsHeaders(c.req.header("Origin") ?? null);
    if (!Object.keys(headers).length) return c.body(null, 403);
    return new Response(null, { status: 204, headers });
  });

  app.post("/api/metar-map/sync", async (c) => {
    await requireDevice(c);
    const reported = await readReported(c.req.raw);
    if (!deviceIdOk(c.req.raw, reported)) throw new HttpError(400, "unknown device");

    const store = c.get("store");
    let row = await store.get(DEVICE_ID);
    const applied =
      typeof reported.appliedCommandId === "number" && Number.isFinite(reported.appliedCommandId)
        ? Math.trunc(reported.appliedCommandId)
        : 0;

    if (!row) {
      row = {
        deviceId: DEVICE_ID,
        commandId: applied > 0 ? applied : 0,
        refreshNow: false,
        desired: desiredFromReported(reported),
        reported,
        lastSeenAt: new Date().toISOString(),
      };
      await store.upsert(row);
      return json(commandSnapshot(row));
    }

    row.reported = reported;
    row.lastSeenAt = new Date().toISOString();
    if (applied >= row.commandId) {
      row.refreshNow = false;
      row.desired = desiredFromReported(reported);
    }
    await store.upsert(row);
    return json(commandSnapshot(row));
  });

  app.post("/api/metar-map/login", async (c) => {
    const origin = c.req.header("Origin") ?? null;
    const password = c.env.METAR_MAP_PASSWORD;
    const secret = c.env.SESSION_SECRET;
    if (!password || !secret) {
      return applyCors(json({ error: "server misconfigured" }, 500), origin);
    }
    const body = parseJsonBody(await c.req.text());
    const submitted = parseLoginBody(body);
    if (!safeEqual(submitted, password)) {
      return applyCors(json({ error: "unauthorized" }, 401), origin);
    }
    const token = await createSessionToken(secret);
    const secure = new URL(c.req.url).protocol === "https:";
    const response = json({ ok: true, token });
    const headers = new Headers(response.headers);
    headers.append("Set-Cookie", sessionCookieValue(token, secure));
    return applyCors(new Response(response.body, { status: 200, headers }), origin);
  });

  app.post("/api/metar-map/logout", async (c) => {
    const origin = c.req.header("Origin") ?? null;
    const secure = new URL(c.req.url).protocol === "https:";
    const response = json({ ok: true });
    const headers = new Headers(response.headers);
    headers.append("Set-Cookie", clearSessionCookie(secure));
    return applyCors(new Response(response.body, { status: 200, headers }), origin);
  });

  async function requireSession(c: { env: Bindings; req: { raw: Request; header: (n: string) => string | undefined } }) {
    const secret = c.env.SESSION_SECRET;
    if (!secret) throw new HttpError(500, "server misconfigured");
    const ok = await sessionFromRequest(secret, c.req.raw);
    if (!ok) throw new HttpError(401, "unauthorized");
  }

  async function loadRow(store: MetarStore): Promise<MetarRow> {
    return (await store.get(DEVICE_ID)) ?? emptyRow();
  }

  async function mutate(
    store: MetarStore,
    update: (row: MetarRow) => void,
  ): Promise<MetarRow> {
    const row = await loadRow(store);
    update(row);
    row.commandId += 1;
    await store.upsert(row);
    return row;
  }

  app.get("/api/metar-map/status", async (c) => {
    await requireSession(c);
    const origin = c.req.header("Origin") ?? null;
    const row = await c.get("store").get(DEVICE_ID);
    return applyCors(json(toStatus(row)), origin);
  });

  app.put("/api/metar-map/brightness", async (c) => {
    await requireSession(c);
    const origin = c.req.header("Origin") ?? null;
    const brightness = parseBrightnessBody(parseJsonBody(await c.req.text()));
    const row = await mutate(c.get("store"), (current) => {
      current.desired = cloneDesired(current.desired);
      current.desired.brightness = brightness;
    });
    return applyCors(json(toStatus(row)), origin);
  });

  app.put("/api/metar-map/schedule", async (c) => {
    await requireSession(c);
    const origin = c.req.header("Origin") ?? null;
    const patch = parseScheduleBody(parseJsonBody(await c.req.text()));
    const row = await mutate(c.get("store"), (current) => {
      current.desired = cloneDesired(current.desired);
      if (patch.scheduleEnabled !== undefined) current.desired.scheduleEnabled = patch.scheduleEnabled;
      if (patch.on) current.desired.on = patch.on;
      if (patch.off) current.desired.off = patch.off;
      if (patch.scheduleEnabled === false) {
        const applied =
          typeof current.reported?.appliedCommandId === "number"
            ? current.reported.appliedCommandId
            : 0;
        if (current.commandId <= applied && isBool(current.reported?.displayOn)) {
          current.desired.displayOn = current.reported.displayOn;
        }
      }
    });
    return applyCors(json(toStatus(row)), origin);
  });

  app.put("/api/metar-map/refresh", async (c) => {
    await requireSession(c);
    const origin = c.req.header("Origin") ?? null;
    const intervalMs = parseRefreshBody(parseJsonBody(await c.req.text()));
    const row = await mutate(c.get("store"), (current) => {
      current.desired = cloneDesired(current.desired);
      current.desired.refreshIntervalMs = intervalMs;
    });
    return applyCors(json(toStatus(row)), origin);
  });

  app.post("/api/metar-map/refresh", async (c) => {
    await requireSession(c);
    const origin = c.req.header("Origin") ?? null;
    const row = await mutate(c.get("store"), (current) => {
      current.refreshNow = true;
    });
    return applyCors(json(toStatus(row)), origin);
  });

  app.put("/api/metar-map/power", async (c) => {
    await requireSession(c);
    const origin = c.req.header("Origin") ?? null;
    const on = parsePowerBody(parseJsonBody(await c.req.text()));
    const row = await mutate(c.get("store"), (current) => {
      current.desired = cloneDesired(current.desired);
      current.desired.displayOn = on;
    });
    return applyCors(json(toStatus(row)), origin);
  });

  return app;
}

export default createApp();
