/**
 * Host-половина плагина RuStore для DSH.
 *
 * Регистрирует инструменты `rustore_*` в реестре инструментов и берёт
 * настройки из конфигурации строки плагина (`cordis.patch.yml`), хранилища
 * секретов DSH и файла `~/.dsh/rustore.json`. Тот же набор инструментов
 * доступен как самостоятельный MCP-сервер: `node mcp/server.mjs`.
 *
 * @module dsh-rustore
 */

import { createToolContext } from './lib/context.mjs';
import { asText } from './lib/errors.mjs';
import { registerSettingsRoutes } from './lib/routes.mjs';
import { TOOLS } from './lib/tools.mjs';

/** Имя плагина для загрузчика. */
export const name = 'rustore';

/** Плагину нужен реестр инструментов и HTTP-сервер для страницы настроек. */
export const inject = ['tools', 'webServer'];

/**
 * Достать приватный ключ RuStore из хранилища секретов DSH.
 *
 * @param {object} ctx - контекст плагина.
 * @param {string} ref - имя секрета, например `RUSTORE_PRIVATE_KEY`.
 * @returns {Promise<string|null>} значение секрета или `null`.
 */
async function resolveCredential(ctx, ref) {
  const credentials = ctx.get('credentials');
  if (!credentials || !ref) return null;
  try {
    const resolved = await credentials.resolve(ref);
    return resolved?.value ? String(resolved.value) : null;
  } catch {
    return null;
  }
}

/**
 * Зарегистрировать инструменты RuStore.
 *
 * @param {object} ctx - контекст плагина.
 * @param {object} [config] - конфигурация строки плагина.
 */
export function apply(ctx, config = {}) {
  const context = createToolContext({
    config,
    env: process.env,
    credentialProvider: () => resolveCredential(ctx, config.privateKeyRef ?? 'RUSTORE_PRIVATE_KEY'),
  });

  for (const tool of TOOLS) {
    ctx.tools.register({
      name: `rustore_${tool.name}`,
      description: tool.description,
      parameters: tool.parameters,
      output: {
        schema: { type: 'object' },
        render: (_args, value) => [{ type: 'text', text: asText(value) }],
      },
      async execute(args) {
        return tool.run(args ?? {}, context);
      },
    });
  }

  // Страница настроек в Web UI (и в десктопном окне) общается с Host по HTTP.
  // `webServer` объявлен в inject, поэтому сервис доступен уже на этом шаге.
  const disposers = registerSettingsRoutes(ctx, context);
  ctx.effect?.(() => () => {
    for (const dispose of disposers) {
      try {
        dispose?.();
      } catch {
        // маршрут мог быть снят вместе с сервером
      }
    }
  });
}
