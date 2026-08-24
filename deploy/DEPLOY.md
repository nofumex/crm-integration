# Production deployment (Docker Compose)

Target VPS: `155.212.217.115`

## 1. DNS

Create an `A` record for your domain pointing to `155.212.217.115`.

Example: `bridge.example.com → 155.212.217.115`

## 2. VPS preparation

```bash
# On the VPS
sudo apt update && sudo apt install -y docker.io docker-compose-plugin git
sudo usermod -aG docker $USER
# re-login to apply docker group
```

## 3. Clone and configure

```bash
git clone <your-repo-url> crm-integration
cd crm-integration
cp deploy/.env.production.example .env
```

Edit `.env`:

| Variable | Action |
|----------|--------|
| `PUBLIC_DOMAIN` | your domain |
| `POSTGRES_PASSWORD`, `MINIO_ROOT_PASSWORD` | strong random values |
| `SECRET_MASTER_KEY`, `ADMIN_API_TOKEN` | `openssl rand -hex 32` |
| `AMOCRM_BASE_URL`, `AMOCRM_ACCESS_TOKEN` | amoCRM OAuth |
| `AMOCRM_DEFAULT_ACCOUNT_ID` | amoCRM account numeric ID |
| `AMOCRM_DEFAULT_SOURCE_EXTERNAL_ID` | source slug (≤36 chars) |

Leave `AMOCRM_CHATS_CHANNEL_ID` and `AMOCRM_CHATS_CHANNEL_SECRET` empty for the first start.

## 4. Start stack

```bash
docker compose up -d --build
docker compose ps
docker compose logs -f app
```

Caddy obtains Let's Encrypt certificates automatically.

Verify:

- `https://YOUR_DOMAIN/health/live` → `{"ok":true}`
- `https://YOUR_DOMAIN/health/ready` → 200 when PostgreSQL, MinIO and ClamAV are up
- `https://YOUR_DOMAIN/admin` → admin UI

## 5. Register amoCRM Chats webhook

1. Open `/admin`, log in with `ADMIN_API_TOKEN`.
2. Connect a Telegram account (wizard: phone → code → 2FA).
3. Click **Подключить amoCRM** — note the `scope_id`.
4. In amoCRM, register the custom Chats channel webhook:

   `https://YOUR_DOMAIN/webhooks/amocrm/{scope_id}`

5. amoCRM returns `channel_id` and `channel_secret`. Add them to `.env`:

   ```
   AMOCRM_CHATS_CHANNEL_ID=...
   AMOCRM_CHATS_CHANNEL_SECRET=...
   ```

6. Restart:

   ```bash
   docker compose up -d
   ```

## 6. Enable writes (test tenant only)

For a **separate test amoCRM account**:

```
AMOCRM_READ_ONLY=false
AMOCRM_WRITES_ENABLED=true
AMOCRM_EXPECTED_ACCOUNT_ID=<id>
AMOCRM_EXPECTED_SUBDOMAIN=<subdomain>
```

Never enable writes against production amoCRM.

## 7. Day-2 operations

```bash
# Logs
docker compose logs -f app caddy

# Restart after .env change
docker compose up -d

# Backup PostgreSQL
docker compose exec postgres pg_dump -U bridge messenger_bridge > backup.sql
```

Telegram `api_id`, `api_hash` and MTProto sessions are stored encrypted in PostgreSQL via SecretStore — not in `.env`.
