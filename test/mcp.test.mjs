import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import { createHandler, runStdio } from '../mcp/server.mjs';
import { createToolContext } from '../lib/context.mjs';

/** Контекст, который никуда не ходит: инструменты подменены заглушкой. */
function fakeContext() {
  return createToolContext({ config: {}, env: {}, fetchImpl: async () => assert.fail('сеть в тестах протокола не нужна') });
}

const tools = [
  {
    name: 'echo',
    title: 'Эхо',
    description: 'Возвращает переданное значение.',
    parameters: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] },
    async run(args) {
      return { value: args.value };
    },
  },
  {
    name: 'boom',
    title: 'Ошибка',
    description: 'Всегда падает.',
    parameters: { type: 'object', properties: {} },
    async run() {
      throw new Error('внутренняя поломка');
    },
  },
];

test('initialize отвечает версией протокола и возможностями tools', async () => {
  const handle = createHandler({ context: fakeContext(), tools, log: () => {} });
  const response = await handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
  assert.equal(response.result.protocolVersion, '2025-06-18');
  assert.deepEqual(response.result.capabilities, { tools: { listChanged: false } });
  assert.equal(response.result.serverInfo.name, 'rustore');
});

test('initialize согласовывает неизвестную версию протокола', async () => {
  const handle = createHandler({ context: fakeContext(), tools, log: () => {} });
  const response = await handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2000-01-01' } });
  assert.equal(response.result.protocolVersion, '2025-06-18');
});

test('tools/list отдаёт JSON Schema, понятную MCP-клиенту', async () => {
  const handle = createHandler({ context: fakeContext(), tools, log: () => {} });
  const response = await handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  const listed = response.result.tools;
  assert.equal(listed.length, 2);
  assert.equal(listed[0].name, 'echo');
  assert.equal(listed[0].inputSchema.type, 'object');
  assert.deepEqual(listed[0].inputSchema.required, ['value']);
});

test('tools/call возвращает текстовый блок с JSON', async () => {
  const handle = createHandler({ context: fakeContext(), tools, log: () => {} });
  const response = await handle({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'echo', arguments: { value: 'привет' } } });
  assert.equal(response.result.isError, false);
  assert.equal(response.result.content[0].type, 'text');
  assert.match(response.result.content[0].text, /привет/);
});

test('tools/call: падение инструмента — это результат isError, а не сбой протокола', async () => {
  const handle = createHandler({ context: fakeContext(), tools, log: () => {} });
  const response = await handle({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'boom', arguments: {} } });
  assert.equal(response.result.isError, true);
  assert.match(response.result.content[0].text, /внутренняя поломка/);
  assert.equal(response.error, undefined);
});

test('tools/call неизвестного инструмента — ошибка метода -32602', async () => {
  const handle = createHandler({ context: fakeContext(), tools, log: () => {} });
  const response = await handle({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'nope', arguments: {} } });
  assert.equal(response.error.code, -32602);
});

test('неизвестный метод — -32601, уведомление без id — без ответа', async () => {
  const handle = createHandler({ context: fakeContext(), tools, log: () => {} });
  const response = await handle({ jsonrpc: '2.0', id: 6, method: 'resources/read', params: {} });
  assert.equal(response.error.code, -32601);
  const notification = await handle({ jsonrpc: '2.0', method: 'notifications/initialized' });
  assert.equal(notification, null);
});

test('runStdio читает построчные JSON-RPC сообщения и пишет ответы', async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const chunks = [];
  output.on('data', (chunk) => chunks.push(chunk.toString()));

  const done = runStdio({ context: fakeContext(), tools, input, output });
  input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } })}\n`);
  input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })}\n`);
  input.write('не json\n');
  input.end();
  await done;

  const lines = chunks.join('').trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(lines.length, 3);
  assert.equal(lines[0].result.serverInfo.name, 'rustore');
  assert.equal(lines[1].result.tools.length, 2);
  assert.equal(lines[2].error.code, -32700);
});
