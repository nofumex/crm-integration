# Test-environment E2E runbook

These steps must be executed only against a separate amoCRM test account. The current production account is never a valid target.

## 1. Infrastructure

1. Provision PostgreSQL with backups/PITR, private S3-compatible storage, ClamAV, TLS ingress and restricted egress.
2. Set all variables from `.env.example`. For the test tenant only set `AMOCRM_ENVIRONMENT=test` and `AMOCRM_READ_ONLY=false`.
3. Run `npm ci`, `npm run build`, `npm test`, then `npm run migrate` and start the service.
4. Confirm `/health/live` = 200 and `/health/ready` = 200.

## 2. amoCRM test account

1. Register/obtain a custom Chats channel through the official amoCRM process; configure its v2 webhook as `https://bridge.example/webhooks/amocrm/:scope_id` and declare only implemented capabilities.
2. Put test OAuth token, `channel_id` and `channel_secret` in the test deployment.
3. Create messenger account records through authenticated onboarding.
4. Call `POST /admin/accounts/{accountId}/amocrm/connect`; verify the returned `/connect` `scope_id` was persisted.
5. Call `POST /admin/accounts/{accountId}/amocrm/source` for each channel/source.
6. Never repeat these POST operations against the production base URL.

## 3. Messenger credentials

- Telegram: `api_id`, `api_hash`, a dedicated test phone/account, login code and optional 2FA password. Complete `/admin/telegram/onboarding`; verify reconnect after service restart and after temporary network loss.
- WhatsApp: Meta test/business portfolio, WABA, phone-number ID, permanent/system-user access token, app secret, webhook verify token, current Graph version and at least one approved template. Configure Meta webhook fields for messages/statuses.
- MAX: moderated test bot token and an account-specific webhook secret. Set `config.webhookUrl` to `/webhooks/max/{accountId}`; the adapter creates the official subscription. Personal MAX is out of scope.

## 4. Required real scenarios

For every supported channel: inbound/outbound text, duplicate webhook, attachment types, restart during processing, temporary 429/5xx, reconnect and multiple accounts. Also verify exact contact phone matching, linking to an existing contact/deal, new-chat behaviour, source selection, manager write-first, replies, delivery/read/failure statuses, and message order.

WhatsApp additionally requires free-form inside the 24-hour window and approved template outside it. Telegram requires code login plus 2FA and revoked-session recovery. MAX requires bot `/start`, inbound reply, upload/send media and webhook resubscription.

Inspect dead jobs through `GET /admin/jobs/dead`; after fixing the cause use `POST /admin/jobs/{id}/requeue`. Payloads are deliberately not returned by this endpoint.

## 5. Promotion gate

Do not call the bridge `PRODUCTION READY` until all real round trips above pass, provider rate limits are load-tested, backup restore and key rotation are rehearsed, and monitoring/alerts/TLS/network policies are installed. Provider APIs cannot participate in the PostgreSQL transaction, so an abrupt crash after provider acceptance can produce an ambiguous delivery result; monitor and reconcile these cases rather than claiming exactly-once delivery.
