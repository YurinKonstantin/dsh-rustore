import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { ROUTE_PREFIX, registerSettingsRoutes } from '../lib/routes.mjs';
import { createToolContext } from '../lib/context.mjs';

/** Контекст с подставными настройками и API: маршруты проверяются без сети. */
function fakeContext({ initial = {} } = {}) {
  let stored = { ...initial };
  return {
    context: {
      settingsPath: 'C:/tmp/rustore.json',
      async settings() {
        return {
          keyId: stored.keyId ?? '',
          companyId: '',
          apiBase: stored.apiBase ?? 'https://public-api-m.rustore.ru',
          mirrorBase: 'https://public-api.rustore.ru',
          authUrl: 'https://public-api-m.rustore.ru/public/auth/',
          privateKeyRef: 'RUSTORE_PRIVATE_KEY',
          timeoutMs: 120000,
          privateKey: stored.privateKey ?? '',
          token: stored.token ?? '',
        };
      },
      async save(patch) {
        for (const [key, value] of Object.entries(patch)) {
          if (value === '') delete stored[key];
          else stored[key] = value;
        }
        return stored;
      },
      async api() {
        return {
          async getToken() {
            if (!stored.keyId && !stored.token) throw new Error('нет ключа');
            return 'jwe-token-abcdef';
          },
          async request() {
            return { content: [{ appName: 'App' }] };
          },
        };
      },
    },
  };
}

/** Поднять реальный HTTP-сервер поверх зарегистрированных маршрутов. */
async function withServer(routes, run) {
  const handlers = new Map(routes.map((entry) => [entry.path, entry.handler]));
  const server = http.createServer((req, res) => {
    const handler = handlers.get(new URL(req.url, 'http://localhost').pathname);
    if (!handler) {
      res.statusCode = 404;
      res.end('not found');
      return;
    }
    handler(req, res).catch((error) => {
      res.statusCode = 500;
      res.end(String(error));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('маршруты получают префикс и по одному обработчику на путь', () => {
  const { context } = fakeContext();
  const routes = [];
  const webCtx = { webServer: { register: (route) => (routes.push(route), () => {}) } };
  const disposers = registerSettingsRoutes(webCtx, context);
  assert.equal(routes.length, 2);
  assert.deepEqual(routes.map((route) => route.path), [`${ROUTE_PREFIX}/settings`, `${ROUTE_PREFIX}/check`]);
  assert.equal(disposers.length, 2);
  for (const route of routes) assert.equal(route.kind, 'exact');
});

test('GET /settings отдаёт состояние без секретов', async () => {
  const { context } = fakeContext({ initial: { keyId: '354751', privateKey: 'secret-key' } });
  const routes = [];
  const disposers = registerSettingsRoutes({ webServer: { register: (route) => (routes.push(route), () => {}) } }, context);
  await withServer(routes, async (base) => {
    const response = await fetch(`${base}${ROUTE_PREFIX}/settings`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.keyId, '354751');
    assert.equal(body.hasPrivateKey, true);
    assert.equal(body.hasToken, false);
    assert.equal(body.authMode, 'keyId+privateKey');
    assert.equal(JSON.stringify(body).includes('secret-key'), false, 'ключ не должен уходить в ответ');
  });
  for (const dispose of disposers) dispose();
});

test('POST /settings сохраняет значения и не перезаписывает секрет пустой строкой', async () => {
  const { context } = fakeContext({ initial: { keyId: 'old', privateKey: 'existing' } });
  const routes = [];
  registerSettingsRoutes({ webServer: { register: (route) => (routes.push(route), () => {}) } }, context);
  await withServer(routes, async (base) => {
    const saved = await fetch(`${base}${ROUTE_PREFIX}/settings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ keyId: 'new-id', privateKey: '', apiBase: 'https://api.example' }),
    });
    assert.equal(saved.status, 200);
    const body = await saved.json();
    assert.equal(body.keyId, 'new-id');
    assert.equal(body.apiBase, 'https://api.example');
    assert.equal(body.hasPrivateKey, true, 'пустое поле ключа не стирает сохранённый ключ');

    const cleared = await fetch(`${base}${ROUTE_PREFIX}/settings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clear: 'privateKey' }),
    });
    assert.equal((await cleared.json()).hasPrivateKey, false);
  });
});

test('POST /settings отвергает тело без полей и неверный метод', async () => {
  const { context } = fakeContext();
  const routes = [];
  registerSettingsRoutes({ webServer: { register: (route) => (routes.push(route), () => {}) } }, context);
  await withServer(routes, async (base) => {
    const empty = await fetch(`${base}${ROUTE_PREFIX}/settings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    assert.equal(empty.status, 400);
    const wrongMethod = await fetch(`${base}${ROUTE_PREFIX}/settings`, { method: 'DELETE' });
    assert.equal(wrongMethod.status, 405);
  });
});

test('POST /check сообщает результат проверки и не падает на отсутствии ключа', async () => {
  const withoutKey = fakeContext();
  const routes = [];
  registerSettingsRoutes({ webServer: { register: (route) => (routes.push(route), () => {}) } }, withoutKey.context);
  await withServer(routes, async (base) => {
    const failed = await fetch(`${base}${ROUTE_PREFIX}/check`, { method: 'POST' });
    const failedBody = await failed.json();
    assert.equal(failed.status, 200);
    assert.equal(failedBody.ok, false);
    assert.match(failedBody.error, /ключ/);
  });

  const withKey = fakeContext({ initial: { keyId: '42', privateKey: 'k' } });
  const routes2 = [];
  registerSettingsRoutes({ webServer: { register: (route) => (routes2.push(route), () => {}) } }, withKey.context);
  await withServer(routes2, async (base) => {
    const ok = await fetch(`${base}${ROUTE_PREFIX}/check`, { method: 'POST' });
    const body = await ok.json();
    assert.equal(body.ok, true);
    assert.equal(body.appsVisible, 1);
    assert.match(body.tokenPrefix, /^jwe-token-ab/);
  });
});

test('контекст инструментов отдаёт файл настроек в описании для формы', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rustore-routes-'));
  const context = createToolContext({
    config: { settingsFile: path.join(dir, 'rustore.json') },
    env: {},
    fetchImpl: async () => assert.fail('сеть не нужна'),
  });
  const described = await context.describe();
  assert.equal(typeof described.settingsPath, 'string');
  assert.equal(described.authMode, 'none');
  await fs.rm(dir, { recursive: true, force: true });
});
