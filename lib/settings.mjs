/**
 * Настройки плагина RuStore.
 *
 * Порядок старшинства источников (первый непустой побеждает):
 *   1. `config` строки плагина в профиле DSH (`cordis.patch.yml`) — это
 *      «настройки плагина» в интерфейсе и в файле профиля;
 *   2. приватный ключ из хранилища секретов DSH (Settings → credentials),
 *      если плагин работает внутри DSH;
 *   3. переменные окружения процесса (`RUSTORE_*`) — способ для standalone
 *      MCP-сервера и CI;
 *   4. файл настроек `%USERPROFILE%\.dsh\rustore.json` — общий для DSH и
 *      MCP-сервера, его пишет инструмент `rustore_settings_set`.
 *
 * Файл и окружение не содержат ничего, кроме ключей и адресов; пароль в
 * открытом виде в настройки не попадает никогда.
 *
 * @module dsh-rustore/lib/settings
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { RuStoreConfigError } from './errors.mjs';

/** Адрес публикационного API по умолчанию (хост из документации RuStore). */
export const DEFAULT_API_BASE = 'https://public-api-m.rustore.ru';

/** Адрес выдачи JWE-токена. */
export const DEFAULT_AUTH_URL = 'https://public-api-m.rustore.ru/public/auth/';

/** Тайм-аут одного запроса, мс. */
export const DEFAULT_TIMEOUT_MS = 120_000;

/** Имя среза секрета в хранилище DSH по умолчанию. */
export const DEFAULT_CREDENTIAL_REF = 'RUSTORE_PRIVATE_KEY';

/**
 * Каталог состояния DSH: `DSH_HOME`, иначе `~/.dsh`.
 *
 * @param {NodeJS.ProcessEnv} [env] - окружение процесса.
 * @returns {string} абсолютный путь к каталогу.
 */
export function dshHome(env = process.env) {
  if (env.DSH_HOME && env.DSH_HOME.trim()) return path.resolve(env.DSH_HOME.trim());
  return path.join(os.homedir(), '.dsh');
}

/**
 * Путь к файлу настроек RuStore.
 *
 * @param {NodeJS.ProcessEnv} [env] - окружение процесса.
 * @returns {string} абсолютный путь; файл может ещё не существовать.
 */
export function defaultSettingsPath(env = process.env) {
  const explicit = env.RUSTORE_SETTINGS_FILE?.trim();
  if (explicit) return path.resolve(explicit);
  return path.join(dshHome(env), 'rustore.json');
}

/**
 * Прочитать файл настроек.
 *
 * @param {string} file - путь к JSON-файлу.
 * @returns {Promise<object>} содержимое; пустой объект, если файла нет.
 * @throws {RuStoreConfigError} если файл есть, но это не JSON-объект.
 */
export async function readSettings(file) {
  let raw;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') return {};
    throw new RuStoreConfigError(`Не удалось прочитать настройки RuStore (${file}): ${error.message}`);
  }
  if (!raw.trim()) return {};
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new RuStoreConfigError(`Файл настроек RuStore (${file}) не является корректным JSON: ${error.message}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new RuStoreConfigError(`Файл настроек RuStore (${file}) должен содержать JSON-объект.`);
  }
  return parsed;
}

/**
 * Записать настройки, не потеряв остальные поля.
 *
 * @param {string} file - путь к JSON-файлу.
 * @param {object} patch - изменяемые поля; `null`/`undefined` удаляют поле.
 * @returns {Promise<object>} итоговое содержимое файла.
 */
export async function writeSettings(file, patch) {
  const current = await readSettings(file);
  const next = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === undefined || value === '') delete next[key];
    else next[key] = value;
  }
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await fs.rename(tmp, file);
  return next;
}

/**
 * Свести источники в одно эффективное значение.
 *
 * @param {object} options - источники.
 * @param {object} [options.config] - конфигурация строки плагина.
 * @param {object} [options.env] - переменные окружения.
 * @param {object} [options.file] - содержимое файла настроек.
 * @param {string|null} [options.credentialPrivateKey] - ключ из хранилища DSH.
 * @returns {object} эффективная конфигурация без undefined.
 */
export function resolveConfig({ config = {}, env = {}, file = {}, credentialPrivateKey = null } = {}) {
  const pick = (...values) => values.find((value) => typeof value === 'string' && value.trim() !== '')?.trim();
  const num = (value) => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };

  return {
    token: pick(config.token, env.RUSTORE_TOKEN, file.token),
    keyId: pick(config.keyId, env.RUSTORE_KEY_ID, file.keyId),
    privateKey: pick(config.privateKey, credentialPrivateKey ?? undefined, env.RUSTORE_PRIVATE_KEY, file.privateKey),
    companyId: pick(
      config.companyId,
      env.RUSTORE_COMPANY_ID,
      typeof file.companyId === 'number' ? String(file.companyId) : file.companyId,
    ),
    apiBase: pick(config.apiBase, env.RUSTORE_API_BASE, file.apiBase) ?? DEFAULT_API_BASE,
    mirrorBase: pick(config.mirrorBase, env.RUSTORE_MIRROR_BASE, file.mirrorBase),
    authUrl: pick(config.authUrl, env.RUSTORE_AUTH_URL, file.authUrl) ?? DEFAULT_AUTH_URL,
    timeoutMs: num(config.timeoutMs) ?? num(env.RUSTORE_TIMEOUT_MS) ?? num(file.timeoutMs) ?? DEFAULT_TIMEOUT_MS,
    settingsPath: pick(env.RUSTORE_SETTINGS_FILE, config.settingsFile) ?? defaultSettingsPath(env),
    privateKeyRef: pick(config.privateKeyRef, env.RUSTORE_PRIVATE_KEY_REF) ?? DEFAULT_CREDENTIAL_REF,
  };
}

/**
 * Проверить, что авторизация возможна, и объяснить, чего не хватает.
 *
 * @param {object} resolved - результат {@link resolveConfig}.
 * @returns {{ mode: 'token'|'key', keyId?: string }} способ авторизации.
 * @throws {RuStoreConfigError} если нет ни токена, ни пары «ключ + приватный ключ».
 */
export function requireCredentials(resolved) {
  if (resolved.token) return { mode: 'token' };
  if (resolved.keyId && resolved.privateKey) return { mode: 'key', keyId: resolved.keyId };
  const missing = [];
  if (!resolved.keyId) missing.push('keyId');
  if (!resolved.privateKey) missing.push('privateKey');
  throw new RuStoreConfigError(
    'RuStore API не настроен: нет токена и нет пары keyId + приватный ключ. ' +
      'Задайте настройки плагина (token или keyId с privateKey) в конфигурации плагина, ' +
      `в файле ${resolved.settingsPath} через инструмент rustore_settings_set, ` +
      'или в переменных окружения RUSTORE_TOKEN / RUSTORE_KEY_ID + RUSTORE_PRIVATE_KEY. ' +
      `Отсутствует: ${missing.join(', ')}.`,
  );
}

/**
 * Представление настроек для модели: секреты заменены на маркеры.
 *
 * @param {object} resolved - результат {@link resolveConfig}.
 * @returns {object} безопасное описание.
 */
export function describeConfig(resolved) {
  const mask = (value) => {
    if (!value) return null;
    const text = String(value);
    return text.length <= 8 ? '***' : `${text.slice(0, 4)}…${text.slice(-2)} (${text.length} симв.)`;
  };
  return {
    authMode: resolved.token ? 'token' : resolved.keyId && resolved.privateKey ? 'keyId+privateKey' : 'none',
    keyId: resolved.keyId ?? null,
    privateKey: mask(resolved.privateKey),
    token: mask(resolved.token),
    companyId: resolved.companyId ?? null,
    apiBase: resolved.apiBase,
    authUrl: resolved.authUrl,
    timeoutMs: resolved.timeoutMs,
    settingsPath: resolved.settingsPath,
    privateKeyRef: resolved.privateKeyRef,
  };
}
