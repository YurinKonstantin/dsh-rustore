/**
 * HTTP-маршруты страницы настроек RuStore.
 *
 * Клиентская часть плагина (`client.js`) живёт в том же Web UI, что и
 * десктопное приложение, и не имеет доступа к файловой системе. Поэтому значения
 * вводимые в настройках, принимает Host: он отдаёт состояние, пишет его в файл
 * настроек (`~/.dsh/rustore.json`) и умеет проверять авторизацию, не раскрывая
 * секреты в ответе.
 *
 * @module dsh-rustore/lib/routes
 */

import { RuStoreError } from './errors.mjs';

/** Префикс всех маршрутов плагина. */
export const ROUTE_PREFIX = '/api/dsh-rustore';

/** Предел тела запроса: настройки — это несколько строк, не файлы. */
const MAX_BODY_BYTES = 64 * 1024;

/**
 * Отправить JSON-ответ.
 *
 * @param {import('node:http').ServerResponse} res - ответ.
 * @param {number} status - HTTP-статус.
 * @param {unknown} value - тело.
 */
function sendJson(res, status, value) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.setHeader('x-content-type-options', 'nosniff');
  res.end(JSON.stringify(value));
}

/**
 * Прочитать JSON-тело запроса.
 *
 * @param {import('node:http').IncomingMessage} req - запрос.
 * @returns {Promise<object>} разобранный объект; пустой, если тела нет.
 */
async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new RuStoreError('Слишком большое тело запроса.', { code: 'BODY_TOO_LARGE' });
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) return {};
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new RuStoreError('Тело запроса должно быть JSON-объектом.', { code: 'BAD_BODY' });
  }
  return parsed;
}

/**
 * Состояние настроек для формы: секреты заменены признаком «задан».
 *
 * @param {object} context - контекст инструментов.
 * @returns {Promise<object>} описание для клиента.
 */
async function describeForForm(context) {
  const settings = await context.settings();
  return {
    keyId: settings.keyId ?? '',
    companyId: settings.companyId ?? '',
    apiBase: settings.apiBase,
    mirrorBase: settings.mirrorBase ?? '',
    authUrl: settings.authUrl,
    privateKeyRef: settings.privateKeyRef,
    timeoutMs: settings.timeoutMs,
    settingsPath: context.settingsPath,
    hasPrivateKey: Boolean(settings.privateKey),
    hasToken: Boolean(settings.token),
    authMode: settings.token ? 'token' : settings.keyId && settings.privateKey ? 'keyId+privateKey' : 'none',
  };
}

/**
 * Поля, которые форма может записать в файл настроек.
 *
 * @param {object} body - тело POST.
 * @returns {object} патч для `context.save`.
 */
function toSettingsPatch(body) {
  const patch = {};
  const textFields = ['keyId', 'companyId', 'apiBase', 'authUrl', 'privateKeyRef'];
  for (const field of textFields) {
    if (typeof body[field] === 'string') patch[field] = body[field].trim();
  }
  // Пустой секрет означает «оставить как есть»: удаление выполняется отдельным
  // действием `clear`, иначе перезапись формы стирала бы сохранённый ключ.
  for (const field of ['privateKey', 'token']) {
    if (typeof body[field] === 'string' && body[field].trim() !== '') patch[field] = body[field].trim();
  }
  if (Number.isFinite(body.timeoutMs) && body.timeoutMs > 0) patch.timeoutMs = body.timeoutMs;
  for (const field of ['keyId', 'privateKey', 'token']) {
    if (body.clear === field) patch[field] = '';
  }
  return patch;
}

/**
 * Зарегистрировать маршруты настроек.
 *
 * @param {object} webCtx - контекст с доступным сервисом `webServer`.
 * @param {object} context - контекст инструментов RuStore.
 * @returns {Array<() => void>} функции снятия маршрутов.
 */
export function registerSettingsRoutes(webCtx, context) {
  const server = webCtx.webServer ?? webCtx.get?.('webServer');
  if (!server?.register) return [];
  const disposers = [];

  disposers.push(
    server.register({
      kind: 'exact',
      path: `${ROUTE_PREFIX}/settings`,
      handler: async (req, res) => {
        if (req.method === 'GET') {
          try {
            sendJson(res, 200, await describeForForm(context));
          } catch (error) {
            sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
          }
          return;
        }
        if (req.method === 'POST') {
          try {
            const body = await readJsonBody(req);
            const patch = toSettingsPatch(body);
            if (Object.keys(patch).length === 0) {
              sendJson(res, 400, { error: 'Нет полей для сохранения.' });
              return;
            }
            await context.save(patch);
            sendJson(res, 200, await describeForForm(context));
          } catch (error) {
            const known = error instanceof RuStoreError;
            sendJson(res, known && error.code === 'BODY_TOO_LARGE' ? 413 : 400, {
              error: error instanceof Error ? error.message : String(error),
            });
          }
          return;
        }
        sendJson(res, 405, { error: 'Метод не поддерживается.' });
      },
    }),
  );

  disposers.push(
    server.register({
      kind: 'exact',
      path: `${ROUTE_PREFIX}/check`,
      handler: async (req, res) => {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'Метод не поддерживается.' });
          return;
        }
        try {
          const client = await context.api();
          const token = await client.getToken();
          const apps = await client.request({ path: '/public/v1/application', query: { pagination: false } });
          const list = Array.isArray(apps?.content) ? apps.content : Array.isArray(apps) ? apps : [];
          sendJson(res, 200, {
            ok: true,
            tokenPrefix: `${String(token).slice(0, 12)}…`,
            appsVisible: list.length,
            description: await describeForForm(context),
          });
        } catch (error) {
          sendJson(res, 200, {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
            code: error instanceof RuStoreError ? error.code : 'ERROR',
          });
        }
      },
    }),
  );

  return disposers;
}
