import { SESSION_COOKIE, SESSION_MAX_AGE_S } from "./types";

export function safeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const aa = encoder.encode(a);
  const bb = encoder.encode(b);
  const len = Math.max(aa.byteLength, bb.byteLength, 1);
  let out = aa.byteLength === bb.byteLength ? 0 : 1;
  for (let i = 0; i < len; i++) {
    out |= (aa[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return out === 0;
}

export function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)/i.exec(header.trim());
  return match ? match[1] : null;
}

async function hmacHex(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return [...new Uint8Array(sig)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function createSessionToken(secret: string, now = Date.now()): Promise<string> {
  const exp = now + SESSION_MAX_AGE_S * 1000;
  const payload = `v1.${exp}`;
  const sig = await hmacHex(secret, payload);
  return `${payload}.${sig}`;
}

export async function verifySessionToken(
  secret: string,
  token: string | null | undefined,
  now = Date.now(),
): Promise<boolean> {
  if (!token || !secret) return false;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return false;
  const exp = Number(parts[1]);
  if (!Number.isFinite(exp) || exp <= now) return false;
  const payload = `v1.${parts[1]}`;
  const expected = await hmacHex(secret, payload);
  return safeEqual(expected, parts[2]);
}

export function parseCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  const parts = header.split(";");
  for (const part of parts) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    if (key === name) return part.slice(idx + 1).trim();
  }
  return null;
}

export function sessionCookieValue(token: string, secure: boolean, maxAge = SESSION_MAX_AGE_S): string {
  const attrs = [
    `${SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ];
  if (secure) attrs.push("Secure");
  return attrs.join("; ");
}

export function clearSessionCookie(secure: boolean): string {
  return sessionCookieValue("deleted", secure, 0);
}

export async function sessionFromRequest(
  secret: string,
  request: Request,
): Promise<boolean> {
  const auth = bearerToken(request.headers.get("Authorization") ?? undefined);
  if (await verifySessionToken(secret, auth)) return true;
  const cookie = parseCookie(request.headers.get("Cookie") ?? undefined, SESSION_COOKIE);
  return verifySessionToken(secret, cookie);
}
