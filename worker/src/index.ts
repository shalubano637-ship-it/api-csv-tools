interface Env { GATEWAY_SECRET: string }

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Gateway-Secret",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function isBlockedHost(hostname: string) {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h === "::1") return true;
  if (/^127\\./.test(h) || /^10\\./.test(h) || /^192\\.168\\./.test(h)) return true;
  const m = h.match(/^172\\.(\\d{1,3})\\./);
  if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return true;
  return false;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    const url = new URL(request.url);
    if (url.pathname !== "/api/gateway" || request.method !== "POST") return json({ error: "Not found" }, 404);

    if (!env.GATEWAY_SECRET || request.headers.get("X-Gateway-Secret") !== env.GATEWAY_SECRET) {
      return json({ error: "Unauthorized" }, 401);
    }

    try {
      const input = await request.json() as { url?: string; method?: string; headers?: Record<string, string>; body?: unknown };
      if (!input.url) return json({ error: "url is required" }, 400);
      const target = new URL(input.url);
      if (!["http:", "https:"].includes(target.protocol)) return json({ error: "Only HTTP(S) URLs are allowed" }, 400);
      if (isBlockedHost(target.hostname)) return json({ error: "Private or local hosts are not allowed" }, 400);

      const method = (input.method || "GET").toUpperCase();
      if (!["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"].includes(method)) return json({ error: "Unsupported method" }, 400);
      const headers = new Headers(input.headers || {});
      headers.delete("host"); headers.delete("origin"); headers.delete("x-gateway-secret");
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
      return json({ status: upstream.status, statusText: upstream.statusText, duration: Date.now() - started, headers: responseHeaders, body: text });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "Gateway request failed" }, 502);
    }
  },
};
