# Публичное исследование аналогов

Исследованы только продуктовые страницы, базы знаний и публичные API. Закрытый код, traffic inspection и reverse engineering не использовались. Там, где поставщик не раскрывает транспорт, ниже указана только наблюдаемая продуктовая механика, а не предположение о реализации.

## Общий паттерн

Все решения разделяют понятия «интеграция с CRM» и «канал»: канал — конкретный аккаунт/номер мессенджера. Несколько каналов можно дать разным сотрудникам/отделам. Входящее сообщение создаёт или находит контакт/сделку, появляется в карточке, ответ менеджера уходит через выбранный канал. Внешний сервис держит сессии мессенджеров, mapping, media и reconnect, а amoCRM используется как рабочее окно.

Это продуктовый вывод из публичных возможностей, не утверждение о внутренней архитектуре поставщиков.

## Wazzup

- Определяет channel как один аккаунт мессенджера/соцсети; допускает несколько channels одного типа и различает WhatsApp, WABA, Telegram Personal и Telegram Bot.
- Telegram Personal подключается номером/кодом; можно несколько аккаунтов. Re-login требуется при отзыве/выходе из Telegram session.
- Для QR WhatsApp публично виден linked-device сценарий, а WABA вынесен в отдельный официальный тип. Следовательно, QR-вариант и официальный WABA нельзя считать одним способом.
- В amoCRM сообщения создают контакты/сделки и сохраняются в карточке; доступ к каналам и «приоритетный канал» можно назначать сотрудникам.
- Публичная инструкция MAX описывает именно personal linked-device: в приложении MAX пользователь открывает «Профиль → Устройства», сканирует QR Wazzup и после этого канал показывает имя и телефон. Значит Wazzup публично подтверждает personal MAX через QR. Однако протокол/partner contract не опубликован; воспроизводить этот механизм без официального доступа нельзя.
- API Wazzup публикует channel state, что позволяет UI показывать connected/unauthorized/foreignphone и инициировать reconnect.

Источники: [Wazzup в amoMarket](https://www.amocrm.ru/extensions/wazzup), [Telegram Personal setup](https://wazzup24.com/help/how-to-set-up/how-to-connect-telegram-personal/), [channel API](https://wazzup24.com/help/api-en/working-with-channels/), [MAX personal QR setup](https://wazzup24.ru/help/how-to-configurate/kak-podkljuchit-max-k-wazzup/).

## Umnico

- Telegram Personal: номер → Telegram login code; несколько личных аккаунтов и/или ботов; поддержаны фото, документы, audio/video. Выход из session останавливает канал и требует повторной авторизации.
- WhatsApp QR: пользователь сканирует его через «Связанные устройства», то есть публично описан WhatsApp Web/linked-device режим, не Cloud API.
- Отдельно предлагается WABA. В amoCRM менеджер отвечает из карточки; «написать первым» публично заявлено для Telegram Personal и WhatsApp при наличии телефона контакта.
- CRM и messenger accounts подключаются в кабинете Umnico; это позволяет одному агрегатору обслуживать несколько CRM/channel bindings.

Источники: [Telegram + amoCRM](https://umnico.com/ru/help/telegram-amocrm/), [WhatsApp + amoCRM](https://umnico.com/ru/help/whatsapp-amocrm/), [Umnico help center](https://umnico.com/help/).

## ChatApp

- Публично объединяет WhatsApp, Telegram, MAX и другие каналы в amoCRM, обещает единое окно, автоматические лиды и несколько подключений.
- Страница MAX описывает QR в процессе подключения личного кабинета и amoCRM, но формулировка не доказывает, что QR авторизует именно личный MAX-account: это может быть вход/onboarding или bot link. Технический механизм публично не раскрыт.
- Поэтому опыт ChatApp полезен для UX (channel wizard, reconnect indicator, маршрутизация), но не является основанием использовать недокументированный MAX protocol.

Источник: [ChatApp MAX + amoCRM](https://chatapp.online/crm-integrations/amocrm/max-amocrm/).

## Pact

- Позиционирует продукт как омниканальный кабинет, связывает WhatsApp/Telegram и CRM, позволяет менеджеру инициировать диалог по номеру или username и отвечать из карточки.
- Channels подключаются на уровне компании в «Центре настройки»; публично заявлены WhatsApp/WhatsApp Business и Telegram.
- Публичные страницы не дают достаточного технического контракта по session storage, delivery retry или MAX. Эти детали нельзя переносить как факты.

Источники: [Pact + amoCRM](https://pact.im/amocrm), [Pact channels](https://kb.pact.im/article/46319).

## Другие релевантные решения и выводы

Официальная карточка amoCRM для MAX описывает чат-бота, но это другой продукт и он исключён из текущего Definition of Done. Wazzup (`transport=max`) и ChatApp отдельно подтверждают personal linked-device QR; Wazzup отличает его от `maxbot`. Ни один из них не публикует MAX-side контракт. Для WhatsApp зрелые агрегаторы разделяют QR/linked-device и WABA/Cloud API; здесь используется второй. Для Telegram Personal используется полноценная MTProto client session.

Источник: [amoCRM: MAX, неразобранное и источники](https://www.amocrm.ru/support/incoming_leads/max).

## Что берём в свой продукт

- Явный channel/account entity, а не один global token.
- Отдельные состояния `connecting / connected / reconnect_required / disabled / error`.
- Выбор source/account для менеджера и права доступа по сотрудникам.
- Единый normalized message, но сохранение provider IDs без преобразования.
- MAX Bot полностью исключить; MAX Personal включать только после выдачи официального linked-device Partner API/SDK.
- QR/code wizard не должен обещать канал, которого нет в официальном API.
- Media group, delivery/read/error state, retry и idempotency должны быть backend-функциями, а не ответственностью виджета.
