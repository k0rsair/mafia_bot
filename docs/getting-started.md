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
2. Скопируйте токен в `BOT_TOKEN`; не коммитьте и не логируйте его.
3. Отключите **Privacy Mode**, затем добавьте бота в игровую группу. Команды с упоминанием бота работают и с Privacy Mode, но выключенный режим даёт полный контекст группы.
4. Убедитесь, что бот может отправлять сообщения и inline-кнопки в группе.

Ephemeral-панели используют `receiver_user_id` и `callback_query_id` метода [`sendMessage`](https://core.telegram.org/bots/api#sendmessage). Игрокам не нужно начинать личный чат с ботом.

## Установка и миграция

```bash
npm install
cp .env.example .env
```

В `.env` укажите фактический токен от BotFather и PostgreSQL URL. Затем примените миграции и запустите бот:

```bash
npx prisma migrate deploy
npm run dev
```

Для production:

```bash
npm run build
npm start
```

Запуск пишет только технические сведения (например, `botId`, `botUsername`, уровень логирования). В них не должно быть токена, роли, цели или результата проверки.

## Переменные окружения

| Переменная | По умолчанию | Назначение |
|---|---:|---|
| `BOT_TOKEN` | — | Токен BotFather, обязателен |
| `BOT_USERNAME` | — | Username бота, оканчивается на `bot` |
| `DATABASE_URL` | — | PostgreSQL connection URL |
| `LOG_LEVEL` | `debug` | Для production используйте `info` или `warn` |
| `LOBBY_MAX_PLAYERS` | `15` | Верхняя граница лобби, не больше 15; начать новую игру можно только с 9–15 игроками |
| `ROLE_CONFIRMATION_DURATION_SECONDS` | `300` | Время подтверждения ролей |
| `NIGHT_DURATION_SECONDS` | `120` | Длительность этапа Шлюхи и обычной ночи |
| `DAY_DURATION_SECONDS` | `180` | Длительность дневного обсуждения |
| `VOTE_DURATION_SECONDS` | `90` | Длительность номинаций, основного голосования, ревота и финального выбора |
| `TIE_DISCUSSION_DURATION_SECONDS` | `30` | Обсуждение первой ничьей, не меньше 30 секунд |
| `TEST_GAME_ENABLED` | `false` | Включает development-команду `/testgame`; никогда не включайте в production-группе |

Для интеграционных тестов отдельно задайте `TEST_DATABASE_URL` на изолированную PostgreSQL-базу с применёнными миграциями, затем выполните `npm run test:integration`.

Для ручного прогона включите `TEST_GAME_ENABLED=true` только в тестовом `.env`, перезапустите бот и вызовите `/testgame` в пустой тестовой группе. Команда создаст одного реального игрока и восемь виртуальных, автоматически подтвердит роли виртуальных игроков и будет автоматически выполнять их допустимые ночные действия и голоса. Организатор остаётся ручным игроком.

## Полезные команды

```bash
npx prisma validate
npx prisma generate
npm run lint
npm run typecheck
npm test
npm run build
npm run test:integration
```

## See also

- [Правила и UX игры](game-rules.md) — роли, фазы, публичный городской день и личные панели.
- [Ручная приёмка](manual-acceptance-checklist.md) — проверка группы перед запуском.
