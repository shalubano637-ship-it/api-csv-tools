interface Env { GATEWAY_SECRET?: string }

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Gateway-Secret",
};

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    const url = new URL(request.url);
    if (url.pathname !== "/api/gateway" || request.method !== "POST") return response({ error: "Not found" }, 404);

    if (env.GATEWAY_SECRET) {
      const supplied = request.headers.get("X-Gateway-Secret");
      if (supplied !== env.GATEWAY_SECRET) return response({ error: "Unauthorized" }, 401);
    }

    try {
      const input = await request.json() as {
        url?: string;
        method?: string;
        headers?: Record<string, string>;
        body?: unknown;
      };
      if (!input.url) return response({ error: "url is required" }, 400);
      const target = new URL(input.url);
      if (!["http:", "https:"].includes(target.protocol)) return response({ error: "Only HTTP(S) URLs are allowed" }, 400);

      const method = (input.method || "GET").toUpperCase();
      if (!["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"].includes(method)) return response({ error: "Unsupported method" }, 400);

      const headers = new Headers(input.headers || {});
      headers.delete("host");
      headers.delete("origin");
      let body: string | undefined;
      if (!["GET", "HEAD"].includes(method) && input.body !== undefined) {
        body = typeof input.body === "string" ? input.body : JSON.stringify(input.body);
        if (!headers.has("content-type")) headers.set("content-type", "application/json");
      }

      const started = Date.now();
      const upstream = await fetch(target.toString(), { method, headers, body });
      const text = await upstream.text();
      const responseHeaders: Record<string, string> = {};
      upstream.headers.forEach((value, key) => { responseHeaders[key] = value; });
      return response({ status: upstream.status, statusText: upstream.statusText, duration: Date.now() - started, headers: responseHeaders, body: text });
    } catch (error) {
      return response({ error: error instanceof Error ? error.message : "Gateway request failed" }, 502);
    }
  },
};
