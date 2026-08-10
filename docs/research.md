# Исследование amoCRM ↔ Telegram / WhatsApp / MAX

Актуальность проверки: 10 августа 2026 года. Использовались только официальные технические документы и публичные материалы; внутренние запросы интерфейсов и недокументированные протоколы не исследовались.

## amoCRM: REST API и Chats API — разные контуры

Обычный REST API работает на домене аккаунта (`https://{subdomain}.amocrm.ru/api/v4/...`) и использует OAuth 2.0 Bearer access token. Через него управляют контактами, сделками, источниками и связью чата с контактом. Access token живёт ограниченное время, refresh token ротируется; секреты нужно хранить server-side. Источники доступны только интеграции, которая их создала, и для полноценной работы с Sources API требуется архив виджета.

Chats API работает на `https://amojo.amocrm.ru` (для `.amocrm.com` — `amojo.amocrm.com`) и **не использует OAuth access token**. Канал регистрирует поддержка amoCRM. Она выдаёт `channel_id`, `channel_secret` и данные bot participant. Для регистрации запрашиваются код/название, SVG, webhook вида `https://host/path/:scope_id`, поддерживаемые возможности и идентификатор интеграции. Сначала канал приватный; срок рассмотрения, заявленный документацией, 1–3 рабочих дня.

Каждый запрос Chats API содержит `Date`, `Content-Type: application/json`, `Content-MD5` и `X-Signature`. Подписывается строка:

```text
UPPERCASE_METHOD + "\n" + md5(raw_body) + "\n" + content_type + "\n" + date + "\n" + path_without_query
```

Итог — lowercase HMAC-SHA1 с `channel_secret`. Подпись действительна 15 минут. Даже GET требует MD5 пустого тела. Секрет нельзя использовать в frontend-коде.

Официальный жизненный цикл:

1. Получить `amojo_id` аккаунта: `GET /api/v4/account?with=amojo_id` через REST API.
2. После каждой установки интеграции вызвать `POST /v2/origin/custom/{channel_id}/connect` с `account_id`, `hook_api_version: "v2"`; получить `scope_id`. При отключении интеграции канал отключается автоматически.
3. Входящее сообщение: `POST /v2/origin/custom/{scope_id}` с `event_type: new_message`, стабильными внешними `msgid` и `conversation_id`, sender, message и временем. Если чат ещё не существует, он создаётся. Базовый flow создаёт контакт и неразобранную сделку.
4. Для заранее существующего контакта: создать чат через `POST /v2/origin/custom/{scope_id}/chats`, затем связать возвращённый amoCRM chat UUID с контактом через REST `POST /api/v4/contacts/chats`. Один чат связан максимум с одним контактом; у контакта может быть несколько чатов. Связь с нужной сделкой получается через контакт и CRM-модель; собственная таблица хранит `amo_lead_id` для маршрутизации.
5. Ответ менеджера приходит на зарегистрированный webhook v2. В нём есть `account_id`, conversation `{id, client_id?}`, source, sender, receiver и message `{id,type,text,media,...}`. При «Написать первым» `conversation.client_id` первоначально отсутствует; при первом ответе клиента нужно передать вместе `conversation_id` интеграции и `conversation_ref_id` amoCRM.
6. После отправки в мессенджер обновить amoCRM: `POST /v2/origin/custom/{scope_id}/{msgid}/delivery_status`. Коды: delivered `1`, read `2`, error `-1`; ошибки 901–905. Начальное «отправлено» не требует enum.
7. История: `GET /v2/origin/custom/{scope_id}/chats/{conversation_id}/history`, только для чатов, созданных данным каналом. Поддерживаются импорт с `silent`, редактирование, typing, реакции, цитирование и comments в пределах объявленных при регистрации возможностей.
8. Вложения в webhook v2: `file`, `video`, `picture`, `voice`, `audio`, `sticker`; URL media должен быть доступен интеграции. Несколько вложений из amoCRM приходят отдельными webhook с общим `media_group_id`. Входные сообщения содержат одну message-сущность; несколько media нормализуются в упорядоченную группу сообщений.
9. Для нескольких messenger-аккаунтов используются Sources API и `source.external_id`; один Chats-канал поддерживает несколько источников. В документации возможностей указано до 50 источников на аккаунт, а текущая страница Sources API говорит до 100 активных источников — это расхождение нужно подтвердить у поддержки при регистрации.

Основные источники: [старт Chats API](https://www.amocrm.ru/developers/content/chats/chat-start), [методы Chats API](https://www.amocrm.ru/developers/content/chats/chat-api-reference), [webhook v2](https://www.amocrm.ru/developers/content/chats/chat-webhooks), [возможности чатов](https://www.amocrm.ru/developers/content/chats/chat-capabilities), [контакты и связь с чатами](https://www.amocrm.ru/developers/content/crm_platform/contacts-api), [Sources API](https://www.amocrm.ru/developers/content/crm_platform/sources-api), [OAuth 2.0](https://www.amocrm.ru/developers/content/oauth/oauth).

## Telegram: обычный пользовательский аккаунт

Telegram официально предоставляет MTProto API для сторонних клиентов. Это не Bot API. Приложению нужны `api_id` и `api_hash` с `my.telegram.org`; после входа auth key связывается с пользователем.

Поддерживаемые официальным протоколом сценарии: код входа, QR login token, 2FA через SRP, updates, отправка сообщений и файлов. Для тестов Telegram рекомендует Test DC и выделенные тестовые номера, чтобы не получить FLOOD-ограничения. Секретные чаты привязаны к устройству и не входят в обычный cloud-chat flow — их не следует обещать в CRM-интеграции.

Выбран `teleproto`: поддерживаемый TypeScript MTProto client и совместимый преемник архивированного GramJS. Runtime реализует несколько account-specific клиентов, onboarding с кодом и 2FA, AES-256-GCM session storage, updates, text/media send, health и reconnect supervisor. Риск: библиотека сторонняя, поэтому перед production обязательны нагрузочный soak-test, фиксация версии и E2E на Telegram Test DC. Более тяжёлая официальная альтернатива — TDLib: она сама обеспечивает сеть, локальное хранилище, порядок updates и reconnect, но требует нативного runtime/binding.

Session — фактически credential полного доступа. В проекте есть AES-256-GCM envelope encryption; master key должен находиться в KMS/secret manager, а не рядом с ciphertext. Один adapter instance и отдельная session на один аккаунт; logout/revocation переводят канал в reconnect-required.

Источники: [Telegram user authorization](https://core.telegram.org/api/auth), [2FA/SRP](https://core.telegram.org/api/srp), [TDLib](https://core.telegram.org/tdlib), [TDLib getting started](https://core.telegram.org/tdlib/getting-started), [teleproto repository](https://github.com/sanyok12345/teleproto).

## WhatsApp

Целевой transport — обычный WhatsApp Personal через «Связанные устройства». Официальное приложение поддерживает QR-привязку WhatsApp Web/Desktop, однако Meta не публикует API/SDK, позволяющий стороннему серверу зарегистрироваться linked device, хранить его cryptographic session, получать updates или отправлять сообщения.

Wazzup, Umnico, ChatApp и аналогичные сервисы публично показывают QR onboarding и reconnect. Wazzup отдельно документирует `whatsapp` channel, QR webhook и pairing code, но наружу предоставляет только собственный Partner API и не раскрывает WhatsApp-side cryptographic/network contract. Их техническая реализация является собственным транспортом сервиса либо закрытым соглашением; использовать их как посредника нельзя. Библиотеки Baileys, whatsapp-web.js и аналоги воспроизводят недокументированный WhatsApp Web protocol и поэтому исключены условиями проекта.

Cloud API/WABA удалён из runtime и Definition of Done: это другой продукт. До письменного разрешения Meta и документированного first-party Linked Devices API/SDK создание WhatsApp account и runtime activation работают fail-closed. Условия WhatsApp запрещают неразрешённый автоматизированный доступ, reverse engineering и создание сторонних API с эквивалентной функциональностью.

Источники: [WhatsApp: linking a device](https://faq.whatsapp.com/1317564962315842/), [WhatsApp Terms of Service](https://www.whatsapp.com/legal/terms-of-service), [публичный channel contract Wazzup](https://wazzup24.ru/help/api/channels/). Статус: **WHATSAPP PERSONAL: BLOCKED — FIRST-PARTY LINKED DEVICES API/SDK NOT AVAILABLE**.

## MAX

На 10 августа 2026 публичная документация MAX описывает Bot API, мини-приложения/Bridge и бизнес-платформу. Эти API не дают linked-device доступа к переписке обычного личного аккаунта и потому не относятся к целевому MAX Personal.

Официального публичного API для чтения/отправки от имени **личного аккаунта MAX**, third-party QR-login или документированного linked-device SDK не найдено. Wazzup и ChatApp публично показывают «Профиль → Устройства → Войти по QR-коду», несколько personal номеров и 2FA; ChatApp заявляет официальный API. Однако публичный технический контракт, credential names и процедура выдачи linked-device API отсутствуют. Официальная форма «Стать партнёром» описывает партнёрство вокруг ботов/мини-приложений и не обещает personal messaging access. Сторонние transport API (Wazzup, ChatApp, GREEN-API, API-MAX и аналоги) сознательно не используются: это не собственная интеграция. Фиктивный partner-client удалён, создание MAX account и runtime activation закрыты fail-closed. Статус: **MAX PERSONAL: BLOCKED — FIRST-PARTY API/SDK NOT AVAILABLE**.

Запрос доступа: зарегистрировать и верифицировать профиль российского юрлица/ИП/самозанятого на `business.max.ru`, открыть «Интеграции → Подключить → Стать партнёром», подать сведения о сервисе, SVG-логотипы, сайт и контакт. В заявке отдельно запросить именно documented Personal linked-device/QR API или SDK (не bot token): sandbox, client authentication, QR/2FA callbacks, encrypted session format/rotation/revocation, updates/history, send/media/status contracts, rate limits и условия обработки персональных данных. Если MAX отвечает только предложением Bot API, целевой MAX Personal остаётся заблокирован.

Источники: [MAX API overview](https://dev.max.ru/docs-api), [создание и модерация бота](https://dev.max.ru/docs/chatbots/bots-create/create), [webhook subscription и retry](https://dev.max.ru/docs-api/methods/POST/subscriptions), [отправка сообщений](https://dev.max.ru/docs-api/methods/POST/messages), [загрузка media](https://dev.max.ru/docs-api/methods/POST/uploads), [партнёрские интеграции](https://dev.max.ru/docs/partners-integration), [публичная инструкция Wazzup по personal MAX linked-device](https://wazzup24.ru/help/how-to-configurate/kak-podkljuchit-max-k-wazzup/).

## Production amoCRM audit

После успешных unit tests safety layer выполнен ровно один запрос:

```text
GET {AMOCRM_BASE_URL}/api/v4/account?with=amojo_id
```

Получены только технические признаки: account id, subdomain, country/currency и наличие строкового `amojo_id`. Контакты, сделки, пользователи, чаты, сообщения и персональные данные не запрашивались. Write-запросов не было. Значение `amojo_id` и access token не выводились и не сохранялись.
