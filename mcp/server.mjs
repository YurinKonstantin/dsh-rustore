#!/usr/bin/env node
/**
 * Standalone MCP-сервер RuStore (stdio, JSON-RPC 2.0, построчные сообщения).
 *
 * Реализация без внешних зависимостей: тот же набор инструментов, что
 * регистрирует плагин DSH, доступен любому MCP-клиенту (DSH через
 * `@deepseek-ai/dsh-mcp-client`, Cursor, Claude Desktop, CI-скрипт).
 *
 * Настройки берутся из переменных окружения `RUSTORE_*` и файла
 * `%USERPROFILE%\.dsh\rustore.json`; инструменты `settings_get`/`settings_set`
 * читают и пишут этот файл.
 *
 * Запуск: `node mcp/server.mjs` (транспорт stdio, stdout занят протоколом,
 * диагностика идёт в stderr).
 *
 * @module dsh-rustore/mcp-server
 */

import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

import { createToolContext } from '../lib/context.mjs';
import { RuStoreError } from '../lib/errors.mjs';
import { TOOLS, TOOL_INDEX } from '../lib/tools.mjs';
import pkg from '../package.json' with { type: 'json' };

/** Версии протокола, которые понимает сервер (свежая первой). */
export const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

/** Версия сервера из манифеста пакета. */
export const SERVER_VERSION = pkg.version;

/**
 * Описание инструмента в формате MCP.
 *
 * @param {object} tool - определение инструмента.
 * @returns {object} `tools/list`-элемент.
 */
function describeTool(tool) {
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.parameters,
    annotations: tool.annotations ?? {},
  };
}

/**
 * Создать обработчик сообщений.
 *
 * @param {object} options - зависимости.
 * @param {object} options.context - контекст инструментов (`createToolContext`).
 * @param {object[]} [options.tools] - набор инструментов.
 * @param {(chunk: string) => void} [options.log] - вывод диагностики.
 * @returns {(message: object) => Promise<object|null>} обработчик JSON-RPC.
 */
export function createHandler({ context, tools = TOOLS, log = (chunk) => process.stderr.write(chunk) }) {
  const index = new Map(tools.map((tool) => [tool.name, tool]));
  let initialized = false;

  return async function handle(message) {
    const { id, method, params } = message ?? {};
    const isNotification = id === undefined || id === null;

    switch (method) {
      case 'initialize': {
        initialized = true;
        const requested = params?.protocolVersion;
        const protocolVersion = PROTOCOL_VERSIONS.includes(requested) ? requested : PROTOCOL_VERSIONS[0];
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion,
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: 'rustore', title: 'RuStore Publishing API', version: SERVER_VERSION },
            instructions:
              'Инструменты RuStore Publishing API: список приложений, черновик версии, загрузка AAB/APK, ' +
              'иконки и скриншотов, настройки публикации, статус версии, модерация и публикация. ' +
              'Настройки — rustore settings_get / settings_set.',
          },
        };
      }
      case 'notifications/initialized':
      case 'notifications/cancelled':
      case 'notifications/roots/list_changed':
        return null;
      case 'ping':
        return { jsonrpc: '2.0', id, result: {} };
      case 'tools/list':
        return { jsonrpc: '2.0', id, result: { tools: tools.map(describeTool) } };
      case 'tools/call': {
        const name = params?.name;
        const tool = index.get(name) ?? TOOL_INDEX.get(name);
        if (!tool) {
          return {
            jsonrpc: '2.0',
            id,
            error: { code: -32602, message: `Неизвестный инструмент: ${name}` },
          };
        }
        const args = params?.arguments ?? {};
        try {
          const value = await tool.run(args, context);
          return {
            jsonrpc: '2.0',
            id,
            result: { content: [{ type: 'text', text: stringify(value) }], isError: false },
          };
        } catch (error) {
          const known = error instanceof RuStoreError;
          const text = known
            ? `Ошибка RuStore (${error.code}): ${error.message}`
            : `Ошибка: ${error instanceof Error ? error.message : String(error)}`;
          log(`[rustore] ${name}: ${text}\n`);
          return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }], isError: true } };
        }
      }
      case 'resources/list':
        return { jsonrpc: '2.0', id, result: { resources: [] } };
      case 'resources/templates/list':
        return { jsonrpc: '2.0', id, result: { resourceTemplates: [] } };
      case 'prompts/list':
        return { jsonrpc: '2.0', id, result: { prompts: [] } };
      case 'logging/setLevel':
        return { jsonrpc: '2.0', id, result: {} };
      default:
        if (isNotification) {
          log(`[rustore] неизвестное уведомление: ${method}\n`);
          return null;
        }
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Метод не поддерживается: ${method}` },
        };
    }
  };
}

/**
 * Сериализовать результат инструмента для текстового блока.
 *
 * @param {unknown} value - значение, возвращённое инструментом.
 * @returns {string} JSON или строка.
 */
export function stringify(value) {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/**
 * Поднять сервер на stdio и читать построчные JSON-RPC сообщения.
 *
 * @param {object} [options] - параметры.
 * @param {object} [options.context] - заранее созданный контекст.
 * @param {object[]} [options.tools] - набор инструментов (по умолчанию `TOOLS`).
 * @param {NodeJS.ReadableStream} [options.input] - stdin-подобный поток.
 * @param {NodeJS.WritableStream} [options.output] - stdout-подобный поток.
 * @returns {Promise<void>} завершается при закрытии входа.
 */
export async function runStdio({
  context = createToolContext({}),
  tools = TOOLS,
  input = process.stdin,
  output = process.stdout,
} = {}) {
  const handle = createHandler({ context, tools });
  const lines = createInterface({ input, crlfDelay: Infinity });

  for await (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let message;
    try {
      message = JSON.parse(trimmed);
    } catch (error) {
      output.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: `Некорректный JSON: ${error.message}` } })}\n`);
      continue;
    }
    if (Array.isArray(message)) {
      const responses = (await Promise.all(message.map((item) => handle(item)))).filter(Boolean);
      if (responses.length) output.write(`${JSON.stringify(responses)}\n`);
      continue;
    }
    const response = await handle(message);
    if (response) output.write(`${JSON.stringify(response)}\n`);
  }
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : '';
const isMain = entry !== '' && entry === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  runStdio().catch((error) => {
    process.stderr.write(`[rustore] фатальная ошибка: ${error?.stack ?? error}\n`);
    process.exitCode = 1;
  });
}
