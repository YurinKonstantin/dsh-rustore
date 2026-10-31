/**
 * Контекст выполнения инструментов RuStore.
 *
 * Один контекст обслуживает и DSH-плагин, и standalone MCP-сервер: он
 * собирает эффективные настройки из переданного `config`, окружения и файла,
 * лениво создаёт HTTP-клиент и умеет перечитывать настройки после их записи
 * инструментом `settings_set`.
 *
 * @module dsh-rustore/lib/context
 */

import { RuStoreClient } from './client.mjs';
import { describeConfig, defaultSettingsPath, readSettings, resolveConfig, writeSettings } from './settings.mjs';

/**
 * @typedef {object} ToolContextOptions
 * @property {object} [config] - конфигурация строки плагина (`cordis.patch.yml`).
 * @property {NodeJS.ProcessEnv} [env] - окружение процесса.
 * @property {string|null} [credentialPrivateKey] - ключ из хранилища секретов DSH.
 * @property {(() => Promise<string|null>)|null} [credentialProvider] - ленивое чтение ключа из хранилища DSH.
 * @property {typeof fetch} [fetchImpl] - подмена fetch для тестов.
 */

/**
 * Создать контекст инструментов.
 *
 * @param {ToolContextOptions} [options] - источники настроек.
 * @returns {object} контекст с ленивой инициализацией.
 */
export function createToolContext({
  config = {},
  env = process.env,
  credentialPrivateKey = null,
  credentialProvider = null,
  fetchImpl = fetch,
} = {}) {
  /** @type {{resolved: object, file: object} | null} */
  let state = null;
  /** @type {RuStoreClient | null} */
  let client = null;

  const readCredential = async () => {
    if (credentialPrivateKey) return credentialPrivateKey;
    if (!credentialProvider) return null;
    try {
      const value = await credentialProvider();
      return typeof value === 'string' && value.trim() ? value.trim() : null;
    } catch {
      return null;
    }
  };

  const load = async () => {
    const settingsPath = config.settingsFile?.trim() || defaultSettingsPath(env);
    const file = await readSettings(settingsPath);
    const resolved = resolveConfig({ config, env, file, credentialPrivateKey: await readCredential() });
    state = { resolved, file, settingsPath };
    client = null;
    return state;
  };

  return {
    env,
    fetchImpl,

    /** @returns {Promise<object>} эффективные настройки. */
    async settings() {
      return (await load()).resolved;
    },

    /**
     * Готовый HTTP-клиент с текущими настройками.
     *
     * @returns {Promise<RuStoreClient>} клиент.
     */
    async api() {
      const { resolved } = await load();
      if (!client) client = new RuStoreClient(resolved, { fetchImpl });
      return client;
    },

    /** @returns {Promise<object>} безопасное описание настроек для модели. */
    async describe() {
      const { resolved, settingsPath } = await load();
      return { ...describeConfig(resolved), settingsPath };
    },

    /**
     * Записать настройки в файл и сбросить клиент.
     *
     * @param {object} patch - изменяемые поля; пустая строка удаляет поле.
     * @returns {Promise<object>} новое безопасное описание настроек.
     */
    async save(patch) {
      const settingsPath = config.settingsFile?.trim() || defaultSettingsPath(env);
      await writeSettings(settingsPath, patch);
      state = null;
      client = null;
      return this.describe();
    },

    /** @returns {string} путь к файлу настроек. */
    get settingsPath() {
      return config.settingsFile?.trim() || defaultSettingsPath(env);
    },
  };
}
