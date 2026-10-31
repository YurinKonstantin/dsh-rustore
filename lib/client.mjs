/**
 * HTTP-клиент RuStore Publishing API.
 *
 * Клиент держит JWE-токен в памяти и обновляет его за минуту до истечения
 * `ttl` (900 секунд). Если сервер всё же ответил 401 — токен сбрасывается и
 * запрос повторяется ровно один раз, чтобы истёкший кэш не превращался в
 * ошибку инструмента.
 *
 * @module dsh-rustore/lib/client
 */

import fs from 'node:fs/promises';

import { fetchToken } from './auth.mjs';
import { RuStoreConfigError, RuStoreError } from './errors.mjs';
import { requireCredentials } from './settings.mjs';

/** Запас до истечения токена, мс. */
const TOKEN_MARGIN_MS = 60_000;

/**
 * Соединить базовый адрес и путь метода.
 *
 * @param {string} base - базовый адрес без завершающего слэша.
 * @param {string} path - путь, начинающийся со слэша.
 * @returns {string} абсолютный адрес.
 */
export function joinUrl(base, path) {
  return `${String(base).replace(/\/+$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
}

/**
 * Собрать строку запроса из объекта параметров.
 *
 * @param {Record<string, unknown>} [query] - параметры; undefined/пустые пропускаются.
 * @returns {string} строка без ведущего `?`, может быть пустой.
 */
export function buildQuery(query = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) for (const item of value) params.append(key, String(item));
    else params.append(key, String(value));
  }
  return params.toString();
}

/**
 * Зеркало публикационного API: документация RuStore использует два хоста —
 * `public-api.rustore.ru` и `public-api-m.rustore.ru`. Чтение пробует второй,
 * если первый ответил 404.
 *
 * @param {string} base - основной базовый адрес.
 * @returns {string|null} зеркало или null, если адрес нестандартный.
 */
export function deriveMirror(base) {
  const text = String(base ?? '');
  if (text.includes('public-api-m.rustore.ru')) return text.replace('public-api-m.rustore.ru', 'public-api.rustore.ru');
  if (text.includes('public-api.rustore.ru')) return text.replace('public-api.rustore.ru', 'public-api-m.rustore.ru');
  return null;
}

/** Клиент публикационного API RuStore. */
export class RuStoreClient {
  /**
   * @param {object} resolved - результат `resolveConfig`.
   * @param {object} [options] - настройки клиента.
   * @param {typeof fetch} [options.fetchImpl] - подмена fetch (тесты).
   * @param {() => Date} [options.now] - источник времени (тесты).
   */
  constructor(resolved, { fetchImpl = fetch, now = () => new Date() } = {}) {
    this.config = resolved;
    this.fetchImpl = fetchImpl;
    this.now = now;
    /** @type {{token: string, expiresAt: number} | null} */
    this.cached = null;
    this.mirrorBase = resolved.mirrorBase ?? deriveMirror(resolved.apiBase);
  }

  /** @returns {string} базовый адрес API без завершающего слэша. */
  get apiBase() {
    return String(this.config.apiBase).replace(/\/+$/, '');
  }

  /**
   * Действующий JWE-токен: из настроек либо выписанный по ключу.
   *
   * @param {object} [options] - параметры.
   * @param {boolean} [options.force] - игнорировать кэш.
   * @returns {Promise<string>} токен для заголовка `Public-Token`.
   */
  async getToken({ force = false } = {}) {
    if (this.config.token) return this.config.token;
    const credentials = requireCredentials(this.config);
    if (credentials.mode !== 'key') {
      throw new RuStoreConfigError('Для выпуска токена нужны keyId и приватный ключ RuStore.');
    }
    const now = this.now().getTime();
    if (!force && this.cached && this.cached.expiresAt > now) return this.cached.token;

    const { token, ttlSeconds } = await fetchToken({
      authUrl: this.config.authUrl,
      keyId: this.config.keyId,
      privateKey: this.config.privateKey,
      timeoutMs: this.config.timeoutMs,
      fetchImpl: this.fetchImpl,
    });
    this.cached = { token, expiresAt: now + Math.max(0, ttlSeconds * 1000 - TOKEN_MARGIN_MS) };
    return token;
  }

  /**
   * Выполнить запрос к публикационному API.
   *
   * @param {object} options - параметры запроса.
   * @param {string} [options.method] - HTTP-метод.
   * @param {string} options.path - путь метода, начиная со слэша.
   * @param {Record<string, unknown>} [options.query] - query-параметры.
   * @param {unknown} [options.body] - JSON-тело.
   * @param {FormData} [options.form] - multipart-тело вместо JSON.
   * @param {Record<string, string>} [options.headers] - дополнительные заголовки.
   * @param {boolean} [options.expectBinary] - вернуть буфер вместо JSON.
   * @param {boolean} [options.retryOnAuth] - разрешить один повтор после 401.
   * @returns {Promise<unknown>} разобранное тело ответа.
   */
  async request({ method = 'GET', path, query, body, form, headers = {}, expectBinary = false, retryOnAuth = true }) {
    const buildUrl = (base) => {
      const url = new URL(joinUrl(base, path));
      const queryString = buildQuery(query);
      if (queryString) url.search = queryString;
      return url;
    };

    const token = await this.getToken();
    const requestHeaders = { accept: 'application/json', 'Public-Token': token, ...headers };
    /** @type {RequestInit} */
    const init = {
      method,
      headers: requestHeaders,
      signal: AbortSignal.timeout(this.config.timeoutMs),
    };
    if (form) init.body = form;
    else if (body !== undefined) {
      requestHeaders['content-type'] = 'application/json';
      init.body = JSON.stringify(body);
    }

    let response = await this.fetchImpl(buildUrl(this.apiBase), init);

    // Документация RuStore использует два хоста публикационного API.
    // Для чтения 404 на основном хосте означает «попробуй зеркало»;
    // изменяющие запросы не повторяются, чтобы не задвоить операцию.
    if (method === 'GET' && response.status === 404 && this.mirrorBase) {
      response = await this.fetchImpl(buildUrl(this.mirrorBase), init);
    }

    if ((response.status === 401 || response.status === 403) && retryOnAuth && !this.config.token) {
      await this.getToken({ force: true });
      return this.request({ method, path, query, body, form, headers, expectBinary, retryOnAuth: false });
    }

    if (expectBinary) {
      if (!response.ok) throw await this.#errorFromResponse(response, method, path);
      return Buffer.from(await response.arrayBuffer());
    }

    const text = await response.text();
    if (!text.trim()) {
      if (!response.ok) throw new RuStoreError(`RuStore ${method} ${path}: HTTP ${response.status} без тела.`, {
        code: 'HTTP_ERROR',
        status: response.status,
      });
      return null;
    }

    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new RuStoreError(`RuStore ${method} ${path}: ответ не JSON (HTTP ${response.status}).`, {
        code: 'BAD_RESPONSE',
        status: response.status,
        body: text.slice(0, 500),
      });
    }

    const code = payload?.code;
    if (code !== undefined && code !== null && code !== 'OK') {
      throw new RuStoreError(
        `RuStore ${method} ${path} отклонил запрос: ${code} — ${payload?.message ?? 'без описания'}`,
        { code: String(code), status: response.status, body: payload?.body ?? payload },
      );
    }
    if (!response.ok) throw await this.#errorFromResponse(response, method, path, payload);
    return payload?.body ?? payload?.content ?? payload;
  }

  /**
   * Загрузить файл (AAB, APK, иконка, скриншот) через multipart.
   *
   * @param {object} options - параметры загрузки.
   * @param {string} options.path - путь метода.
   * @param {string} options.filePath - абсолютный путь к файлу на диске.
   * @param {Record<string, unknown>} [options.fields] - дополнительные поля формы.
   * @param {Record<string, unknown>} [options.query] - query-параметры вместе с multipart.
   * @param {string} [options.fieldName] - имя поля файла, `file` по умолчанию.
   * @returns {Promise<unknown>} ответ API.
   */
  async upload({ path, filePath, fields = {}, query, fieldName = 'file' }) {
    const stat = await fs.stat(filePath).catch(() => null);
    if (!stat || !stat.isFile()) {
      throw new RuStoreError(`Файл не найден: ${filePath}`, { code: 'FILE_NOT_FOUND' });
    }
    const blob = await fs.openAsBlob(filePath);
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) {
      if (value === undefined || value === null) continue;
      form.append(key, typeof value === 'string' ? value : JSON.stringify(value));
    }
    form.append(fieldName, blob, filePath.split(/[\\/]/).pop());
    return this.request({ method: 'POST', path, form, query });
  }

  /**
   * Загрузить несколько файлов одним multipart-запросом.
   *
   * @param {object} options - параметры загрузки.
   * @param {string} options.path - путь метода.
   * @param {string[]} options.filePaths - абсолютные пути к файлам.
   * @param {string} [options.fieldName] - имя поля файла, `file` по умолчанию.
   * @param {Record<string, unknown>} [options.query] - query-параметры.
   * @returns {Promise<unknown>} ответ API.
   */
  async uploadMany({ path, filePaths, fieldName = 'file', query }) {
    const form = new FormData();
    for (const filePath of filePaths) {
      const stat = await fs.stat(filePath).catch(() => null);
      if (!stat || !stat.isFile()) throw new RuStoreError(`Файл не найден: ${filePath}`, { code: 'FILE_NOT_FOUND' });
      const blob = await fs.openAsBlob(filePath);
      form.append(fieldName, blob, filePath.split(/[\\/]/).pop());
    }
    return this.request({ method: 'POST', path, form, query });
  }

  /**
   * Превратить неуспешный ответ в ошибку с безопасным телом.
   *
   * @param {Response} response - ответ fetch.
   * @param {string} method - метод запроса.
   * @param {string} path - путь запроса.
   * @param {unknown} [payload] - уже разобранное тело, если было.
   * @returns {Promise<RuStoreError>} ошибка для проброса.
   */
  async #errorFromResponse(response, method, path, payload) {
    let body = payload;
    if (body === undefined) {
      const text = await response.text().catch(() => '');
      try {
        body = JSON.parse(text);
      } catch {
        body = text.slice(0, 500);
      }
    }
    return new RuStoreError(`RuStore ${method} ${path}: HTTP ${response.status}.`, {
      code: 'HTTP_ERROR',
      status: response.status,
      body,
    });
  }
}
