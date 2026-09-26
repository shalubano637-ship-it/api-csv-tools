# API CSV Tools

A developer-focused web toolkit combining API testing, CSV workflows and JSON utilities.

## Current MVP

- API tester: GET, POST, PUT, PATCH, DELETE
- Request JSON body
- Query parameters, custom headers and bearer/API-key auth
- Response status, timing, body and headers
- Local request history
- CSV upload with local parsing, search, cleaning, validation and export
- CSV to JSON and JSON to CSV
- JSON validation and formatter
- JSON schema diff
- CSV to API bulk importer
- Plugin/integration manager
- Responsive dark UI

## ChatGPT / MCP integration

API CSV Tools can be connected to ChatGPT as a remote MCP server for API testing.

### MCP server URL

```
https://api-csv-tools-gateway.shalubano637.workers.dev/mcp
```

### Connect

In ChatGPT's supported app/plugin/developer connection flow:

1. Create a new MCP connection.
2. Name it `API CSV Tools`.
3. Use the MCP server URL above.
4. Select **No Authentication**.
5. Connect and refresh the tool definition if needed.

Availability of custom MCP connections depends on the ChatGPT plan, workspace and current product rollout.

### MCP API tester

The `test_api` tool supports:

- GET
- HEAD
- POST
- PUT
- PATCH
- DELETE
- JSON or text request bodies
- Custom request headers
- Bearer/API-key style authorization headers
- Response status, timing, headers and body

Read-only GET/HEAD requests can run directly. Mutating requests (POST, PUT, PATCH and DELETE) require explicit confirmation through the tool's `confirm=true` parameter.

Example prompt:

```
API CSV Tools se https://jsonplaceholder.typicode.com/todos/1 ko GET request se test karo.
Status code, response time aur response body batao.
```

POST example:

```
API CSV Tools se https://jsonplaceholder.typicode.com/posts par POST request karo.

JSON body:
{
  "title": "Test",
  "body": "Hello from ChatGPT",
  "userId": 1
}
```

The tool may require explicit confirmation before executing the POST.

### Security restrictions

The gateway blocks:

- localhost and private/local IP addresses
- unsupported URL schemes
- credentials embedded in target URLs
- non-standard ports other than 80/443
- oversized request bodies
- oversized response bodies
- excessive request headers

The gateway also applies per-client rate limiting.

Do not send production secrets, passwords, session cookies or other sensitive credentials unless you understand the security implications of routing them through a third-party API gateway.

## Cloudflare gateway

A separate Worker is provided under `worker/` for server-side API requests. Configure the Worker secret `GATEWAY_SECRET` before production use.

Gateway endpoint:

```
https://api-csv-tools-gateway.shalubano637.workers.dev/api/gateway
```

## Local development

```bash
npm install
npm run dev
```
