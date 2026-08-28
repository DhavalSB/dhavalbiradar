import { createApp } from "./app";
import { D1Store } from "./d1-store";
import type { Bindings } from "./types";

export default {
  async fetch(request: Request, env: Bindings, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      const app = createApp({ store: new D1Store(env.DB) });
      return app.fetch(request, env, ctx);
    }
    if (url.pathname === "/") {
      return Response.redirect(new URL("/metar-map/", url), 302);
    }
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }
    return new Response("Not found", { status: 404 });
  },
};
