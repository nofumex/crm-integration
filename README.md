# amoCRM Messenger Bridge

TypeScript service integrating amoCRM Chats API with Telegram user accounts (MTProto), WhatsApp Business Cloud API and the official MAX Bot API.

The checked-in implementation is deployable, but it is not labelled production-ready until real round-trip tests are completed on separate test accounts. Personal MAX is intentionally unsupported because no public official API exists.

## Absolute amoCRM safety boundary

`AMOCRM_READ_ONLY` defaults to `true`. Both amoCRM clients reject every non-GET method before calling network transport. Startup additionally rejects write mode unless `AMOCRM_ENVIRONMENT=test`. Never point a write-enabled deployment at the current production tenant.

```powershell
npm ci
npm run build
npm test
npm run migrate
npm start
```

Production storage is PostgreSQL; S3-compatible object storage and ClamAV are mandatory. The server will not start with an incomplete config or an unapplied schema. Readiness checks PostgreSQL, object storage and ClamAV.

## Runtime

- `src/amocrm`: separate OAuth REST and HMAC Chats clients, lifecycle and contact/chat resolver.
- `src/adapters`: account-specific Telegram, WhatsApp and MAX adapters.
- `src/runtime`: encrypted onboarding, adapter factory and reconnect supervisor.
- `src/queue`: PostgreSQL inbox/outbox, partition ordering, leases, retries and dead-letter.
- `src/router`: normalized inbound/outbound flow using persisted provider IDs.
- `src/media`: SSRF-safe downloads, limits, malware scanning, encrypted object storage and signed URLs.
- `src/webhooks`: verified webhook ingress, immediate durable ACK, health/admin endpoints.

Copy names from `.env.example` into the deployment secret manager; do not put credentials into source control. Messenger credentials are submitted to the authenticated admin API and encrypted before persistence.

Operational and E2E steps are in [docs/e2e-runbook.md](docs/e2e-runbook.md). Research and design are in [docs/research.md](docs/research.md), [docs/analogues.md](docs/analogues.md), and [docs/architecture.md](docs/architecture.md).
