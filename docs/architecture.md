# Архитектура amoCRM Messenger Bridge

```text
amoCRM REST API (OAuth)         amoCRM Chats API (HMAC-SHA1)
           \                         /
            Contact/chat resolver  Webhook ingress
                       \           /
                    PostgreSQL jobs
                          |
                  durable workers/router
                          |
                   Adapter registry
                 /          |          \
        Telegram MTProto  WhatsApp     MAX Bot API
                         Cloud API   (personal BLOCKED)
```

## Границы и multi-account

`messenger_accounts` — центральная сущность канала. Каждая запись имеет собственные provider account ID, encrypted `credential_ref`, amoCRM account/scope/source, config и connection state. Global scope и account `default` отсутствуют. Adapter registry индексируется парой `(messenger, account_id)`.

REST и Chats API — разные клиенты и разные credentials. `/connect` вызывается с полученным через REST `amojo_id`, а возвращённый `scope_id` атомарно сохраняется для конкретного messenger account. Source создаётся официальным Sources API и используется вместе со scope для outbound routing.

## Inbound

1. Provider update проходит проверку подписи/secret и body/rate limits. Telegram update принимает уже авторизованный account-specific MTProto client.
2. Webhook одним PostgreSQL `INSERT ... ON CONFLICT` сохраняется в `jobs`; только после commit возвращается HTTP 200. Бизнес-обработка в request handler не выполняется. Это критично для amoCRM, которая не повторяет Chats webhooks.
3. Worker claims запись через `FOR UPDATE SKIP LOCKED`. Более поздняя работа той же partition не выдаётся, пока ранняя pending/processing. Lease heartbeat защищает длительную media-операцию; reaper возвращает abandoned jobs после crash/restart.
4. Adapter переводит payload в `NormalizedMessage`. Queue dedupe key содержит реальные account/conversation/message IDs.
5. Router находит mapping. При точном совпадении нормализованного телефона создаёт чат через Chats API и официально связывает UUID чата с существующим контактом через `POST /api/v4/contacts/chats`; сохраняет contact/lead ID. В остальных случаях amoCRM создаёт стандартный чат/неразобранное по правилам канала.
6. Media скачивается только по HTTPS, с DNS/IP SSRF-проверкой, allowlist, timeout и потоковым size limit; затем malware scan, S3 server-side encryption и короткоживущая signed URL.
7. Входящее `new_message` отправляется в amoCRM, после чего сохраняются обе стороны ID. Повторный provider webhook не создаёт второй job.

## Outbound и write-first

Webhook amoCRM проверяется HMAC-SHA1 `X-Signature` по raw body и `channel_secret`. Отдельного webhook secret нет. Partition — scope + amo conversation; dedupe key — scope + amo message ID.

Для существующего mapping adapter получает только сохранённые `provider_recipient_id` и `provider_conversation_id`. `receiver.id` amoCRM никогда не используется как messenger ID. При write-first account выбирается по `(scope_id, source.external_id)`, затем adapter официальным API резолвит телефон/username и сохраняет реальные provider IDs до отправки. Telegram может резолвить username/phone, WhatsApp использует E.164 phone; MAX Bot не может начать диалог до `/start` и поэтому write-first для MAX заблокирован.

WhatsApp free-form разрешается только внутри 24-hour window от `last_inbound_at`; вне окна требуется account-specific mapping одобренного template. Status webhooks обновляют mapping монотонно и передают delivered/read/failed в Chats API.

## Надёжность

- PostgreSQL — единственный production storage для accounts, encrypted secrets, conversation/message mappings и jobs.
- Семантика delivery — at-least-once. Provider APIs не дают общей транзакции с нашей БД, поэтому остаётся неизбежное ambiguous-result окно, если процесс погиб после принятия сообщения provider, но до сохранения ответа. Стабильные provider/amo IDs и reconciliation уменьшают риск; обещать exactly-once нельзя.
- Retry выполняется для 429/408/5xx и временных network/dependency ошибок, учитывает `Retry-After`, exponential backoff и jitter. Постоянные HTTP 4xx идут в dead-letter.
- Ordering обеспечивается partition key; разные диалоги обрабатываются параллельно.
- Supervisor поддерживает отдельное состояние/reconnect backoff каждого account. Graceful shutdown прекращает claim, ждёт workers, закрывает adapters, HTTP и pool.
- `/health/live` проверяет процесс; `/health/ready` — PostgreSQL, S3, ClamAV и состояние queue.

## Безопасность

`AMOCRM_READ_ONLY` по умолчанию `true`; общий transport guard блокирует любой не-GET до вызова сети. Кроме того, startup запрещает `AMOCRM_READ_ONLY=false`, пока `AMOCRM_ENVIRONMENT` не равен `test`. Production `.env` не меняется.

Sessions/tokens/app secrets хранятся через `SecretStore`; PostgreSQL implementation использует AES-256-GCM envelope encryption, а master key приходит извне. Request logging webhook/admin bodies отключён; logger redacts authorization/token/secret/session/password/code. Admin onboarding защищён bearer token. TLS termination и сетевые egress/ingress policies остаются обязанностью deployment perimeter.

## Таблицы

- `messenger_accounts`: отдельные credentials/source/scope/state каждого номера или аккаунта.
- `conversation_mappings`: provider account/chat/recipient ↔ amo conversation/contact/lead/scope, `last_inbound_at`, write-first state.
- `message_mappings`: provider/amo message IDs, direction, monotonic status/timestamps.
- `jobs`: durable inbox/outbox, hash/dedupe, partition, attempts, availability, lease, completed/dead state.
- `secrets`: только AES-GCM ciphertext; plaintext credentials не сохраняются.

Миграция: `migrations/001_initial.sql`.
