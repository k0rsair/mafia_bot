[Back to README](../README.md) · [Правила и UX игры →](game-rules.md)

# Первый запуск

## Требования

| Компонент | Требование |
|---|---|
| Runtime | Node.js 20 или новее |
| База данных | PostgreSQL 14 или новее |
| Telegram | Бот в группе или супергруппе |
| Private UI | Bot API 10.2 и актуальный Telegram-клиент с поддержкой ephemeral-сообщений |

## Настройка BotFather

1. В [@BotFather](https://t.me/BotFather) создайте бота командой `/newbot`.
2. Скопируйте токен в `BOT_TOKEN`; токен нельзя коммитить или записывать в логи.
3. В настройках BotFather отключите **Privacy Mode** для бота, затем добавьте его в игровую группу. Команды, адресованные боту, работают и с Privacy Mode, но отключение даёт боту полный групповой контекст.
4. Убедитесь, что бот может отправлять сообщения и использовать inline-кнопки в группе.

Ephemeral-панели используют параметры `receiver_user_id` и `callback_query_id` метода [`sendMessage`](https://core.telegram.org/bots/api#sendmessage). Пользователям не нужно начинать личный чат с ботом.

## Установка

```bash
npm install
cp .env.example .env
```

Откройте `.env`, вставьте фактический токен от BotFather и укажите адрес PostgreSQL. Затем примените миграцию и запустите бота:

```bash
npx prisma migrate deploy
npm run dev
```

Команда `npm run dev` читает `.env` автоматически. Для production:

```bash
npm run build
npm start
```

Ожидаемая запись запуска содержит только технические данные: `botId`, `botUsername` и уровень логирования. Она не должна содержать токен, роли или ночные цели.

## Переменные окружения

| Переменная | По умолчанию | Назначение |
|---|---:|---|
| `BOT_TOKEN` | — | Токен BotFather, обязателен |
| `BOT_USERNAME` | — | Username бота, оканчивается на `bot` |
| `DATABASE_URL` | — | PostgreSQL connection URL |
| `LOG_LEVEL` | `debug` | Для production используйте `info` или `warn` |
| `LOBBY_MAX_PLAYERS` | `20` | Верхняя граница лобби, не больше 20 |
| `ROLE_CONFIRMATION_DURATION_SECONDS` | `300` | Время подтверждения ролей |
| `NIGHT_DURATION_SECONDS` | `120` | Длительность ночи |
| `DAY_DURATION_SECONDS` | `180` | Длительность обсуждения |
| `VOTE_DURATION_SECONDS` | `90` | Длительность дневного голосования |

Для интеграционных тестов отдельно задайте `TEST_DATABASE_URL` на изолированную PostgreSQL-базу с применёнными миграциями, затем выполните `npm run test:integration`.

## Полезные команды

```bash
npm run lint
npm run typecheck
npm test
npm run test:integration
npm run check
```

## See Also

- [Правила и UX игры](game-rules.md) — как устроены роли, фазы и приватные панели.
- [Ручная приёмка](manual-acceptance-checklist.md) — проверка реальной группы перед запуском.
