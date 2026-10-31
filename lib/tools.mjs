/**
 * Определения инструментов RuStore.
 *
 * Один список обслуживает два адаптера: DSH-плагин (`index.js`) регистрирует
 * их как `rustore_<name>`, standalone MCP-сервер (`mcp/server.mjs`) отдаёт их
 * как `tools/list` и `tools/call`. Схема параметров и обработчик описаны здесь
 * один раз.
 *
 * Эндпоинты взяты из официальной документации RuStore «Загрузка и публикация
 * приложений с помощью API» (см. `docs/rustore-api-reference.md`). Там же
 * зафиксированы ограничения полей карточки.
 *
 * @module dsh-rustore/lib/tools
 */

import { RuStoreError } from './errors.mjs';

/** Путь приложения по имени пакета (v1). */
const app = (packageName) => `/public/v1/application/${encodeURIComponent(packageName)}`;

/** Путь версии (v1). */
const version = (packageName, versionId) => `${app(packageName)}/version/${versionId}`;

/** Путь версии (v2 — детали, редактирование, скриншоты). */
const versionV2 = (packageName, versionId) =>
  `/public/v2/application/${encodeURIComponent(packageName)}/version/${versionId}`;

/**
 * Оставить в объекте только переданные поля.
 *
 * @param {object} source - входные аргументы.
 * @param {string[]} keys - интересующие поля.
 * @returns {object} объект без undefined и пустых строк.
 */
function pick(source, keys) {
  const out = {};
  for (const key of keys) {
    const value = source?.[key];
    if (value === undefined || value === null || value === '') continue;
    out[key] = value;
  }
  return out;
}

/** Поля карточки, которые принимает создание черновика. */
const DRAFT_FIELDS = [
  'appName',
  'appType',
  'categories',
  'ageLegal',
  'shortDescription',
  'fullDescription',
  'whatsNew',
  'moderInfo',
  'priceValue',
  'publishType',
  'publishDateTime',
  'partialValue',
];

/**
 * Категории RuStore: код, название и тип приложения.
 *
 * Статический справочник из документации «Список категорий приложений» —
 * API-метода для него нет.
 */
export const CATEGORIES = [
  { code: 'business', title: 'Бизнес-сервисы', appType: 'MAIN' },
  { code: 'state', title: 'Государственные', appType: 'MAIN' },
  { code: 'foodAndDrink', title: 'Еда и напитки', appType: 'MAIN' },
  { code: 'health', title: 'Здоровье', appType: 'MAIN' },
  { code: 'books', title: 'Книги', appType: 'MAIN' },
  { code: 'news', title: 'Новости и события', appType: 'MAIN' },
  { code: 'lifestyle', title: 'Образ жизни', appType: 'MAIN' },
  { code: 'education', title: 'Образование', appType: 'MAIN' },
  { code: 'social', title: 'Общение', appType: 'MAIN' },
  { code: 'adsAndServices', title: 'Объявления и услуги', appType: 'MAIN' },
  { code: 'pets', title: 'Питомцы', appType: 'MAIN' },
  { code: 'purchases', title: 'Покупки', appType: 'MAIN' },
  { code: 'tools', title: 'Полезные инструменты', appType: 'MAIN' },
  { code: 'travelling', title: 'Путешествия', appType: 'MAIN' },
  { code: 'entertainment', title: 'Развлечения', appType: 'MAIN' },
  { code: 'parenting', title: 'Родителям', appType: 'MAIN' },
  { code: 'sport', title: 'Спорт', appType: 'MAIN' },
  { code: 'gambling', title: 'Ставки и лотереи', appType: 'MAIN' },
  { code: 'transport', title: 'Транспорт и навигация', appType: 'MAIN' },
  { code: 'finance', title: 'Финансы', appType: 'MAIN' },
  { code: 'arcade', title: 'Аркады', appType: 'GAMES' },
  { code: 'quiz', title: 'Викторины', appType: 'GAMES' },
  { code: 'puzzle', title: 'Головоломки', appType: 'GAMES' },
  { code: 'race', title: 'Гонки', appType: 'GAMES' },
  { code: 'children', title: 'Дети', appType: 'GAMES' },
  { code: 'ar', title: 'Игры с AR', appType: 'GAMES' },
  { code: 'indie', title: 'Инди', appType: 'GAMES' },
  { code: 'casino', title: 'Казино', appType: 'GAMES' },
  { code: 'casual', title: 'Казуальные', appType: 'GAMES' },
  { code: 'card', title: 'Карточные', appType: 'GAMES' },
  { code: 'music', title: 'Музыка', appType: 'GAMES' },
  { code: 'board', title: 'Настольные игры', appType: 'GAMES' },
  { code: 'adventure', title: 'Приключения', appType: 'GAMES' },
  { code: 'rolePlaying', title: 'Ролевые', appType: 'GAMES' },
  { code: 'family', title: 'Семейные', appType: 'GAMES' },
  { code: 'simulator', title: 'Симуляторы', appType: 'GAMES' },
  { code: 'word', title: 'Словесные игры', appType: 'GAMES' },
  { code: 'sports', title: 'Спортивные игры', appType: 'GAMES' },
  { code: 'strategy', title: 'Стратегии', appType: 'GAMES' },
  { code: 'action', title: 'Экшен', appType: 'GAMES' },
];

/**
 * Инструмент «список приложений».
 *
 * `GET /public/v1/application`.
 */
const appsList = {
  name: 'apps_list',
  title: 'Список приложений RuStore',
  description:
    'Приложения, доступные ключу RuStore API. Поддерживает поиск по названию и пакету, сортировку и ' +
    'постраничную выдачу через continuationToken. Начинайте с него: видно, существует ли приложение и ' +
    'какие у него версии.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      pagination: { type: 'boolean', description: 'Включить постраничную выдачу (по умолчанию false).' },
      continuationToken: { type: 'string', description: 'Токен следующей страницы из предыдущего ответа.' },
      pageSize: { type: 'integer', description: 'Размер страницы, 1…1000 (по умолчанию 20).', minimum: 1, maximum: 1000 },
      appName: { type: 'string', description: 'Поиск по названию приложения.' },
      appPackage: { type: 'string', description: 'Поиск по имени пакета, например com.example.app.' },
      orderFields: {
        type: 'string',
        description: 'Поле сортировки.',
        enum: ['appId', 'appName', 'appStatus', 'appVerUpdatedAt'],
      },
      sortDirections: { type: 'string', description: 'Направление сортировки.', enum: ['ASC', 'DESC'] },
    },
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  async run(args, context) {
    const client = await context.api();
    return client.request({
      path: '/public/v1/application',
      query: pick(args, ['pagination', 'continuationToken', 'pageSize', 'appName', 'appPackage', 'orderFields', 'sortDirections']),
    });
  },
};

/**
 * Инструмент «список версий приложения».
 *
 * `GET /public/v1/application/{packageName}/version`.
 */
const appVersions = {
  name: 'app_versions',
  title: 'Версии приложения',
  description:
    'Список версий приложения с фильтрацией по статусам (versionStatuses) и по id версии. ' +
    'Статусы: ACTIVE, DRAFT, READY_FOR_PUBLICATION, PUBLISHED, REJECTED_BY_MODERATOR, ARCHIVED и другие ' +
    'значения из ответа API.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['packageName'],
    properties: {
      packageName: { type: 'string', description: 'Имя пакета приложения.' },
      ids: { type: 'integer', description: 'ID конкретной версии, если нужна только она.' },
      versionStatuses: {
        type: 'string',
        description: 'Статусы через запятую, например ACTIVE,DRAFT. Без параметра — все статусы.',
      },
      page: { type: 'integer', description: 'Номер страницы, начиная с 0.', minimum: 0 },
      size: { type: 'integer', description: 'Размер страницы (по умолчанию 20).', minimum: 1, maximum: 100 },
    },
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  async run(args, context) {
    if (!args.packageName) throw new RuStoreError('Не указан packageName.', { code: 'ARGUMENT' });
    const client = await context.api();
    return client.request({
      path: `${app(args.packageName)}/version`,
      query: pick(args, ['ids', 'versionStatuses', 'page', 'size']),
    });
  },
};

/**
 * Инструмент «детальная информация о версии».
 *
 * `GET /public/v2/application/{packageName}/version/{versionId}`.
 */
const versionInfo = {
  name: 'version_info',
  title: 'Информация о версии',
  description:
    'Детальные данные версии (API v2): названия и описания, категории, возрастная категория, ' +
    'статус, файлы, иконка и скриншоты. Используйте, чтобы понять, чего не хватает до модерации.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['packageName', 'versionId'],
    properties: {
      packageName: { type: 'string', description: 'Имя пакета приложения.' },
      versionId: { type: 'integer', description: 'ID версии.' },
    },
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  async run(args, context) {
    if (!args.packageName || !args.versionId) throw new RuStoreError('Нужны packageName и versionId.', { code: 'ARGUMENT' });
    const client = await context.api();
    return client.request({ path: versionV2(args.packageName, args.versionId) });
  },
};

/**
 * Инструмент «статус версии».
 *
 * `GET /public/v1/application/{packageName}/version?ids={versionId}` — статус
 * берётся из списка версий, отдельного метода «статус» в API нет.
 */
const versionStatus = {
  name: 'version_status',
  title: 'Статус версии',
  description:
    'Статус конкретной версии: DRAFT, READY_FOR_PUBLICATION, PUBLISHED, REJECTED_BY_MODERATOR, ARCHIVED. ' +
    'Возвращает причину отклонения, если модератор её указал. Первое, что проверяют после отправки на модерацию.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['packageName', 'versionId'],
    properties: {
      packageName: { type: 'string', description: 'Имя пакета приложения.' },
      versionId: { type: 'integer', description: 'ID версии.' },
    },
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  async run(args, context) {
    if (!args.packageName || !args.versionId) throw new RuStoreError('Нужны packageName и versionId.', { code: 'ARGUMENT' });
    const client = await context.api();
    const list = await client.request({
      path: `${app(args.packageName)}/version`,
      query: { ids: args.versionId, page: 0, size: 10 },
    });
    const items = Array.isArray(list?.content) ? list.content : Array.isArray(list) ? list : [];
    const found = items.find((item) => String(item?.versionId ?? item?.id) === String(args.versionId)) ?? items[0] ?? null;
    return { versionId: args.versionId, version: found, items: items.length };
  },
};

/**
 * Инструмент «создать черновик версии».
 *
 * `POST /public/v1/application/{packageName}/version`.
 */
const draftCreate = {
  name: 'draft_create',
  title: 'Создать черновик версии',
  description:
    'Создаёт черновик версии и заполняет карточку. appType: GAMES для игр, MAIN для остальных; ' +
    'categories — до двух кодов из rustore_categories_list; ageLegal: 18+, 16+, 12+, 7+, 3+; ' +
    'shortDescription ≤ 80 символов, fullDescription ≤ 4000, whatsNew ≤ 500, moderInfo ≤ 180; ' +
    'publishType: INSTANTLY, DELAYED или MANUAL. Возвращает versionId для следующих шагов.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['packageName'],
    properties: {
      packageName: { type: 'string', description: 'Имя пакета приложения.' },
      appName: { type: 'string', description: 'Название приложения в каталоге.' },
      appType: { type: 'string', description: 'Тип приложения.', enum: ['MAIN', 'GAMES'] },
      categories: {
        type: 'array',
        items: { type: 'string' },
        description: 'До двух кодов категорий, например ["tools", "finance"].',
      },
      ageLegal: { type: 'string', description: 'Возрастная категория.', enum: ['18+', '16+', '12+', '7+', '3+'] },
      shortDescription: { type: 'string', description: 'Краткое описание, ≤ 80 символов.' },
      fullDescription: { type: 'string', description: 'Полное описание, ≤ 4000 символов.' },
      whatsNew: { type: 'string', description: 'Что нового в версии, ≤ 500 символов.' },
      moderInfo: { type: 'string', description: 'Комментарий модератору, ≤ 180 символов.' },
      priceValue: { type: 'string', description: 'Цена в минимальных единицах валюты (копейках).' },
      publishType: { type: 'string', description: 'Тип публикации.', enum: ['INSTANTLY', 'DELAYED', 'MANUAL'] },
      publishDateTime: { type: 'string', description: 'Дата и время отложенной публикации.' },
      partialValue: { type: 'number', description: 'Процент частичной публикации.' },
    },
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  async run(args, context) {
    if (!args.packageName) throw new RuStoreError('Не указан packageName.', { code: 'ARGUMENT' });
    const client = await context.api();
    return client.request({
      method: 'POST',
      path: `${app(args.packageName)}/version`,
      body: pick(args, DRAFT_FIELDS),
    });
  },
};

/**
 * Инструмент «отредактировать черновик версии».
 *
 * `PATCH /public/v2/application/{packageName}/version/{versionId}`.
 */
const draftUpdate = {
  name: 'draft_update',
  title: 'Изменить черновик версии',
  description:
    'Редактирует черновик через API v2 (PATCH): название (≤ 50 символов), описания, «что нового», ' +
    'комментарий модератору, категории, возрастная категория. Менять можно только черновик.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['packageName', 'versionId'],
    properties: {
      packageName: { type: 'string', description: 'Имя пакета приложения.' },
      versionId: { type: 'integer', description: 'ID версии.' },
      fields: {
        type: 'object',
        description: 'Изменяемые поля карточки: appName, shortDescription, fullDescription, whatsNew, moderInfo, ageLegal, categories, appType, priceValue.',
        additionalProperties: true,
      },
    },
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  async run(args, context) {
    if (!args.packageName || !args.versionId) throw new RuStoreError('Нужны packageName и versionId.', { code: 'ARGUMENT' });
    if (!args.fields || typeof args.fields !== 'object') {
      throw new RuStoreError('Передайте fields — объект с изменяемыми полями карточки.', { code: 'ARGUMENT' });
    }
    const client = await context.api();
    return client.request({ method: 'PATCH', path: versionV2(args.packageName, args.versionId), body: args.fields });
  },
};

/**
 * Инструмент «удалить черновик версии».
 *
 * `DELETE /public/v1/application/{packageName}/version/{versionId}`.
 */
const draftDelete = {
  name: 'draft_delete',
  title: 'Удалить черновик версии',
  description:
    'Удаляет черновик версии вместе с загруженными файлами, иконкой и скриншотами. Необратимо: ' +
    'перед вызовом получите подтверждение пользователя.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['packageName', 'versionId'],
    properties: {
      packageName: { type: 'string', description: 'Имя пакета приложения.' },
      versionId: { type: 'integer', description: 'ID версии.' },
    },
  },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  async run(args, context) {
    if (!args.packageName || !args.versionId) throw new RuStoreError('Нужны packageName и versionId.', { code: 'ARGUMENT' });
    const client = await context.api();
    return client.request({ method: 'DELETE', path: version(args.packageName, args.versionId) });
  },
};

/**
 * Общая загрузка APK/AAB.
 *
 * `POST /public/v1/application/{packageName}/version/{versionId}/{apk|aab}`.
 *
 * @param {object} args - аргументы инструмента.
 * @param {object} context - контекст инструментов.
 * @param {'apk'|'aab'} kind - тип файла.
 * @returns {Promise<unknown>} ответ API.
 */
async function uploadBinary(args, context, kind) {
  if (!args.packageName || !args.versionId) throw new RuStoreError('Нужны packageName и versionId.', { code: 'ARGUMENT' });
  if (!args.filePath) throw new RuStoreError('Не указан filePath.', { code: 'ARGUMENT' });
  const client = await context.api();
  return client.upload({
    path: `${version(args.packageName, args.versionId)}/${kind}`,
    filePath: args.filePath,
    query: {
      isMainApk: String(args.isMainApk ?? true),
      ...(args.servicesType ? { servicesType: args.servicesType } : {}),
    },
  });
}

/** Общие параметры загрузки файла версии. */
const BINARY_PARAMETERS = {
  packageName: { type: 'string', description: 'Имя пакета приложения.' },
  versionId: { type: 'integer', description: 'ID версии.' },
  filePath: { type: 'string', description: 'Абсолютный путь к файлу на диске.' },
  isMainApk: { type: 'boolean', description: 'Основной файл версии (по умолчанию true).' },
  servicesType: { type: 'string', description: 'Тип сервисов, если применимо.' },
};

/**
 * Инструмент «загрузить APK».
 */
const uploadApk = {
  name: 'upload_apk',
  title: 'Загрузить APK',
  description:
    'Загружает APK в версию приложения (multipart, поле file). isMainApk указывает, основной ли это файл. ' +
    'Файл читается с локального диска по абсолютному пути.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['packageName', 'versionId', 'filePath'],
    properties: BINARY_PARAMETERS,
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  async run(args, context) {
    return uploadBinary(args, context, 'apk');
  },
};

/**
 * Инструмент «загрузить AAB».
 */
const uploadAab = {
  name: 'upload_aab',
  title: 'Загрузить AAB',
  description:
    'Загружает AAB (Android App Bundle) в версию приложения (multipart, поле file). Рекомендуемый формат ' +
    'для новых приложений RuStore. Файл читается с локального диска по абсолютному пути.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['packageName', 'versionId', 'filePath'],
    properties: BINARY_PARAMETERS,
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  async run(args, context) {
    return uploadBinary(args, context, 'aab');
  },
};

/**
 * Инструмент «загрузить иконку».
 *
 * `POST /public/v1/application/{packageName}/version/{versionId}/image/icon`.
 */
const uploadIcon = {
  name: 'upload_icon',
  title: 'Загрузить иконку',
  description:
    'Загружает иконку приложения (multipart, поле file). Требование RuStore: 512×512 px, до 3 МБ, ' +
    'фон по всей площади без прозрачных краёв.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['packageName', 'versionId', 'filePath'],
    properties: {
      packageName: { type: 'string', description: 'Имя пакета приложения.' },
      versionId: { type: 'integer', description: 'ID версии.' },
      filePath: { type: 'string', description: 'Абсолютный путь к файлу иконки (png/jpg).' },
    },
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  async run(args, context) {
    if (!args.packageName || !args.versionId) throw new RuStoreError('Нужны packageName и versionId.', { code: 'ARGUMENT' });
    if (!args.filePath) throw new RuStoreError('Не указан filePath.', { code: 'ARGUMENT' });
    const client = await context.api();
    return client.upload({ path: `${version(args.packageName, args.versionId)}/image/icon`, filePath: args.filePath });
  },
};

/**
 * Инструмент «загрузить скриншоты».
 *
 * `POST /public/v2/application/{packageName}/version/{versionId}/image/screenshot/{orientation}/{ordinal}/{type}`.
 */
const uploadScreens = {
  name: 'upload_screens',
  title: 'Загрузить скриншоты',
  description:
    'Загружает скриншоты по одному файлу за вызов (API v2). orientation: PORTRAIT или LANDSCAPE; ' +
    'type: SCREENSHOT (телефон), TABLET_SCREENSHOT или TV_SCREENSHOT; ordinal 0…9 — порядковый номер. ' +
    'Для публикации нужно не меньше трёх скриншотов на тип устройства; файл jpg/png до 5 МБ.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['packageName', 'versionId', 'filePaths'],
    properties: {
      packageName: { type: 'string', description: 'Имя пакета приложения.' },
      versionId: { type: 'integer', description: 'ID версии.' },
      filePaths: { type: 'array', items: { type: 'string' }, description: 'Абсолютные пути к файлам скриншотов.' },
      orientation: { type: 'string', description: 'Ориентация.', enum: ['PORTRAIT', 'LANDSCAPE'] },
      type: {
        type: 'string',
        description: 'Тип устройства.',
        enum: ['SCREENSHOT', 'TABLET_SCREENSHOT', 'TV_SCREENSHOT'],
      },
      startOrdinal: { type: 'integer', description: 'Первый порядковый номер, 0…9 (по умолчанию 0).', minimum: 0, maximum: 9 },
    },
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  async run(args, context) {
    if (!args.packageName || !args.versionId) throw new RuStoreError('Нужны packageName и versionId.', { code: 'ARGUMENT' });
    const files = Array.isArray(args.filePaths) ? args.filePaths : [];
    if (files.length === 0) throw new RuStoreError('Передайте filePaths — хотя бы один файл.', { code: 'ARGUMENT' });
    const orientation = args.orientation ?? 'PORTRAIT';
    const type = args.type ?? 'SCREENSHOT';
    const start = Number.isInteger(args.startOrdinal) ? args.startOrdinal : 0;
    if (start + files.length > 10) {
      throw new RuStoreError('ordinal допускает 0…9: за один вызов не более 10 файлов с учётом startOrdinal.', { code: 'ARGUMENT' });
    }
    const client = await context.api();
    const uploaded = [];
    for (const [index, filePath] of files.entries()) {
      const result = await client.upload({
        path: `${versionV2(args.packageName, args.versionId)}/image/screenshot/${orientation}/${start + index}/${type}`,
        filePath,
      });
      uploaded.push({ filePath, ordinal: start + index, result });
    }
    return { uploaded: uploaded.length, orientation, type, items: uploaded };
  },
};

/**
 * Инструмент «список скриншотов».
 *
 * `GET /public/v2/application/{packageName}/version/{versionId}/image/screenshot`.
 */
const screensList = {
  name: 'screens_list',
  title: 'Список скриншотов версии',
  description: 'Скриншоты версии с идентификаторами, порядком и типом устройства — что уже загружено.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['packageName', 'versionId'],
    properties: {
      packageName: { type: 'string', description: 'Имя пакета приложения.' },
      versionId: { type: 'integer', description: 'ID версии.' },
      size: { type: 'integer', description: 'Размер страницы (по умолчанию 20).', minimum: 1, maximum: 100 },
      page: { type: 'integer', description: 'Номер страницы с 0.', minimum: 0 },
    },
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  async run(args, context) {
    if (!args.packageName || !args.versionId) throw new RuStoreError('Нужны packageName и versionId.', { code: 'ARGUMENT' });
    const client = await context.api();
    return client.request({
      path: `${versionV2(args.packageName, args.versionId)}/image/screenshot`,
      query: pick(args, ['size', 'page']),
    });
  },
};

/**
 * Инструмент «удалить скриншот».
 *
 * `DELETE /public/v2/application/{packageName}/version/{versionId}/image/screenshot/{id}`.
 */
const screenshotDelete = {
  name: 'screenshot_delete',
  title: 'Удалить скриншот',
  description: 'Удаляет скриншот версии по его id (см. screens_list). Необратимо.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['packageName', 'versionId', 'id'],
    properties: {
      packageName: { type: 'string', description: 'Имя пакета приложения.' },
      versionId: { type: 'integer', description: 'ID версии.' },
      id: { type: 'integer', description: 'ID скриншота.' },
    },
  },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  async run(args, context) {
    if (!args.packageName || !args.versionId || !args.id) {
      throw new RuStoreError('Нужны packageName, versionId и id скриншота.', { code: 'ARGUMENT' });
    }
    const client = await context.api();
    return client.request({
      method: 'DELETE',
      path: `${versionV2(args.packageName, args.versionId)}/image/screenshot/${args.id}`,
    });
  },
};

/**
 * Инструмент «настройки публикации».
 *
 * `POST /public/v1/application/{packageName}/version/{versionId}/publish-settings`.
 */
const publishSettings = {
  name: 'publish_settings',
  title: 'Настройки публикации',
  description:
    'Меняет тип публикации версии: INSTANTLY (сразу после модерации), DELAYED (в указанную дату) или ' +
    'MANUAL (публикация вручную через manual_publish). Для DELAYED укажите publishDateTime, для ' +
    'частичной публикации — partialValue.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['packageName', 'versionId'],
    properties: {
      packageName: { type: 'string', description: 'Имя пакета приложения.' },
      versionId: { type: 'integer', description: 'ID версии.' },
      publishType: { type: 'string', description: 'Тип публикации.', enum: ['INSTANTLY', 'DELAYED', 'MANUAL'] },
      publishDateTime: { type: 'string', description: 'Дата и время публикации для DELAYED.' },
      partialValue: { type: 'number', description: 'Процент частичной публикации.' },
    },
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  async run(args, context) {
    if (!args.packageName || !args.versionId) throw new RuStoreError('Нужны packageName и versionId.', { code: 'ARGUMENT' });
    const client = await context.api();
    return client.request({
      method: 'POST',
      path: `${version(args.packageName, args.versionId)}/publish-settings`,
      body: pick(args, ['publishType', 'publishDateTime', 'partialValue']),
    });
  },
};

/**
 * Инструмент «отправить на модерацию».
 *
 * `POST /public/v1/application/{packageName}/version/{versionId}/commit?priorityUpdate=`.
 */
const sendToModeration = {
  name: 'send_to_moderation',
  title: 'Отправить на модерацию',
  description:
    'Отправляет заполненный черновик на модерацию. priorityUpdate — приоритет обновления 0…5 ' +
    '(0 — минимальный, по умолчанию 0). Перед вызовом проверьте файл, иконку, скриншоты, описания и ' +
    'возрастную категорию: после отправки версия уходит на проверку RuStore.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['packageName', 'versionId'],
    properties: {
      packageName: { type: 'string', description: 'Имя пакета приложения.' },
      versionId: { type: 'integer', description: 'ID версии.' },
      priorityUpdate: { type: 'integer', description: 'Приоритет обновления 0…5.', minimum: 0, maximum: 5 },
    },
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  async run(args, context) {
    if (!args.packageName || !args.versionId) throw new RuStoreError('Нужны packageName и versionId.', { code: 'ARGUMENT' });
    const client = await context.api();
    return client.request({
      method: 'POST',
      path: `${version(args.packageName, args.versionId)}/commit`,
      query: { priorityUpdate: String(args.priorityUpdate ?? 0) },
    });
  },
};

/**
 * Инструмент «ручная публикация».
 *
 * `POST /public/v1/application/{packageName}/version/{versionId}/publish`.
 */
const manualPublish = {
  name: 'manual_publish',
  title: 'Опубликовать версию вручную',
  description:
    'Публикует прошедшую модерацию версию, если у приложения выбран ручной тип публикации (MANUAL). ' +
    'Необратимое внешнее действие: версия появляется в каталоге RuStore.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['packageName', 'versionId'],
    properties: {
      packageName: { type: 'string', description: 'Имя пакета приложения.' },
      versionId: { type: 'integer', description: 'ID версии.' },
    },
  },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  async run(args, context) {
    if (!args.packageName || !args.versionId) throw new RuStoreError('Нужны packageName и versionId.', { code: 'ARGUMENT' });
    const client = await context.api();
    return client.request({ method: 'POST', path: `${version(args.packageName, args.versionId)}/publish` });
  },
};

/**
 * Инструмент «архивировать версию».
 *
 * `POST /public/v1/application/{packageName}/version/{versionId}/archive`.
 */
const versionArchive = {
  name: 'version_archive',
  title: 'Архивировать версию',
  description:
    'Переводит версию в статус ARCHIVED. Разрешено только для READY_FOR_PUBLICATION и ' +
    'REJECTED_BY_MODERATOR; для DRAFT и PUBLISHED API вернёт ошибку. Если версия не публиковалась, ' +
    'освобождается ver_code.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['packageName', 'versionId'],
    properties: {
      packageName: { type: 'string', description: 'Имя пакета приложения.' },
      versionId: { type: 'integer', description: 'ID версии.' },
    },
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  async run(args, context) {
    if (!args.packageName || !args.versionId) throw new RuStoreError('Нужны packageName и versionId.', { code: 'ARGUMENT' });
    const client = await context.api();
    return client.request({ method: 'POST', path: `${version(args.packageName, args.versionId)}/archive` });
  },
};

/**
 * Инструмент «категории приложений».
 *
 * Статический справочник: API-метода для категорий нет.
 */
const categoriesList = {
  name: 'categories_list',
  title: 'Категории приложений',
  description:
    'Справочник категорий RuStore: код для поля categories, название и тип приложения (MAIN или GAMES). ' +
    'В черновике указывается до двух категорий одного типа.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      appType: { type: 'string', description: 'Фильтр по типу приложения.', enum: ['MAIN', 'GAMES'] },
    },
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  async run(args) {
    const items = args?.appType ? CATEGORIES.filter((item) => item.appType === args.appType) : CATEGORIES;
    return { total: items.length, categories: items };
  },
};

/**
 * Инструмент «теги приложений».
 *
 * `GET /public/v1/application/tag`.
 */
const appTags = {
  name: 'app_tags',
  title: 'Теги приложений',
  description: 'Список поисковых тегов RuStore для карточки приложения.',
  parameters: { type: 'object', additionalProperties: false, properties: {} },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  async run(_args, context) {
    const client = await context.api();
    return client.request({ path: '/public/v1/application/tag' });
  },
};

/**
 * Инструмент «настройки плагина».
 */
const settingsGet = {
  name: 'settings_get',
  title: 'Настройки RuStore',
  description:
    'Действующие настройки подключения: режим авторизации, keyId, наличие токена и ключа (секреты ' +
    'замаскированы), адреса API и путь к файлу настроек. Первое, что нужно смотреть при ошибке авторизации.',
  parameters: { type: 'object', additionalProperties: false, properties: {} },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  async run(_args, context) {
    return context.describe();
  },
};

/**
 * Инструмент «записать настройки плагина».
 */
const settingsSet = {
  name: 'settings_set',
  title: 'Записать настройки RuStore',
  description:
    'Сохраняет keyId, приватный ключ, токен или адреса API в файл настроек RuStore ' +
    '(%USERPROFILE%\\.dsh\\rustore.json). Пустая строка удаляет поле. Приватный ключ передаётся только ' +
    'по явной просьбе пользователя и не печатается в ответе.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      keyId: { type: 'string', description: 'ID ключа RuStore.' },
      privateKey: { type: 'string', description: 'Приватный ключ Base64 из RuStore Консоли.' },
      token: { type: 'string', description: 'Готовый JWE-токен.' },
      companyId: { type: 'string', description: 'ID компании, если используется.' },
      apiBase: { type: 'string', description: 'Базовый адрес публикационного API.' },
      authUrl: { type: 'string', description: 'Адрес метода выдачи токена.' },
    },
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  async run(args, context) {
    return context.save(pick(args, ['keyId', 'privateKey', 'token', 'companyId', 'apiBase', 'authUrl']));
  },
};

/**
 * Инструмент «проверить авторизацию».
 */
const authCheck = {
  name: 'auth_check',
  title: 'Проверить авторизацию',
  description:
    'Проверяет связку keyId + приватный ключ: выпускает JWE-токен и запрашивает список приложений. ' +
    'Показывает префикс токена и сколько приложений доступно.',
  parameters: { type: 'object', additionalProperties: false, properties: {} },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  async run(_args, context) {
    const client = await context.api();
    const token = await client.getToken();
    const apps = await client.request({ path: '/public/v1/application', query: { pagination: false } });
    const list = Array.isArray(apps?.content) ? apps.content : Array.isArray(apps) ? apps : [];
    return {
      authorized: true,
      tokenPrefix: `${String(token).slice(0, 12)}…`,
      appsVisible: list.length,
      note: 'JWE-токен живёт 900 секунд и обновляется автоматически.',
    };
  },
};

/** Полный набор инструментов для обоих адаптеров. */
export const TOOLS = [
  appsList,
  appVersions,
  versionInfo,
  versionStatus,
  draftCreate,
  draftUpdate,
  draftDelete,
  uploadApk,
  uploadAab,
  uploadIcon,
  uploadScreens,
  screensList,
  screenshotDelete,
  publishSettings,
  sendToModeration,
  manualPublish,
  versionArchive,
  categoriesList,
  appTags,
  settingsGet,
  settingsSet,
  authCheck,
];

/** Быстрый поиск инструмента по имени. */
export const TOOL_INDEX = new Map(TOOLS.map((tool) => [tool.name, tool]));
