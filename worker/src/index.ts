interface Env { GATEWAY_SECRET: string; GATEWAY_LIMITER: { limit(options: { key: string }): Promise<{ success: boolean }> } }

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const ALLOWED_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]);
const MAX_REQUEST_BODY = 1024 * 1024;
const MAX_RESPONSE_BODY = 2 * 1024 * 1024;
const MAX_URL_LENGTH = 4096;

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
    const clientKey = request.headers.get("CF-Connecting-IP") || "unknown";
    const limited = await env.GATEWAY_LIMITER.limit({ key: clientKey });
    if (!limited.success) return json({ error: "Rate limit exceeded. Try again later." }, 429);
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
      if (input.url.length > MAX_URL_LENGTH) return json({ error: "URL is too long" }, 400);
      if (input.body !== undefined) {
        const serialized = typeof input.body === "string" ? input.body : JSON.stringify(input.body);
        if (serialized.length > MAX_REQUEST_BODY) return json({ error: "Request body is too large (max 1 MB)" }, 413);
      }

      const target = new URL(input.url);
      if (!["http:", "https:"].includes(target.protocol)) {
        return json({ error: "Only HTTP(S) URLs are allowed" }, 400);
      }

      if (target.username || target.password) return json({ error: "Credentials in the target URL are not allowed" }, 400);
      if (target.port && target.port !== "80" && target.port !== "443") return json({ error: "Only ports 80 and 443 are allowed" }, 400);
      if (isBlockedHost(target.hostname)) {
        return json({ error: "Private or local hosts are not allowed" }, 400);
      }

      const method = (input.method || "GET").toUpperCase();
      if (!ALLOWED_METHODS.has(method)) {
        return json({ error: "Unsupported method" }, 400);
      }

      const headers = cleanHeaders(input.headers);
      if (headers.has("content-length")) headers.delete("content-length");
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
      if (text.length > MAX_RESPONSE_BODY) return json({ error: "Upstream response is too large (max 2 MB)" }, 413);
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
