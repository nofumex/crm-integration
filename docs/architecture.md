# Архитектура messenger bridge

```text
amoCRM REST API (OAuth)       amoCRM Chats API / amojo (HMAC)
          \                         /
           \--- Message Router ---/
                    |
          PostgreSQL mappings + inbox
                    |
             MessengerAdapter
             /       |       \
 Telegram MTProto  WhatsApp  MAX Bot API
    (teleproto)    Cloud API  (personal blocked)
```

## Границы компонентов

- `AmoCrmRestClient`: account/users metadata, contacts/chats binding, sources. Любой HTTP проходит через общий safety guard.
- `AmoCrmChatsClient`: отдельная HMAC-авторизация, connect/create/send/status/history. Не принимает OAuth token.
- `MessageRouter`: нормализация, выбор account adapter, idempotency, ordering, mapping и status propagation.
- `MessengerAdapter`: общий lifecycle `connect/disconnect/health`, `send`, inbound/status callbacks. Конкретные provider payloads не выходят за adapter.
- PostgreSQL: authoritative mapping и durable webhook inbox. Нельзя полагаться только на IDs из UI amoCRM.
- Webhook server: проверяет raw-body signature/secret до router: amoCRM HMAC-SHA1, WhatsApp `X-Hub-Signature-256`, MAX `X-Max-Bot-Api-Secret`.

## Incoming flow

1. Provider webhook/update приходит в adapter; проверяется подпись до разбора бизнес-данных.
2. Adapter строит `NormalizedMessage` со стабильными provider account/chat/message IDs.
3. `webhook_events` атомарно резервирует ключ `{provider,account,conversation,message}`. Конфликт с complete/processing — HTTP 200 без повторной отправки. Failed может быть зарезервирован повторно.
4. Per-conversation serial executor сохраняет порядок, но разные диалоги обрабатываются параллельно.
5. Router находит `conversation_mappings`, выбирает `scope_id`, формирует amojo `new_message`. Для первой коммуникации amoCRM создаёт чат/contact/unsorted; для заранее известного contact выполняется отдельный create-chat + REST link flow только в разрешённом тестовом/production deployment.
6. Ответ amojo (`conversation_id`, `msgid`, `ref_id`) сохраняется вместе с provider IDs. Только после этого inbox-event помечается complete.
7. Несколько вложений разбиваются на упорядоченные message parts с deterministic suffix и общим provider media-group metadata.

## Outgoing flow

1. Менеджер пишет в стандартном интерфейсе amoCRM.
2. amoCRM отправляет webhook v2 на URL канала (`:scope_id`). Raw-body signature проверяется constant-time.
3. `message.message.id` — idempotency key. По `conversation.id` находится provider/account/chat.
4. Router сериализует отправку для диалога и вызывает нужный adapter. Adapter возвращает provider message ID.
5. Mapping сохраняется; amojo получает delivery status. Поздние provider webhooks обновляют delivered/read/failed. Status reducer должен быть монотонным (`sent < delivered < read`; `failed` хранится отдельно), потому что WhatsApp предупреждает о возможном нарушении порядка status webhooks.
6. При «Написать первым» mapping создаётся из amo conversation reference и receiver phone; первый ответ клиента связывает external `conversation_id` через `conversation_ref_id`.

## Таблицы

- `messenger_accounts`: provider, external account ID, display label, opaque `credential_ref`, connection state. Секретов в таблице mapping нет; `credential_ref` указывает на KMS/Vault record.
- `conversation_mappings`: messenger account/chat ↔ amo conversation/contact/lead/scope; уникальность provider tuple и amo conversation UUID.
- `message_mappings`: оба message IDs, direction, status и timestamps; уникальность provider message tuple и amo message ID.
- `webhook_events`: provider event ID, payload hash, state, attempts, last error and timestamps. Это inbox/dedup barrier.

Миграция: `migrations/001_initial.sql`.

## Надёжность

- Idempotency действует до side effect; provider IDs и amo `msgid` должны быть детерминированными.
- В прототипе есть in-process keyed ordering и retry с exponential backoff. Production deployment должен заменить это на durable queue/outbox (например, PostgreSQL `FOR UPDATE SKIP LOCKED`) и lease/reaper для зависших `processing` events.
- Webhook endpoint желательно быстро сохраняет inbox и отвечает 200; тяжёлая обработка выполняется worker. Текущий synchronous handler достаточен для локального прототипа, но не для production SLA.
- Ошибки 429/5xx retry; постоянные 4xx переходят в dead-letter/reconnect state. Retry имеет jitter и honours `Retry-After` в production worker.
- Adapter supervisor выполняет heartbeat, exponential reconnect и circuit breaker на account. Один сломанный account не останавливает другие.
- Media скачивается потоково, с allowlist HTTPS, лимитом размера/type, malware scan, checksum и короткоживущим object-storage URL. Никогда не проксировать произвольный URL без SSRF-защиты.

## Безопасность

- `AMOCRM_READ_ONLY` по умолчанию true. Guard блокирует любой метод кроме GET **до** транспорта для REST и Chats clients. Отключать только в отдельном тестовом amoCRM environment.
- Production credentials из текущего `.env` используются только REST GET. Chats credentials — отдельные переменные.
- Telegram session шифруется AES-256-GCM; master key вне БД. WhatsApp/MAX tokens — KMS/Vault. Ротация без deploy.
- Structured logger редактирует authorization, token, secret, session, password и login code. Raw payload не логировать по умолчанию; PII — hash/last digits only.
- Webhooks проверяются по exact raw bytes; replay дополнительно ограничивается inbox ID и timestamp where provider supplies it.
- Endpoint rate limits, max body size, TLS, dependency timeouts, egress allowlist and audit log обязательны до production.

## Deployment stages

1. Local/mocks: clients, mappings, router, signature and safety tests.
2. Telegram Test DC; Meta test number; moderated MAX test bot; отдельный trial amoCRM.
3. Получить channel credentials у amoCRM и выполнить connect только в trial account.
4. E2E matrix: text/media, duplicates, ordering, 429/5xx, restart, reconnect, 2FA, 24-hour window/template, read/error status.
5. Security/load review, durable queue/object storage/KMS, затем отдельное согласованное включение production write mode.
