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

## Cloudflare gateway
A separate Worker is provided under `worker/` for server-side API requests. Configure the Worker secret `GATEWAY_SECRET` before production use.

## Local development
```bash
npm install
npm run dev
```
