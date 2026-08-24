# amoCRM Messenger Bridge

TypeScript service integrating amoCRM Chats API with Telegram Personal (MTProto). WhatsApp Cloud/WABA and MAX Bot are outside the product. WhatsApp Personal and MAX Personal activation is fail-closed until their vendors publish or grant documented first-party linked-device APIs/SDKs.

The checked-in implementation is deployable, but it is not labelled production-ready until real round-trip tests are completed on separate test accounts. Personal MAX is intentionally unsupported because no public official API exists.

## Absolute amoCRM safety boundary

`AMOCRM_READ_ONLY` defaults to `true`. Both amoCRM clients reject every non-GET method before calling network transport. Write mode additionally requires `AMOCRM_WRITES_ENABLED=true`, an expected account ID and expected subdomain; startup verifies both through a GET before enabling writes. Never enable this gate for the current production tenant.

```powershell
npm ci
npm run build
npm test
npm run migrate
npm start
```

Production storage is PostgreSQL; S3-compatible object storage and ClamAV are mandatory. The server will not start with an incomplete config or an unapplied schema. Readiness checks PostgreSQL, object storage and ClamAV.

## Self-hosted deployment (Docker Compose)

Full step-by-step guide: [deploy/DEPLOY.md](deploy/DEPLOY.md)

Quick start on VPS:

```bash
cp deploy/.env.production.example .env
# edit .env — set PUBLIC_DOMAIN, secrets, amoCRM tokens
docker compose up -d --build
```

After DNS points to the VPS, open `https://YOUR_DOMAIN/admin` to connect Telegram accounts. amoCRM Chats `channel_id` / `channel_secret` can be added to `.env` after amoCRM registration — the service starts without them and exposes the webhook URL template in the admin UI.

## Runtime

- `src/amocrm`: separate OAuth REST and HMAC Chats clients, lifecycle and contact/chat resolver.
- `src/adapters`: account-specific Telegram adapter; unsupported Personal transports are refused explicitly.
- `src/runtime`: encrypted onboarding, adapter factory and reconnect supervisor.
- `src/queue`: PostgreSQL inbox/outbox, partition ordering, leases, retries and dead-letter.
- `src/router`: normalized inbound/outbound flow using persisted provider IDs.
- `src/media`: SSRF-safe downloads, limits, malware scanning, encrypted object storage and signed URLs.
- `src/webhooks`: verified webhook ingress, immediate durable ACK, health/admin endpoints.

Copy names from `.env.example` into the deployment secret manager; do not put credentials into source control. Messenger credentials are submitted to the authenticated admin API and encrypted before persistence.

Operational and E2E steps are in [docs/e2e-runbook.md](docs/e2e-runbook.md). Research and design are in [docs/research.md](docs/research.md), [docs/analogues.md](docs/analogues.md), and [docs/architecture.md](docs/architecture.md).
