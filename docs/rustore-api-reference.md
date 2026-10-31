# RuStore API — загрузка и публикация приложений (конспект официальной документации)

Источник: `https://www.rustore.ru/help/work-with-rustore-api/api-upload-publication-app/...`.
Прямой доступ к сайту в момент сбора был закрыт VK-антиботом (страница «Ошибка 429»), поэтому текст
взят из снапшотов Wayback Machine (`/web/<ts>id_/`) и сконвертирован из HTML в текст без правок.
Дата снапшота указана у каждой страницы. Всё, что не подтверждено текстом страницы, вынесено в
раздел «Пробелы» — домыслов в основном тексте нет.

---

## 1. Общие сведения

| Что | Значение |
|---|---|
| Хост публикационного API | `https://public-api.rustore.ru` |
| Префикс путей | `/public/v1/application` |
| Хост авторизации | `https://public-api-m.rustore.ru` |
| Заголовок доступа | `Public-Token: <JWE>` — во всех методах, тип `string`, обязателен, расположение `header` |
| Content-Type | `application/json` (создание/настройки/публикация), `multipart/form-data` (файлы) |

### Формат ответа (по странице «Создание черновика версии»)

| Поле | Тип | Обязательно | Описание |
|---|---|---|---|
| `code` | string | да | Код ответа. |
| `error` | — | — | Признак ошибки; при успехе — `OK`. |
| `message` | string | нет | Расшифровка кода ответа. |
| `timestamp` | timestamptz | да | Время ответа, пример `2022-07-08T13:24:41.8328711+03:00`. |
| `content{}` | object | да | Тело ответа метода. |

Вложенный объект `content{}` в ответе на создание черновика содержит `versionId` (`number`, да) —
идентификатор созданной версии, пример `243242`.

> Замечание: в задании поле тела называлось `body`. В скачанных страницах контейнер называется
> `content{}` — см. «Пробелы», п. 4.

### Типовые ошибки

Явного перечня кодов ошибок на добытых страницах нет. Документированы только предметные
ограничения, при нарушении которых метод возвращает ошибку (перечислены в описании методов ниже).

---

## 2. Авторизация

Источник: `work-with-rustore-api__api-authorization-token.txt` (получение токена), см. также
`api-authorization-process`.

### 2.1 Получение токена

```
POST https://public-api-m.rustore.ru/public/auth/
Content-Type: application/json
```

| Параметр | Тип | Обязателен | Расположение | Описание |
|---|---|---|---|---|
| `keyId` | string | да | body | Идентификатор ключа из RuStore Консоли. |
| `timestamp` | string | да | body | Текущее время; от него считается срок действия подписи. |
| `signature` | string | да | body | RSA-подпись SHA-512 hash от строки, содержащей `keyId` + `timestamp`. |

Алгоритм подписи по документации: `SHA512withRSA`.

Порядок формирования `signature`:

1. взять `keyId` и `timestamp`, склеить в строку `keyId + timestamp`;
2. вычислить хэш SHA-512 от этой строки;
3. подписать хэш приватным ключом (RSA, PKCS#1 v1.5, SHA-512);
4. закодировать подпись в Base64 — это и есть `signature`.

Приватный ключ выгружается из RuStore Консоли в Base64 (PKCS#8); в примерах на Java он
разбирается через `PKCS8EncodedKeySpec` после `Base64.decode`.

Ограничение: сформированный `signature` действует 1 минуту, так как напрямую зависит от
`timestamp`.

Пример тела запроса (из документации):

```json
{
  "keyId": "1275328",
  "timestamp": "<unix-время>",
  "signature": "U4kh.......nFkbuw=="
}
```

### 2.2 Ответ

| Поле | Тип | Обязательно | Описание |
|---|---|---|---|
| `jwe` | string | да | Токен доступа (JWE). |
| `ttl` | number | да | Срок жизни токена в секундах. **900 секунд.** |

```json
{
  "jwe": "eyJlbmMiOiJBM......nuuM227D_O1A",
  "ttl": 900
}
```

Далее `jwe` передаётся в заголовке `Public-Token` всех методов публикационного API.

---

## 3. Методы публикационного API

### 3.1 Создание черновика версии

Снапшот: 2024-02-27. Файл: `pub__create-draft-version.txt`.

```
POST https://public-api.rustore.ru/public/v1/application/{packageName}/version
Content-Type: application/json
Public-Token: {token}
```

Назначение: создать черновик версии и заполнить его основной информацией.

| Параметр | Тип | Обязателен | Расположение | Описание / ограничения |
|---|---|---|---|---|
| `Public-Token` | string | да | header | Токен доступа к Public API RuStore. |
| `packageName` | string | да | path | Наименование пакета приложения, пример `com.myapp.example`. |
| `appName` | string | нет | body | Наименование версии приложения, пример «Моё приложение». |
| `appType` | string | нет | body | Тип версии: `GAMES` — для игр; `MAIN` — для неигровых приложений. Передаваемые категории должны быть уникальны в рамках одного запроса. |
| `categories` | string | нет | body | Категории версии. Максимум 2 значения, пример `"health", "news"`. |
| `ageLegal` | string | нет | body | Возрастная категория: `18+`, `16+`, `12+`, `7+`, `3+`. |
| `shortDescription` | string | нет | body | Краткое описание версии, максимальная длина — 80 символов. |
| `fullDescription` | string | нет | body | Полное описание версии, максимальная длина — 4 000 символов. |
| `whatsNew` | string | нет | body | Описание «Что нового», максимальная длина — 500 символов. |
| `moderInfo` | string | нет | body | Комментарий разработчика для модератора, максимальная длина — 180 символов. |
| `priceValue` | string | нет | body | Стоимость в минимальных единицах валюты (копейках): «87.99 руб.» = 8799. Должна быть > 0. |
| `publishType` | string | нет | body | Тип публикации: `INSTANTLY` (автоматически), `DELAYED` (отложенно), `MANUAL` (вручную). |
| `publishDateTime` | string | нет | body | Дата/время отложенной публикации (используется с `publishType = DELAYED`). |
| `partialValue` | number | нет | body | Процент для частичной публикации приложения. |

Ограничения метода (дословно по странице):

- для одного приложения можно создать только один черновик; попытка создания нескольких черновиков вызовет ошибку;
- черновики, отправленные по API, не отображаются в веб-версии консоли разработчика; они станут доступны после отправки APK на модерацию и при изменении статуса версии приложения;
- создание черновика возможно только при наличии активной версии приложения;
- отсутствующие данные в полях черновика будут взяты из активной версии приложения;
- черновик должен соответствовать типу приложения — бесплатное или платное; при отправке платной версии для бесплатного приложения черновик будет обрабатываться как бесплатный;
- для каждого типа версии приложения (`appType`) есть соответствующие категории версии; при несоответствии категории при попытке загрузки приложения будет показана ошибка;
- частичная публикация приложения возможна только при автоматическом (`INSTANTLY`) или ручном (`MANUAL`) типе публикации (параметр `publishType`).

Ответ: `code`, `error`/`OK`, `message`, `timestamp`, `content{ versionId }`.

Пример запроса (из документации): `curl --location --request POST 'https://public-api.rustore.ru/public/v1/application/com.package.com/version'` с заголовками `Content-Type: application/json`, `Public-Token: {YOURtoken}` и телом `{ "appName": "Приложение для RuStore", "appType": "MAIN", ... }`.

### 3.2 Загрузка APK

Снапшот: 2026-02-07. Файл: `pub__file-upload-apk.txt`.

```
POST https://public-api.rustore.ru/public/v1/application/{packageName}/version/{versionId}/apk?isMainApk={isMainApk}&servicesType={servicesType}
Content-Type: multipart/form-data
Public-Token: {token}
```

| Параметр | Тип | Обязателен | Расположение | Описание |
|---|---|---|---|---|
| `Public-Token` | string | да | header | Токен доступа к Public API RuStore. |
| `packageName` | string | да | path | Имя пакета приложения. |
| `versionId` | number | да | path | Версия приложения. |
| `isMainApk` | boolean | да | query | `true` — основной APK, `false` — дополнительный. |
| `servicesType` | string | да | query | Тип сервисов; в примере — `Unknown`. |
| `file` | multipart | да | body | Файл в виде двоичного кода. |

Ответ: `code` (string, да) — код ответа; `error`; `message` (string, нет) — расшифровка кода ответа,
возможные варианты детализации ошибки; `timestamp`.

Пример: `curl --location --request POST 'https://public-api.rustore.ru/public/v1/application/com.package.example/version/123/apk?servicesType=Unknown&isMainApk=true'`.

### 3.3 Загрузка AAB

Снапшот: 2025-01-17. Файл: `pub__file-upload-aab.txt`.

```
POST https://public-api.rustore.ru/public/v1/application/{packageName}/version/{versionId}/aab
Content-Type: multipart/form-data
Public-Token: {token}
```

| Параметр | Тип | Обязателен | Расположение | Описание |
|---|---|---|---|---|
| `Public-Token` | string | да | header | Токен доступа к Public API RuStore. |
| `packageName` | string | да | path | Имя пакета приложения. |
| `versionId` | number | да | path | Версия приложения. |
| `file` | multipart | да | body | Файл в виде двоичного кода. |

Ответ: `code`, `error`, `message`, `timestamp`.

Пример: `curl --location --request POST 'https://public-api.rustore.ru/public/v1/application/com.package.example/version/123/aab'`.

### 3.4 Загрузка иконки приложения

Снапшот: 2025-01-13. Файл: `pub__apk-icon-upload.txt`.

```
POST https://public-api.rustore.ru/public/v1/application/{packageName}/version/{versionId}/image/icon
Content-Type: multipart/form-data
Public-Token: {token}
```

| Параметр | Тип | Обязателен | Расположение | Описание |
|---|---|---|---|---|
| `Public-Token` | string | да | header | Токен доступа к Public API RuStore. |
| `packageName` | number | да | path | Идентификатор приложения. |
| `versionId` | number | да | path | Версия приложения. |
| `file` | multipart | да | body | Изображение иконки. |

Ограничение: размеры загружаемого изображения — 512×512 px.

Ответ: `code`, `error`, `message`, `timestamp`.

Пример: `curl --location --request POST 'https://public-api.rustore.ru/public/v1/application/com.package.example/version/123/image/icon'`.

### 3.5 Загрузка скриншотов

Снапшот: 2025-08-14. Файл: `pub__apk-screens-upload.txt`.

```
POST https://public-api.rustore.ru/public/v1/application/{packageName}/version/{versionId}/image/screenshot/{orientation}/{ordinal}
Content-Type: multipart/form-data
Public-Token: {token}
```

| Параметр | Тип | Обязателен | Расположение | Описание |
|---|---|---|---|---|
| `Public-Token` | string | да | header | Токен доступа к Public API RuStore. |
| `packageName` | number | да | path | Идентификатор приложения. |
| `versionId` | number | да | path | Версия приложения. |
| `orientation` | string | да | path | Ориентация изображения: `LANDSCAPE`, `PORTRAIT`. |
| `ordinal` | number | да | path | Порядковый номер скриншота. |
| `file` | multipart | да | body | Файл изображения. |

Ответ: `code`, `error`, `message`, `timestamp`.

Пример: `curl --location --request POST 'https://public-api.rustore.ru/public/v1/application/com.package.example/version/123/image/screenshot/landscape/1'`.

### 3.6 Изменение настроек публикации

Снапшот: 2025-12-08. Файл: `pub__publishing-change-settings.txt`.

```
POST https://public-api.rustore.ru/public/v1/application/{packageName}/version/{versionId}/publish-settings
Content-Type: application/json
Public-Token: {token}
```

| Параметр | Тип | Обязателен | Расположение | Описание |
|---|---|---|---|---|
| `Public-Token` | string | да | header | Токен доступа к Public API RuStore. |
| `packageName` | string | да | path | Имя пакета приложения. |
| `versionId` | number | да | path | Версия приложения. |
| `publishType` | string | нет | body | Тип публикации: `MANUAL`, `INSTANTLY`, `DELAYED`. |
| `publishDateTime` | string | нет | body | Дата/время публикации для `DELAYED`. |
| `partialValue` | number | нет | body | Процент для частичной публикации приложения. |

Ответ: `code`, `error`, `message`, `timestamp`.

Пример: `curl --location 'https://public-api.rustore.ru/public/v1/application/com.example.pblsh_v2/version/704372/publish-settings'`.

### 3.7 Архивирование версии приложения

Снапшот: 2025-05-01. Файл: `pub__archivate-version.txt`.

```
POST https://public-api.rustore.ru/public/v1/application/{packageName}/version/{versionId}/archive
Public-Token: {token}
```

| Параметр | Тип | Обязателен | Расположение | Описание |
|---|---|---|---|---|
| `Public-Token` | string | да | header | Токен доступа к API RuStore. |
| `packageName` | string | да | path | Имя пакета приложения. |
| `versionId` | number | да | path | Идентификатор версии приложения, которую нужно архивировать. |

Ответ: `code` (string, да) — код ответа; `message` (string, нет) — расшифровка кода ответа;
`body`/`content` — объект (по странице: «всегда …»; тип `object`, необязателен); `timestamp`.

Пример: `curl --location --request POST 'https://public-api.rustore.ru/public/v1/application/com.package.example/version/243242/archive'`.

### 3.8 Ручная публикация

Снапшот: 2024 (файл `work-with-rustore-api__api-upload-publication-app__manual-publishing.txt`).

```
POST https://public-api.rustore.ru/public/v1/application/{packageName}/version/{versionId}/publish
Public-Token: {token}
```

Назначение: опубликовать версию, прошедшую модерацию, вручную.

Ограничения (дословно):

- опубликовать версию можно только после прохождения модерации;
- опубликовать версию, если тип публикации указан вручную (`MANUAL`).

| Параметр | Тип | Обязателен | Расположение | Описание |
|---|---|---|---|---|
| `Public-Token` | string | да | header | Токен доступа к Public API RuStore. |
| `packageName` | string | да | path | Имя пакета приложения. |
| `versionId` | number | да | path | Версия приложения. |

### 3.9 Получение списка приложений

Файл: `work-with-rustore-api__api-upload-publication-app__get-app-list.txt` (документация содержит
базовый хост `https://public-api.rustore.ru/public/v1/application` и заголовок `Public-Token`).
Детальный разбор параметров пагинации в этом конспекте не приводится — страница добыта, но не
разобрана построчно (см. «Пробелы», п. 1).

---

## 4. Требования к карточке приложения

Источник: `developers__publishing-and-verifying-apps__app-publication.txt` (раздел публикации в
веб-консоли; требования применимы к карточке, которую наполняет API).

**Краткое и полное описание.** Краткое описание — до 80 символов (для мобильных устройств и для
ТВ-версии). Подробное описание — до 4 000 символов, при вёрстке учитывается возможность свернуть
описание до 2 000 символов. Раздел «Что нового?» заполняется отдельно.

**Возрастное ограничение.** Выбирается из предложенного списка (в API — `ageLegal`:
`18+`, `16+`, `12+`, `7+`, `3+`).

**Контакты.** В новых версиях приложения необходимо заполнить контакты разработчика.

**Иконка.** Загружается перетаскиванием; можно добавить отдельную иконку для ТВ-версии, а при
отсутствии отдельной ТВ-иконки используется иконка мобильного приложения. Требование к иконке:
иконка должна иметь фоновое заполнение по всей площади; крайние части должны быть покрыты фоном,
без прозрачных или незаполненных участков по контуру. Для API-метода загрузки иконки указан размер
512×512 px.

**Скриншоты.** Загрузка скриншотов для мобильной версии обязательна. Можно загрузить только
скриншоты для телефона — тогда они показываются на всех типах устройств; можно отдельно для
планшетов (телефонные — на экранах меньше 7 дюймов, планшетные — от 7 дюймов) и для ТВ (вместе с
баннером). Для каждого типа устройств, для которого загружаются скриншоты, нужно **не менее 3
скриншотов**; за один раз добавляется от 1 до 10. Скриншоты загружаются в том порядке, в котором
расположены в папке; при несовпадении пропорций изображение растягивается или обрезается до 16:9.

**ТВ-версия.** Если выбран файл для ТВ, для ТВ-версии обязательны краткое и полное описание,
раздел «Что нового?», иконка и скриншоты — без этих данных версию нельзя отправить на модерацию.

**Видео и FAQ.** Карточка поддерживает видео с VK Видео (плееры для клипов и обычных видео
выбираются автоматически), поле «Фоновое видео для карточки приложения», а также блок «Часто
задаваемые вопросы и ответы (FAQ)», который отображается только в веб-версии карточки.

**Политика конфиденциальности и тестовые доступы.** На добытых страницах отдельного раздела с
требованиями к политике конфиденциальности и тестовым доступам не встретилось (см. «Пробелы», п. 5).

---

## 5. Пробелы (чего в добытом тексте нет)

Страницы, которые достать не удалось: сайт отдавал страницу «Ошибка 429», Wayback — заглушку
«request is being blocked as suspected abusive bot traffic» (606 символов) на всех снапшотах.

1. **Не разобраны построчно:** `get-app-list` (список приложений) — известны только хост
   `https://public-api.rustore.ru/public/v1/application` и заголовок `Public-Token`.
2. **Не добыты полностью** (метод и путь известны из навигации/сторонних источников, но текст
   страницы не получен):
   - `get-version-status` — получение статуса версий приложений;
   - `send-draft-app-for-moderation` — отправка на модерацию черновика версии;
   - `delete-draft` — удаление черновика;
   - `app-category-list` — список категорий приложений (URL найден в архиве:
     `.../api-upload-publication-app/app-category-list`);
   - `editing-the-draft` — изменение черновика (URL найден в архиве:
     `.../api-upload-publication-app/editing-the-draft`);
   - `app-version-detail` — данные о версии (URL найден в архиве).
3. **Обзор группы** `api-upload-publication-app` (корневая страница раздела) — не добыт:
   в архиве только короткие/заблокированные снапшоты.
4. **Имя контейнера тела ответа.** На странице создания черновика контейнер называется `content{}`;
   на странице архивирования — `body`. Единого описания обёртки ответа в документации не найдено;
   в задании упоминалось `body`. Требует проверки по остальным методам.
5. **Нет метода/полей для изменения описания после создания черновика** в добытом тексте: страница
   `editing-the-draft` не получена, поэтому утверждать отсутствие нельзя — вопрос открыт.
6. **Нет перечня кодов ошибок** (HTTP-коды и значения `code`) ни на одной добытой странице,
   кроме предметных ограничений методов.
7. **Не подтверждены** требования к политике конфиденциальности и тестовым доступам для модерации:
   в добытом тексте `app-publication` их нет.
8. **Даты снапшотов различаются** (2024-02 … 2026-02), часть страниц могла устареть; поля
   `minAndroidVersion`, `shortDescription`-лимиты и `servicesType` стоит сверить с живым сайтом.
9. **Поле `appName`**: в таблице параметров указан пример «Моё приложение», но ограничение длины в
   добытом фрагменте читается неоднозначно («Максимальная длина — 5 символов» относится, судя по
   вёрстке, к соседнему полю) — требует проверки.

---

## 6. Источники (локальные копии)

Каталог `.artifacts/rustore-docs/txt/`:

| Файл | Что это |
|---|---|
| `work-with-rustore-api__api-authorization-token.txt` | получение токена: `POST /public/auth/`, `keyId`/`timestamp`/`signature`, `jwe`, `ttl` = 900 |
| `work-with-rustore-api__api-authorization-process.txt` | принципы работы с API |
| `pub__create-draft-version.txt` | создание черновика версии, поля тела |
| `pub__file-upload-apk.txt` | загрузка APK |
| `pub__file-upload-aab.txt` | загрузка AAB |
| `pub__apk-icon-upload.txt` | загрузка иконки (512×512) |
| `pub__apk-screens-upload.txt` | загрузка скриншотов |
| `pub__publishing-change-settings.txt` | изменение настроек публикации |
| `pub__archivate-version.txt` | архивирование версии |
| `work-with-rustore-api__api-upload-publication-app__manual-publishing.txt` | ручная публикация |
| `work-with-rustore-api__api-upload-publication-app__get-app-list.txt` | список приложений |
| `developers__publishing-and-verifying-apps__app-publication.txt` | требования к карточке |
