interface Env {
  GATEWAY_SECRET: string;
  CHATGPT_ACTION_KEY?: string;
  GATEWAY_LIMITER: { limit(options: { key: string }): Promise<{ success: boolean }> };
}

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-API-Key",
};

const ALLOWED_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]);
const MAX_REQUEST_BODY = 1024 * 1024;
const MAX_RESPONSE_BODY = 2 * 1024 * 1024;
const MAX_URL_LENGTH = 4096;
const MAX_HEADERS = 50;
const MAX_HEADER_BYTES = 32 * 1024;

const OPENAPI = {
  openapi: "3.1.0",
  info: {
    title: "API CSV Tools ChatGPT Action",
    version: "1.0.0",
    description: "Authenticated API testing endpoint for API CSV Tools.",
  },
  servers: [{ url: "https://api-csv-tools-gateway.shalubano637.workers.dev" }],
  paths: {
    "/api/chatgpt/test": {
      post: {
        operationId: "test_api",
        summary: "Test an HTTP API",
        description: "Send a GET, POST, PUT, PATCH, DELETE or HEAD request through API CSV Tools and return status, timing, headers and response body.",
        security: [{ ApiKeyAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["url"],
                properties: {
                  url: { type: "string", format: "uri", description: "HTTP or HTTPS API URL." },
                  method: { type: "string", enum: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"], default: "GET" },
                  headers: { type: "object", additionalProperties: { type: "string" } },
                  body: { description: "Optional request body. Prefer an object for JSON APIs." },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Upstream API response",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    status: { type: "integer" },
                    statusText: { type: "string" },
                    duration: { type: "integer" },
                    headers: { type: "object", additionalProperties: { type: "string" } },
                    body: { type: "string" },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      ApiKeyAuth: {
        type: "apiKey",
        in: "header",
        name: "X-API-Key",
      },
    },
  },
};

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
    h === "0.0.0.0" ||
    h === "::" ||
    h === "[::]" ||
    h === "::1" ||
    h === "[::1]"
  ) return true;

  if (h.includes(":")) {
    const raw = h.replace(/^\[/, "").replace(/\]$/, "");
    const first = raw.split(":")[0];
    const value = Number.parseInt(first || "0", 16);
    return raw === "::1" || raw === "::" || value === 0xfe80 || (value & 0xfe00) === 0xfc00;
  }

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
  const headers = new Headers();

  if (input) {
    for (const [key, value] of Object.entries(input)) {
      if (typeof value !== "string") continue;
      headers.set(key, value);
    }
  }

  headers.delete("host");
  headers.delete("origin");
  headers.delete("referer");
  headers.delete("cookie");
  headers.delete("x-api-key");
  headers.delete("x-gateway-secret");
  headers.delete("content-length");
  return headers;
}

async function runUpstream(input: {
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
}) {
  if (!input.url || typeof input.url !== "string") return json({ error: "url is required" }, 400);
  if (input.url.length > MAX_URL_LENGTH) return json({ error: "URL is too long" }, 400);

  const target = new URL(input.url);
  if (!["http:", "https:"].includes(target.protocol)) {
    return json({ error: "Only HTTP(S) URLs are allowed" }, 400);
  }
  if (target.username || target.password) {
    return json({ error: "Credentials in the target URL are not allowed" }, 400);
  }
  if (target.port && target.port !== "80" && target.port !== "443") {
    return json({ error: "Only ports 80 and 443 are allowed" }, 400);
  }
  if (isBlockedHost(target.hostname)) {
    return json({ error: "Private or local hosts are not allowed" }, 400);
  }

  const method = (input.method || "GET").toUpperCase();
  if (!ALLOWED_METHODS.has(method)) {
    return json({ error: "Unsupported method" }, 400);
  }

  const headers = cleanHeaders(input.headers);
  let headerBytes = 0;
  let headerCount = 0;
  headers.forEach((value, key) => {
    headerCount += 1;
    headerBytes += key.length + value.length;
  });
  if (headerCount > MAX_HEADERS || headerBytes > MAX_HEADER_BYTES) {
    return json({ error: "Too many or oversized request headers" }, 400);
  }

  let body: string | undefined;
  if (!["GET", "HEAD"].includes(method) && input.body !== undefined) {
    body = typeof input.body === "string" ? input.body : JSON.stringify(input.body);
    if (new TextEncoder().encode(body).byteLength > MAX_REQUEST_BODY) {
      return json({ error: "Request body is too large (max 1 MB)" }, 413);
    }
    if (!headers.has("content-type")) headers.set("content-type", "application/json");
  }

  const started = Date.now();
  const upstream = await fetch(target.toString(), {
    method,
    headers,
    body,
    redirect: "manual",
  });

  const text = await upstream.text();
  if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BODY) {
    return json({ error: "Upstream response is too large (max 2 MB)" }, 413);
  }

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
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const requestUrl = new URL(request.url);

    if (request.method === "OPTIONS") {
      return requestUrl.pathname === "/api/gateway" || requestUrl.pathname === "/api/chatgpt/test"
        ? new Response(null, { headers: cors })
        : json({ error: "Not found" }, 404);
    }

    if (requestUrl.pathname === "/openapi.json" && request.method === "GET") {
      return new Response(JSON.stringify(OPENAPI), {
        headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=3600" },
      });
    }

    if (requestUrl.pathname !== "/api/gateway" && requestUrl.pathname !== "/api/chatgpt/test") {
      return json({ error: "Not found" }, 404);
    }

    if (!env.GATEWAY_SECRET) {
      return json({ error: "Gateway is not configured" }, 503);
    }

    const clientKey = request.headers.get("CF-Connecting-IP") || "unknown";
    const limited = await env.GATEWAY_LIMITER.limit({ key: clientKey });
    if (!limited.success) return json({ error: "Rate limit exceeded. Try again later." }, 429);

    if (requestUrl.pathname === "/api/chatgpt/test") {
      if (!env.CHATGPT_ACTION_KEY) {
        return json({ error: "ChatGPT action is not configured" }, 503);
      }
      const providedKey = request.headers.get("X-API-Key");
      if (!providedKey || providedKey !== env.CHATGPT_ACTION_KEY) {
        return json({ error: "Unauthorized" }, 401);
      }
    }

    if (request.method !== "POST") return json({ error: "Not found" }, 404);

    try {
      const contentLength = request.headers.get("content-length");
      if (contentLength && Number(contentLength) > MAX_REQUEST_BODY + 64 * 1024) {
        return json({ error: "Request is too large (max 1 MB)" }, 413);
      }

      const raw = await request.text();
      if (new TextEncoder().encode(raw).byteLength > MAX_REQUEST_BODY) {
        return json({ error: "Request body is too large (max 1 MB)" }, 413);
      }

      const input = JSON.parse(raw) as {
        url?: string;
        method?: string;
        headers?: Record<string, string>;
        body?: unknown;
      };

      return await runUpstream(input);
    } catch (error) {
      return json({
        error: error instanceof Error ? error.message : "Gateway request failed",
      }, 502);
    }
  },
};
