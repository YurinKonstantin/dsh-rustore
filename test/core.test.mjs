import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { buildAuthRequest, fetchToken, formatTimestamp, loadPrivateKey } from '../lib/auth.mjs';
import { RuStoreClient, buildQuery, joinUrl } from '../lib/client.mjs';
import { RuStoreError } from '../lib/errors.mjs';
import { describeConfig, resolveConfig, writeSettings, readSettings } from '../lib/settings.mjs';
import { TOOLS, TOOL_INDEX } from '../lib/tools.mjs';

/** Свежая пара RSA-ключей в том виде, в каком её выдаёт RuStore Консоль. */
function keyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const der = privateKey.export({ type: 'pkcs8', format: 'der' });
  return { publicKey, base64: der.toString('base64') };
}

const ENVELOPE = (body) => ({ code: 'OK', message: null, body, timestamp: new Date().toISOString() });

test('formatTimestamp: ISO 8601 с миллисекундами и смещением UTC', () => {
  const text = formatTimestamp(new Date('2026-10-31T13:48:57.812Z'));
  assert.equal(text, '2026-10-31T13:48:57.812+00:00');
  assert.match(text, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}\+00:00$/);
});

test('loadPrivateKey принимает Base64 PKCS#8 и PEM', () => {
  const { publicKey, base64 } = keyPair();
  const fromBase64 = loadPrivateKey(base64);
  assert.equal(fromBase64.asymmetricKeyType, 'rsa');

  const pem = publicKey.export({ type: 'spki', format: 'pem' });
  assert.throws(() => loadPrivateKey(pem), /Приватный ключ RuStore в PEM не разобран|ПЕМ|PEM/);
});

test('buildAuthRequest: подпись проверяется открытым ключом по строке keyId + timestamp', () => {
  const { publicKey, base64 } = keyPair();
  const request = buildAuthRequest({ keyId: '354751', privateKey: base64, now: new Date('2026-10-31T13:48:57.812Z') });

  assert.deepEqual(Object.keys(request), ['keyId', 'timestamp', 'signature']);
  assert.equal(request.keyId, '354751');
  assert.equal(request.timestamp, '2026-10-31T13:48:57.812+00:00');

  const verified = crypto.verify(
    'sha512',
    Buffer.from(`${request.keyId}${request.timestamp}`, 'utf8'),
    { key: publicKey, padding: crypto.constants.RSA_PKCS1_PADDING },
    Buffer.from(request.signature, 'base64'),
  );
  assert.equal(verified, true, 'подпись должна сходиться с открытым ключом');
});

test('buildAuthRequest: без keyId — понятная ошибка конфигурации', () => {
  const { base64 } = keyPair();
  assert.throws(() => buildAuthRequest({ keyId: '', privateKey: base64 }), /keyId/);
});

test('fetchToken разбирает успешный ответ и срок жизни', async () => {
  const { base64 } = keyPair();
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return new Response(JSON.stringify(ENVELOPE({ jwe: 'eyJjdHkiOiJK', ttl: 900 })), { status: 200 });
  };
  const result = await fetchToken({ authUrl: 'https://example.test/public/auth/', keyId: '42', privateKey: base64, fetchImpl });
  assert.equal(result.token, 'eyJjdHkiOiJK');
  assert.equal(result.ttlSeconds, 900);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.keyId, '42');
  assert.ok(calls[0].body.signature.length > 100);
});

test('fetchToken: отказ сервера превращается в RuStoreError с кодом', async () => {
  const { base64 } = keyPair();
  const fetchImpl = async () =>
    new Response(JSON.stringify({ code: 'Signature encode error', message: 'bad signature' }), { status: 200 });
  await assert.rejects(
    () => fetchToken({ authUrl: 'https://example.test/public/auth/', keyId: '42', privateKey: base64, fetchImpl }),
    (error) => error instanceof RuStoreError && error.code === 'Signature encode error',
  );
});

test('joinUrl и buildQuery собирают адрес метода', () => {
  assert.equal(joinUrl('https://public-api.rustore.ru/', '/public/v1/application'), 'https://public-api.rustore.ru/public/v1/application');
  assert.equal(buildQuery({ pagination: true, pageSize: 20, appName: undefined, empty: '' }), 'pagination=true&pageSize=20');
});

test('resolveConfig: старшинство конфигурация → секрет → окружение → файл', () => {
  const resolved = resolveConfig({
    config: { keyId: 'from-config', timeoutMs: 5000 },
    credentialPrivateKey: 'from-credential',
    env: { RUSTORE_KEY_ID: 'from-env', RUSTORE_PRIVATE_KEY: 'env-key', RUSTORE_API_BASE: 'https://env.test' },
    file: { keyId: 'from-file', privateKey: 'file-key', apiBase: 'https://file.test', token: 'file-token' },
  });
  assert.equal(resolved.keyId, 'from-config');
  assert.equal(resolved.privateKey, 'from-credential');
  assert.equal(resolved.apiBase, 'https://env.test');
  assert.equal(resolved.token, 'file-token');
  assert.equal(resolved.authUrl, 'https://public-api-m.rustore.ru/public/auth/');
  assert.equal(resolved.timeoutMs, 5000);
});

test('describeConfig не показывает секреты целиком', () => {
  const resolved = resolveConfig({
    config: { keyId: '42', privateKey: 'abcdefghijklmnopqrstuvwxyz', token: 'token-value-1234567' },
    env: {},
    file: {},
  });
  const described = describeConfig(resolved);
  assert.equal(described.authMode, 'token');
  assert.equal(JSON.stringify(described).includes('abcdefghijklmnopqrstuvwxyz'), false);
  assert.equal(JSON.stringify(described).includes('token-value-1234567'), false);
  assert.equal(described.keyId, '42');
});

test('writeSettings/readSettings: слияние и удаление пустым значением', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rustore-'));
  const file = path.join(dir, 'rustore.json');
  await writeSettings(file, { keyId: '42', token: 'abc' });
  await writeSettings(file, { token: '', companyId: '7' });
  const content = await readSettings(file);
  assert.deepEqual(content, { keyId: '42', companyId: '7' });
  await fs.rm(dir, { recursive: true, force: true });
});

test('RuStoreClient: токен кэшируется и не запрашивается на каждый вызов', async () => {
  const { base64 } = keyPair();
  let authCalls = 0;
  const fetchImpl = async (url) => {
    if (String(url).includes('/public/auth/')) {
      authCalls++;
      return new Response(JSON.stringify(ENVELOPE({ jwe: 'jwe-1', ttl: 900 })), { status: 200 });
    }
    return new Response(JSON.stringify(ENVELOPE({ content: [] })), { status: 200 });
  };
  let clock = new Date('2026-10-31T10:00:00Z');
  const client = new RuStoreClient(
    { keyId: '42', privateKey: base64, apiBase: 'https://api.test', authUrl: 'https://auth.test/public/auth/', timeoutMs: 1000 },
    { fetchImpl, now: () => clock },
  );
  await client.request({ path: '/public/v1/application' });
  await client.request({ path: '/public/v1/application' });
  assert.equal(authCalls, 1);

  clock = new Date('2026-10-31T10:20:00Z');
  await client.request({ path: '/public/v1/application' });
  assert.equal(authCalls, 2, 'после истечения ttl токен запрашивается заново');
});

test('RuStoreClient: код ответа не OK превращается в ошибку с кодом и телом', async () => {
  const fetchImpl = async () => new Response(JSON.stringify({ code: 'ApplicationNotFound', message: 'not found', body: null }), { status: 200 });
  const client = new RuStoreClient(
    { token: 't', apiBase: 'https://api.test', authUrl: 'https://auth.test', timeoutMs: 1000 },
    { fetchImpl },
  );
  await assert.rejects(() => client.request({ path: '/public/v1/application/x/version/1' }), (error) => {
    assert.equal(error.code, 'ApplicationNotFound');
    assert.match(error.message, /not found/);
    return true;
  });
});

test('RuStoreClient: 401 обновляет выписанный токен и повторяет запрос', async () => {
  const { base64 } = keyPair();
  let authCalls = 0;
  let dataCalls = 0;
  const fetchImpl = async (url) => {
    if (String(url).includes('/public/auth/')) {
      authCalls++;
      return new Response(JSON.stringify(ENVELOPE({ jwe: `jwe-${authCalls}`, ttl: 900 })), { status: 200 });
    }
    dataCalls++;
    if (dataCalls === 1) return new Response(JSON.stringify({ code: 'UNAUTHORIZED', message: 'expired' }), { status: 401 });
    return new Response(JSON.stringify(ENVELOPE({ content: [{ appName: 'App' }] })), { status: 200 });
  };
  const client = new RuStoreClient(
    { keyId: '42', privateKey: base64, apiBase: 'https://api.test', authUrl: 'https://auth.test/public/auth/', timeoutMs: 1000 },
    { fetchImpl },
  );
  const result = await client.request({ path: '/public/v1/application' });
  assert.deepEqual(result, { content: [{ appName: 'App' }] });
  assert.equal(authCalls, 2);
  assert.equal(dataCalls, 2);
});

test('RuStoreClient: ответ с полем content разворачивается как тело', async () => {
  const fetchImpl = async () => new Response(JSON.stringify({ code: 'OK', content: { versionId: 55 } }), { status: 200 });
  const client = new RuStoreClient({ token: 't', apiBase: 'https://api.test', timeoutMs: 1000 }, { fetchImpl });
  const result = await client.request({ method: 'POST', path: '/public/v1/application/a/version', body: {} });
  assert.deepEqual(result, { versionId: 55 });
});

test('RuStoreClient: GET на 404 повторяется на зеркальном хосте, POST — нет', async () => {
  const hosts = [];
  const fetchImpl = async (url) => {
    hosts.push(new URL(url).host);
    if (new URL(url).host === 'public-api-m.rustore.ru') return new Response('not found', { status: 404 });
    return new Response(JSON.stringify({ code: 'OK', body: { content: [] } }), { status: 200 });
  };
  const client = new RuStoreClient(
    { token: 't', apiBase: 'https://public-api-m.rustore.ru', timeoutMs: 1000 },
    { fetchImpl },
  );
  const read = await client.request({ path: '/public/v1/application' });
  assert.deepEqual(read, { content: [] });
  assert.deepEqual(hosts, ['public-api-m.rustore.ru', 'public-api.rustore.ru']);

  hosts.length = 0;
  await assert.rejects(
    () => client.request({ method: 'POST', path: '/public/v1/application/a/version', body: {} }),
    /HTTP 404/,
  );
  assert.deepEqual(hosts, ['public-api-m.rustore.ru'], 'изменяющий запрос не уходит на зеркало');
});

test('набор инструментов: имена уникальны и совпадают с индексом', () => {
  const names = TOOLS.map((tool) => tool.name);
  assert.equal(new Set(names).size, names.length);
  assert.equal(TOOL_INDEX.size, names.length);
  for (const tool of TOOLS) {
    assert.equal(tool.parameters.type, 'object', `${tool.name}: корень схемы — object`);
    assert.ok(tool.description.length > 40, `${tool.name}: описание объясняет назначение`);
    assert.equal(typeof tool.run, 'function');
  }
});

test('инструменты собирают ожидаемые пути RuStore API', async () => {
  const seen = [];
  const context = {
    async api() {
      return {
        request: async (options) => {
          seen.push(options);
          return { ok: true };
        },
        upload: async (options) => {
          seen.push(options);
          return { ok: true };
        },
        uploadMany: async (options) => {
          seen.push(options);
          return { ok: true };
        },
      };
    },
  };

  await TOOL_INDEX.get('apps_list').run({ appName: 'Key', pageSize: 10 }, context);
  await TOOL_INDEX.get('draft_create').run({ packageName: 'com.example.app', minAndroidVersion: 8 }, context);
  await TOOL_INDEX.get('version_status').run({ packageName: 'com.example.app', versionId: 12 }, context);
  await TOOL_INDEX.get('send_to_moderation').run({ packageName: 'com.example.app', versionId: 12 }, context);
  await TOOL_INDEX.get('upload_aab').run({ packageName: 'com.example.app', versionId: 12, filePath: 'C:/tmp/app.aab' }, context);
  await TOOL_INDEX.get('upload_icon').run({ packageName: 'com.example.app', versionId: 12, filePath: 'C:/tmp/icon.png' }, context);
  await TOOL_INDEX.get('publish_settings').run({ packageName: 'com.example.app', versionId: 12, publishType: 'MANUAL' }, context);
  await TOOL_INDEX.get('version_archive').run({ packageName: 'com.example.app', versionId: 12 }, context);
  await TOOL_INDEX.get('manual_publish').run({ packageName: 'com.example.app', versionId: 12 }, context);

  assert.equal(seen[0].path, '/public/v1/application');
  assert.equal(seen[0].query.appName, 'Key');
  assert.equal(seen[1].path, '/public/v1/application/com.example.app/version');
  assert.equal(seen[1].method, 'POST');
  assert.equal(seen[2].path, '/public/v1/application/com.example.app/version');
  assert.equal(String(seen[2].query.ids), '12');
  assert.equal(seen[3].path, '/public/v1/application/com.example.app/version/12/commit');
  assert.equal(seen[3].query.priorityUpdate, '0');
  assert.equal(seen[4].path, '/public/v1/application/com.example.app/version/12/aab');
  assert.equal(seen[4].query.isMainApk, 'true');
  assert.equal(seen[5].path, '/public/v1/application/com.example.app/version/12/image/icon');
  assert.equal(seen[6].path, '/public/v1/application/com.example.app/version/12/publish-settings');
  assert.equal(seen[6].body.publishType, 'MANUAL');
  assert.equal(seen[7].path, '/public/v1/application/com.example.app/version/12/archive');
  assert.equal(seen[8].path, '/public/v1/application/com.example.app/version/12/publish');
});

test('draft_create передаёт в тело только допустимые поля карточки', async () => {
  const seen = [];
  const context = {
    async api() {
      return {
        request: async (options) => {
          seen.push(options);
          return { content: { versionId: 1 } };
        },
      };
    },
  };
  await TOOL_INDEX.get('draft_create').run(
    {
      packageName: 'com.example.app',
      appName: 'Моё приложение',
      appType: 'MAIN',
      categories: ['tools'],
      ageLegal: '12+',
      shortDescription: 'Кратко',
      minAndroidVersion: 8,
      лишнее: 'должно быть отброшено',
    },
    context,
  );
  assert.deepEqual(Object.keys(seen[0].body).sort(), ['ageLegal', 'appName', 'appType', 'categories', 'shortDescription']);
});

test('категории: справочник покрывает MAIN и GAMES', async () => {
  const main = await TOOL_INDEX.get('categories_list').run({ appType: 'MAIN' }, {});
  const games = await TOOL_INDEX.get('categories_list').run({ appType: 'GAMES' }, {});
  assert.ok(main.total >= 20);
  assert.ok(games.total >= 10);
  assert.ok(main.categories.every((item) => item.appType === 'MAIN'));
  assert.ok(games.categories.some((item) => item.code === 'puzzle'));
});

test('upload_screens: порядковые номера идут подряд и не выходят за 0…9', async () => {
  const seen = [];
  const context = {
    async api() {
      return {
        upload: async (options) => {
          seen.push(options);
          return { body: { id: seen.length } };
        },
      };
    },
  };
  const result = await TOOL_INDEX.get('upload_screens').run(
    { packageName: 'com.example.app', versionId: 7, filePaths: ['C:/s/1.png', 'C:/s/2.png'], startOrdinal: 2 },
    context,
  );
  assert.equal(result.uploaded, 2);
  assert.ok(seen[0].path.endsWith('/version/7/image/screenshot/PORTRAIT/2/SCREENSHOT'));
  assert.ok(seen[1].path.endsWith('/version/7/image/screenshot/PORTRAIT/3/SCREENSHOT'));
  await assert.rejects(
    () => TOOL_INDEX.get('upload_screens').run({ packageName: 'a', versionId: 7, filePaths: ['a', 'b'], startOrdinal: 9 }, context),
    /0…9/,
  );
});

test('инструменты отклоняют неполные аргументы до сетевого вызова', async () => {
  const context = { api: async () => assert.fail('сеть не должна вызываться') };
  await assert.rejects(() => TOOL_INDEX.get('upload_screens').run({ packageName: 'a', versionId: 1, filePaths: [] }, context), /filePaths/);
  await assert.rejects(() => TOOL_INDEX.get('upload_icon').run({ packageName: 'a', versionId: 1 }, context), /filePath/);
  await assert.rejects(() => TOOL_INDEX.get('draft_update').run({ packageName: 'a', versionId: 1 }, context), /fields/);
});
