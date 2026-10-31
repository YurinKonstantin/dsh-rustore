import assert from 'node:assert/strict';
import test from 'node:test';

import { apply, inject, name } from '../index.js';
import { TOOLS } from '../lib/tools.mjs';

/** Реестр-заглушка повторяет контракт `ctx.tools.register` из DSH. */
function fakeRegistry() {
  const registered = [];
  return {
    registered,
    register(definition) {
      registered.push(definition);
    },
  };
}

test('плагин объявляет имя и зависимость от реестра инструментов', () => {
  assert.equal(name, 'rustore');
  assert.deepEqual(inject, ['tools', 'webServer']);
});

test('apply регистрирует по инструменту на каждое определение, с префиксом rustore_', () => {
  const tools = fakeRegistry();
  const ctx = {
    tools,
    get: (service) => (service === 'credentials' ? { resolve: async () => ({ value: null }) } : undefined),
  };

  apply(ctx, {});

  assert.equal(tools.registered.length, TOOLS.length);
  const names = tools.registered.map((item) => item.name);
  assert.equal(new Set(names).size, names.length);
  for (const definition of tools.registered) {
    assert.match(definition.name, /^rustore_[a-z_]+$/, definition.name);
    assert.equal(definition.parameters.type, 'object');
    assert.ok(definition.description.length > 40);
    assert.equal(typeof definition.execute, 'function');
    assert.equal(typeof definition.output.render, 'function');
  }
  assert.ok(names.includes('rustore_auth_check'));
  assert.ok(names.includes('rustore_upload_aab'));
  assert.ok(names.includes('rustore_settings_set'));
});

test('render отдаёт текстовый блок, а не сырой объект', () => {
  const tools = fakeRegistry();
  const ctx = { tools, get: () => undefined };
  apply(ctx, {});
  const definition = tools.registered.find((item) => item.name === 'rustore_categories_list');
  const blocks = definition.output.render({}, { total: 40 });
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, 'text');
  assert.match(blocks[0].text, /40/);
});

test('execute без настроек возвращает понятную ошибку конфигурации, а не падение процесса', async () => {
  const tools = fakeRegistry();
  const ctx = { tools, get: () => undefined };
  apply(ctx, { settingsFile: 'Z:/definitely/missing/rustore.json' });
  const definition = tools.registered.find((item) => item.name === 'rustore_auth_check');
  await assert.rejects(() => definition.execute({}), /CONFIG|не настроен|ENOENT|not found|не найден/i);
});

