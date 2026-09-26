interface Env { GATEWAY_SECRET: string }

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const ALLOWED_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function isBlockedHost(hostname: string) {
  const h = hostname.toLowerCase().replace(/\.$/, "");
  if (
    h === "localhost" ||
    h.endsWith(".localhost") ||
    h === "::1" ||
    h === "[::1]" ||
    h === "0.0.0.0" ||
    h === "::"
  ) return true;

  const ipv4 = h.match(/^(?:\d{1,3}\.){3}\d{1,3}$/);
  if (!ipv4) return false;

  const parts = h.split(".").map(Number);
  if (parts.some(n => n > 255)) return true;

  const [a, b] = parts;
  return (
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function cleanHeaders(input: Record<string, string> | undefined) {
  const headers = new Headers(input || {});
  headers.delete("host");
  headers.delete("origin");
  headers.delete("referer");
  headers.delete("cookie");
  headers.delete("authorization");
  headers.delete("x-gateway-secret");
  return headers;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors });
    }

    const requestUrl = new URL(request.url);
    if (requestUrl.pathname !== "/api/gateway" || request.method !== "POST") {
      return json({ error: "Not found" }, 404);
    }

    if (!env.GATEWAY_SECRET) {
      return json({ error: "Gateway is not configured" }, 503);
    }

    try {
      const input = await request.json() as {
        url?: string;
        method?: string;
        headers?: Record<string, string>;
        body?: unknown;
      };

      if (!input.url) return json({ error: "url is required" }, 400);

      const target = new URL(input.url);
      if (!["http:", "https:"].includes(target.protocol)) {
        return json({ error: "Only HTTP(S) URLs are allowed" }, 400);
      }

      if (isBlockedHost(target.hostname)) {
        return json({ error: "Private or local hosts are not allowed" }, 400);
      }

      const method = (input.method || "GET").toUpperCase();
      if (!ALLOWED_METHODS.has(method)) {
        return json({ error: "Unsupported method" }, 400);
      }

      const headers = cleanHeaders(input.headers);
      let body: string | undefined;

      if (!["GET", "HEAD"].includes(method) && input.body !== undefined) {
        body = typeof input.body === "string" ? input.body : JSON.stringify(input.body);
        if (!headers.has("content-type")) {
          headers.set("content-type", "application/json");
        }
      }

      const started = Date.now();
      const upstream = await fetch(target.toString(), {
        method,
        headers,
        body,
        redirect: "manual",
      });

      const text = await upstream.text();
      const responseHeaders: Record<string, string> = {};
      upstream.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      return json({
        status: upstream.status,
        statusText: upstream.statusText,
        duration: Date.now() - started,
        headers: responseHeaders,
        body: text,
      });
    } catch (error) {
      return json({
        error: error instanceof Error ? error.message : "Gateway request failed",
      }, 502);
    }
  },
};
