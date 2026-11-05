import assert from 'node:assert/strict';
import test from 'node:test';

import { RuStoreClient } from '../lib/client.mjs';

/** Ошибка TLS, как её отдаёт fetch в среде без промежуточного сертификата. */
function tlsError() {
  const error = new TypeError('fetch failed');
  error.cause = { code: 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY' };
  return error;
}

test('сетевая ошибка TLS повторяется на зеркале, включая изменяющие запросы', async () => {
  const hosts = [];
  const fetchImpl = async (url) => {
    const host = new URL(url).host;
    hosts.push(host);
    if (host === 'public-api.rustore.ru') throw tlsError();
    return new Response(JSON.stringify({ code: 'OK', body: { versionId: 7 } }), { status: 200 });
  };
  const client = new RuStoreClient(
    { token: 't', apiBase: 'https://public-api.rustore.ru', mirrorBase: 'https://public-api-m.rustore.ru', timeoutMs: 1000 },
    { fetchImpl },
  );

  const created = await client.request({ method: 'POST', path: '/public/v1/application/a/version', body: {} });
  assert.deepEqual(created, { versionId: 7 });
  assert.deepEqual(hosts, ['public-api.rustore.ru', 'public-api-m.rustore.ru'], 'запрос не ушёл с первого хоста — повтор безопасен');
});

test('непредвиденная ошибка не повторяется на зеркале', async () => {
  const hosts = [];
  const fetchImpl = async (url) => {
    hosts.push(new URL(url).host);
    const error = new TypeError('fetch failed');
    error.cause = { code: 'ERR_STREAM_PREMATURE_CLOSE' };
    throw error;
  };
  const client = new RuStoreClient(
    { token: 't', apiBase: 'https://public-api.rustore.ru', mirrorBase: 'https://public-api-m.rustore.ru', timeoutMs: 1000 },
    { fetchImpl },
  );
  await assert.rejects(() => client.request({ method: 'POST', path: '/public/v1/application/a/version', body: {} }), /fetch failed/);
  assert.deepEqual(hosts, ['public-api.rustore.ru'], 'неясная ошибка не должна задваивать изменяющую операцию');
});

test('основной адрес по умолчанию — доступный хост, зеркало — второй', async () => {
  const { DEFAULT_API_BASE, DEFAULT_AUTH_URL, resolveConfig } = await import('../lib/settings.mjs');
  assert.equal(DEFAULT_API_BASE, 'https://public-api.rustore.ru');
  assert.equal(DEFAULT_AUTH_URL, 'https://public-api.rustore.ru/public/auth/');
  const resolved = resolveConfig({ config: {}, env: {}, file: {} });
  const client = new RuStoreClient(resolved);
  assert.equal(client.mirrorBase, 'https://public-api-m.rustore.ru');
});
