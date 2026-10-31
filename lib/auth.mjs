/**
 * Авторизация RuStore API: JWE-токен из приватного ключа.
 *
 * Последовательность из документации «Получение токена авторизации»:
 *   1. сообщение для подписи — конкатенация `keyId` и `timestamp`;
 *   2. хэш сообщения SHA-512;
 *   3. подпись хэша приватным ключом RSA (схема PKCS#1 v1.5, SHA512withRSA);
 *   4. подпись в Base64 — это `signature`.
 * Запрос `POST https://public-api-m.rustore.ru/public/auth/` с телом
 * `{ keyId, timestamp, signature }` отдаёт `body.jwe` и `body.ttl` = 900 с.
 * Дальше JWE передаётся в заголовке `Public-Token`.
 *
 * @module dsh-rustore/lib/auth
 */

import crypto from 'node:crypto';

import { RuStoreConfigError, RuStoreError } from './errors.mjs';

/** Допустимое расхождение часов по документации, мс. */
export const MAX_CLOCK_SKEW_MS = 60_000;

/**
 * Отметка времени в формате ISO 8601 с миллисекундами и смещением UTC.
 *
 * @param {Date} [date] - момент подписи.
 * @returns {string} например `2026-10-31T16:48:57.812+00:00`.
 */
export function formatTimestamp(date = new Date()) {
  return `${date.toISOString().slice(0, 23)}+00:00`;
}

/**
 * Загрузить приватный ключ из строки формата RuStore Консоли.
 *
 * Консоль отдаёт Base64 без PEM-заголовков; внутри — DER PKCS#8. Старые
 * ключи могут быть PKCS#1, поэтому пробуем оба варианта. PEM тоже принимаем.
 *
 * @param {string} input - Base64 (одной строкой) или PEM.
 * @returns {crypto.KeyObject} приватный ключ RSA.
 * @throws {RuStoreConfigError} если строку не удалось разобрать.
 */
export function loadPrivateKey(input) {
  const text = String(input ?? '').trim();
  if (!text) throw new RuStoreConfigError('Приватный ключ RuStore пуст.');

  if (text.includes('BEGIN')) {
    try {
      const key = crypto.createPrivateKey({ key: text, format: 'pem' });
      if (key.asymmetricKeyType !== 'rsa') throw new Error(`тип ключа ${key.asymmetricKeyType}, ожидается rsa`);
      return key;
    } catch (error) {
      throw new RuStoreConfigError(`Приватный ключ RuStore в PEM не разобран: ${error.message}`);
    }
  }

  const base64 = text.replace(/\s+/g, '');
  let der;
  try {
    der = Buffer.from(base64, 'base64');
  } catch (error) {
    throw new RuStoreConfigError(`Приватный ключ RuStore не является Base64: ${error.message}`);
  }
  if (der.length === 0) throw new RuStoreConfigError('Приватный ключ RuStore пуст после декодирования Base64.');

  for (const type of ['pkcs8', 'pkcs1']) {
    try {
      const key = crypto.createPrivateKey({ key: der, format: 'der', type });
      if (key.asymmetricKeyType === 'rsa') return key;
    } catch {
      // пробуем следующий формат
    }
  }
  throw new RuStoreConfigError(
    'Приватный ключ RuStore не разобран как RSA (проверены PKCS#8 и PKCS#1). ' +
      'Скопируйте ключ из RuStore Консоли целиком, без пробелов и переводов строк.',
  );
}

/**
 * Подпись запроса на токен.
 *
 * @param {object} options - параметры.
 * @param {string} options.keyId - ID ключа из RuStore Консоли.
 * @param {string} options.timestamp - отметка времени, уже сериализованная.
 * @param {string} options.privateKey - исходная строка ключа.
 * @returns {string} Base64-подпись.
 */
export function signAuthRequest({ keyId, timestamp, privateKey }) {
  const key = loadPrivateKey(privateKey);
  const message = Buffer.from(`${keyId}${timestamp}`, 'utf8');
  const signature = crypto.sign('sha512', message, { key, padding: crypto.constants.RSA_PKCS1_PADDING });
  return signature.toString('base64');
}

/**
 * Собрать тело запроса на получение токена.
 *
 * @param {object} options - параметры.
 * @param {string} options.keyId - ID ключа.
 * @param {string} options.privateKey - приватный ключ в Base64.
 * @param {Date} [options.now] - момент подписи, нужен для тестов.
 * @returns {{keyId: string, timestamp: string, signature: string}} тело запроса.
 */
export function buildAuthRequest({ keyId, privateKey, now = new Date() }) {
  if (!keyId) throw new RuStoreConfigError('Не задан keyId ключа RuStore.');
  const timestamp = formatTimestamp(now);
  return { keyId, timestamp, signature: signAuthRequest({ keyId, timestamp, privateKey }) };
}

/**
 * Запросить JWE-токен.
 *
 * @param {object} options - параметры.
 * @param {string} options.authUrl - полный адрес метода `/public/auth/`.
 * @param {string} options.keyId - ID ключа.
 * @param {string} options.privateKey - приватный ключ в Base64.
 * @param {number} [options.timeoutMs] - тайм-аут запроса.
 * @param {typeof fetch} [options.fetchImpl] - подмена fetch в тестах.
 * @returns {Promise<{token: string, ttlSeconds: number, timestamp: string}>} токен и срок жизни.
 */
export async function fetchToken({ authUrl, keyId, privateKey, timeoutMs = 120_000, fetchImpl = fetch }) {
  const body = buildAuthRequest({ keyId, privateKey });
  const response = await fetchImpl(authUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });

  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new RuStoreError(`Авторизация RuStore вернула не JSON (HTTP ${response.status}): ${text.slice(0, 300)}`, {
      code: 'AUTH_BAD_RESPONSE',
      status: response.status,
    });
  }

  if (payload?.code !== 'OK' || !payload?.body?.jwe) {
    throw new RuStoreError(
      `Авторизация RuStore не выдала токен: ${payload?.code ?? 'без кода'} — ${payload?.message ?? 'без описания'}`,
      { code: payload?.code ?? 'AUTH_FAILED', status: response.status, body: payload },
    );
  }

  const ttlSeconds = Number(payload.body.ttl) > 0 ? Number(payload.body.ttl) : 900;
  return { token: String(payload.body.jwe), ttlSeconds, timestamp: payload.timestamp ?? null };
}
