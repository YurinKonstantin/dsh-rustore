import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFile(path.join(root, 'client.js'), 'utf8');

/** Минимальная заглушка React: компоненты не рендерим, проверяем регистрацию. */
const React = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  Fragment: Symbol('Fragment'),
  useCallback: (fn) => fn,
  useEffect: () => {},
  useMemo: (fn) => fn(),
  useState: (initial) => [initial, () => {}],
};

/**
 * Загрузить client.js в изолированный контекст и вернуть его exports.
 *
 * @returns {Promise<object>} экспорты плагина.
 */
async function loadClient() {
  let definition;
  const window = { __ModuleLoader__: { load: (value) => (definition = value) } };
  const context = vm.createContext({ window, console, fetch: async () => assert.fail('сеть не нужна') });
  vm.runInContext(await source, context);
  assert.ok(definition, 'client.js должен вызвать window.__ModuleLoader__.load');
  return definition.factory((name) => {
    if (name === 'react') return React;
    throw new Error(`неизвестный модуль: ${name}`);
  });
}

test('клиент объявляет id пакета и зависит только от slots', async () => {
  let definition;
  const window = { __ModuleLoader__: { load: (value) => (definition = value) } };
  const context = vm.createContext({ window, console });
  vm.runInContext(await source, context);
  assert.equal(definition.id, 'dsh-rustore');
  const exports = definition.factory(() => React);
  assert.equal(Array.from(exports.inject).join(','), 'slots', 'клиент зависит только от slots');
  assert.equal(typeof exports.apply, 'function');
});

test('страница регистрируется под ключами менеджера плагинов', async () => {
  const exported = await loadClient();
  const registered = [];
  const injected = [];
  const ctx = {
    effect(register) {
      register();
      return () => {};
    },
    get(name) {
      if (name !== 'slots') return undefined;
      return {
        inject(slot, register) {
          injected.push(slot);
          register();
          return () => {};
        },
        register(options, component) {
          registered.push({ options, component });
          return () => {};
        },
      };
    },
  };

  exported.apply(ctx);

  assert.deepEqual(injected, ['plugins.row.config', 'plugins.bundle.config', 'plugins.item']);
  const bySlot = new Map(registered.map((entry) => [`${entry.options.name}|${entry.options.key}`, entry]));
  assert.ok(bySlot.has('plugins.row.config|dsh-rustore#rustore'), 'строка настроек ищется по ключу <пакет>#<id строки>');
  assert.ok(bySlot.has('plugins.bundle.config|dsh-rustore'), 'страница пакета ищется по имени пакета');
  assert.ok(bySlot.has('plugins.item|dsh-rustore'), 'карточка в списке плагинов');
});

test('summary-вид возвращает текст, полный — React-элемент страницы', async () => {
  const exported = await loadClient();
  const registered = [];
  const ctx = {
    effect: (register) => (register(), () => {}),
    get: () => ({
      inject: (_slot, register) => (register(), () => {}),
      register: (options, component) => (registered.push({ options, component }), () => {}),
    }),
  };
  exported.apply(ctx);
  const { component } = registered[0];
  const summary = component({ view: 'summary' });
  assert.equal(typeof summary, 'string');
  assert.match(summary, /RuStore/);
  const page = component({ view: 'page' });
  assert.equal(typeof page, 'object');
  assert.equal(page.type.name, 'RuStoreSettings');
});

test('без сервиса slots плагин не падает', async () => {
  const exported = await loadClient();
  const ctx = {
    effect: (register) => (register(), () => {}),
    get: () => undefined,
  };
  assert.doesNotThrow(() => exported.apply(ctx));
});
