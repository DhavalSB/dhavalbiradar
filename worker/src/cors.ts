const STATIC_ORIGINS = new Set([
  "https://dhavalbiradar.com",
  "https://www.dhavalbiradar.com",
]);

export function isAllowedOrigin(origin: string | undefined | null): origin is string {
  if (!origin) return false;
  if (STATIC_ORIGINS.has(origin)) return true;
  if (origin === "https://map.dhavalbiradar.com") return true;
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true;
  if (/^https:\/\/([a-z0-9-]+\.)?dhavalbiradar-metar-map\.pages\.dev$/.test(origin)) return true;
  if (/^https:\/\/dhavalbiradar-metar-map\.[a-z0-9-]+\.workers\.dev$/.test(origin)) return true;
  return false;
}

export function corsHeaders(origin: string | undefined | null): Record<string, string> {
  if (!isAllowedOrigin(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, PUT, POST, OPTIONS",
    Vary: "Origin",
  };
}
