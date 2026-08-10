# amoCRM Messenger Bridge

Безопасный TypeScript-прототип собственной интеграции amoCRM Chats API с Telegram user accounts, WhatsApp Cloud API и официальным MAX Bot API.

## Safety

`AMOCRM_READ_ONLY` по умолчанию равен `true`. Оба amoCRM clients физически блокируют любой метод кроме GET до вызова network transport. Текущий production `.env` не изменяется. Для write/E2E нужен отдельный trial/test аккаунт и явный `AMOCRM_READ_ONLY=false` только в его окружении.

```powershell
npm install
npm test
npm run build
```

## Структура

- `src/amocrm` — раздельные REST и Chats clients.
- `src/adapters` — общий contract и Telegram/WhatsApp/MAX implementations.
- `src/router` — incoming/outgoing routing, ordering, deduplication and retry.
- `src/storage` и `migrations` — mapping repository и PostgreSQL schema.
- `src/webhooks` — authenticated amoCRM/Meta/MAX endpoints.
- `docs` — исследование, аналоги и architecture.

Скопируйте только нужные имена из `.env.example` в secret manager/окружение. Не коммитьте значения. Перед первым запуском примените `migrations/001_initial.sql`. Telegram accounts создаются отдельными `TelegramAdapter` instances после интерактивного onboarding; сохранённую session нужно шифровать через `src/security/session-crypto.ts` и хранить по `credential_ref`.

## Текущие ограничения прототипа

- Нельзя подключить amoCRM Chats без выданных поддержкой `channel_id/channel_secret/bot/webhook` данных.
- WhatsApp template commands, защищённый media proxy/object storage и Embedded Signup ещё не реализованы.
- MAX personal account не реализуется: публичного официального API нет. MAX adapter — только Bot API.
- In-process ordering/retry перед production заменяется durable queue/outbox.
