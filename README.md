# dsh-rustore

**RuStore Publishing API для DeepSeek Harness** — плагин DSH, отдельный MCP-сервер и навык
`rustore` для публикации Android-приложения: черновик версии, загрузка AAB/APK, иконки и
скриншотов, настройки публикации, модерация, ручная публикация, архивирование и удаление черновика.

Плагин регистрирует 22 инструмента `rustore_*`; тот же набор доступен как самостоятельный
MCP-сервер (stdio, без внешних зависимостей) — его можно подключить к Cursor, Claude Desktop,
собственному агенту или в DSH через `@deepseek-ai/dsh-mcp-client`.

## Установка

### Из GitHub (в свой DSH)

```bash
dsh plugin --profile <профиль> add github:YurinKonstantin/dsh-rustore
```

или из локальной копии репозитория:

```bash
git clone https://github.com/YurinKonstantin/dsh-rustore
dsh plugin --profile <профиль> add link:<абсолютный путь к клону>
```

После установки плагин подключается строкой в `cordis.patch.yml` профиля — готовая строка лежит в
[`cordis.patch.yml`](cordis.patch.yml) пакета, её нужно перенести в профиль (так делает менеджер
плагинов при установке bundle).

### Через магазин плагинов DSH

DSH читает индексы магазина, которые добавляет сам пользователь. Индекс этого плагина —
[`market.json`](market.json) в этом репозитории:

```
https://raw.githubusercontent.com/YurinKonstantin/dsh-rustore/main/market.json
```

Добавить: **Settings → Plugins → Discover → Добавить индекс** (или в конфигурации строки
`plugin-market` указать `indexes: [<URL>]`). В индексе версия привязана к конкретному коммиту,
поэтому установка воспроизводима.

## Настройка токена

RuStore не выдаёт долгоживущий токен: JWE живёт **900 секунд** и выпускается из `keyId` +
приватного ключа. Поэтому в настройках плагина хранят ключ, а токен плагин выпускает сам и
обновляет за минуту до истечения.

Ключ: RuStore Консоль → вкладка «Компания» (для физлица — «Разработчик») → **API RuStore** →
«Создать ключ» → отметить приложения и методы публикации → «Сгенерировать ключ» → скопировать
приватный ключ (Base64, показывается один раз). Рядом в таблице — **ID ключа** (`keyId`).

```yaml
- id: rustore
  name: dsh-rustore
  config:
    token: ""                       # необязательно: готовый JWE
    keyId: "354751"                 # ID ключа из консоли
    privateKey: ""                  # Base64; лучше держать в credentials, а не здесь
    privateKeyRef: RUSTORE_PRIVATE_KEY
    apiBase: https://public-api-m.rustore.ru
    mirrorBase: https://public-api.rustore.ru
    authUrl: https://public-api-m.rustore.ru/public/auth/
    timeoutMs: 120000
    settingsFile: ""                # по умолчанию %USERPROFILE%\.dsh\rustore.json
```

Порядок источников: конфигурация плагина → секрет DSH (`RUSTORE_PRIVATE_KEY` в
Settings → credentials) → переменные окружения `RUSTORE_*` → файл `~/.dsh/rustore.json`.
Файл пишет инструмент `rustore_settings_set`, поэтому ключ можно задать прямо из чата.
Секреты в ответах инструментов маскируются.

Проверка: `rustore_settings_get` (режим авторизации) и `rustore_auth_check` (выпуск токена + список
приложений).

## Инструменты

| Инструмент | Что делает |
| --- | --- |
| `rustore_apps_list` | приложения, доступные ключу; поиск, сортировка, пагинация |
| `rustore_app_versions` | версии приложения с фильтром по статусам |
| `rustore_version_info` | детали версии (API v2) |
| `rustore_version_status` | статус версии и причина отклонения |
| `rustore_draft_create` | создать черновик версии с карточкой |
| `rustore_draft_update` | изменить черновик (PATCH v2) |
| `rustore_draft_delete` | удалить черновик (необратимо) |
| `rustore_upload_aab` / `rustore_upload_apk` | загрузить сборку |
| `rustore_upload_icon` | иконка 512×512 |
| `rustore_upload_screens` / `rustore_screens_list` / `rustore_screenshot_delete` | скриншоты (API v2) |
| `rustore_publish_settings` | тип публикации: INSTANTLY / DELAYED / MANUAL |
| `rustore_send_to_moderation` | отправить на модерацию (приоритет 0…5) |
| `rustore_manual_publish` | опубликовать прошедшую модерацию версию вручную |
| `rustore_version_archive` | архивировать версию |
| `rustore_categories_list` | справочник категорий (MAIN/GAMES) |
| `rustore_app_tags` | теги приложения |
| `rustore_settings_get` / `rustore_settings_set` / `rustore_auth_check` | настройки и авторизация |

Порядок публикации, ограничения карточки (80/4000/500/180 символов, 512×512, ≥3 скриншота и т. д.)
и разбор ошибок — в навыке [`skills/rustore/SKILL.md`](skills/rustore/SKILL.md).

## MCP-сервер без DSH

```bash
$env:RUSTORE_KEY_ID = "354751"
$env:RUSTORE_PRIVATE_KEY = "MIIEvgIBADANBgkq..."
node mcp/server.mjs
```

Транспорт — stdio, построчные JSON-RPC сообщения. Подключение в DSH:

```yaml
- id: rustore-mcp
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: rustore
    transport: stdio
    command: node
    args: ['<путь>/dsh-rustore/mcp/server.mjs']
    env:
      RUSTORE_KEY_ID: ''
      RUSTORE_PRIVATE_KEY: ''
    failOnStartupError: true
```

Инструменты появятся как `mcp__rustore__<имя>`.

## Проверка

```bash
node test/core.test.mjs     # авторизация RSA-SHA512, клиент, пути методов
node test/mcp.test.mjs      # протокол MCP: initialize, tools/list, tools/call
node test/plugin.test.mjs   # регистрация инструментов в DSH
```

33 теста, сеть не используется: транспорт подменяется заглушкой.

## Документация RuStore

[`docs/rustore-api-reference.md`](docs/rustore-api-reference.md) — конспект официальной
документации RuStore с параметрами методов, ограничениями полей и адресами эндпоинтов.

## Ограничения

- Publishing API работает с версиями уже существующего приложения: само приложение, контакты
  разработчика, политика конфиденциальности, тестовые доступы и ТВ-иконка задаются в веб-консоли
  RuStore.
- Документация RuStore разносит методы по двум хостам (`public-api.rustore.ru` и
  `public-api-m.rustore.ru`); для чтения клиент автоматически пробует второй при 404.

## Лицензия

MIT — см. [LICENSE](LICENSE).

