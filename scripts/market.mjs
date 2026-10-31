// Пересобрать market.json — индекс магазина плагинов DSH (формат 1).
//
// Индекс публикуется вместе с репозиторием, поэтому версия в нём указывает на
// конкретный коммит: ставится ровно тот код, который был проверен.
//
//   node scripts/market.mjs            # записать market.json
//   node scripts/market.mjs --print    # показать, не записывая
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// PowerShell и часть редакторов сохраняют JSON с BOM — снимаем его, иначе
// JSON.parse падает на первом символе.
const pkgRaw = fs.readFileSync(path.join(root, 'package.json'), 'utf8').replace(/^\uFEFF/, '');
const pkg = JSON.parse(pkgRaw);
const repo = 'https://github.com/YurinKonstantin/dsh-rustore';

/**
 * Коммит, на который ссылается индекс. `MARKET_COMMIT` позволяет задать его
 * явно — в средах, где вызов git из Node запрещён (песочница, CI без git).
 *
 * @returns {string} 40-символьный SHA.
 */
function resolveCommit() {
  const explicit = process.env.MARKET_COMMIT?.trim();
  if (explicit) return explicit;
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    throw new Error('Не удалось определить коммит: задайте MARKET_COMMIT=<sha> (git rev-parse HEAD).');
  }
}

const commit = resolveCommit();
const raw = `https://raw.githubusercontent.com/YurinKonstantin/dsh-rustore/${commit}`;

/**
 * Время публикации версии в Unix-секундах (требование формата индекса).
 * `MARKET_TIMESTAMP` позволяет зафиксировать значение при повторной сборке.
 *
 * @returns {number} целые секунды.
 */
function publishTimestamp() {
  const explicit = Number(process.env.MARKET_TIMESTAMP);
  return Number.isInteger(explicit) && explicit > 0 ? explicit : Math.floor(Date.now() / 1000);
}

const index = {
  format: 1,
  title: { en: 'RuStore plugins', ru: 'Плагины RuStore' },
  description: {
    en: 'DeepSeek Harness plugins published by Konstantin Yurin.',
    ru: 'Плагины DeepSeek Harness от Константина Юрина.',
  },
  metadata: {
    categories: {
      publishing: { title: { en: 'Publishing', ru: 'Публикация' } },
    },
    labels: {
      rustore: { title: { en: 'RuStore', ru: 'RuStore' } },
      mcp: { title: { en: 'MCP server', ru: 'MCP-сервер' } },
    },
  },
  plugins: [
    {
      name: pkg.name,
      title: { en: 'RuStore', ru: 'RuStore' },
      description: {
        en: 'Publish Android apps to RuStore: draft version, AAB/APK upload, icon and screenshots, moderation, manual publishing, plus the rustore skill and a standalone MCP server.',
        ru: 'Публикация Android-приложений в RuStore: черновик версии, загрузка AAB/APK, иконки и скриншотов, модерация, ручная публикация, плюс навык rustore и отдельный MCP-сервер.',
      },
      icon: `${raw}/icon.svg`,
      homepage: `${repo}#readme`,
      repository: { url: repo },
      metadata: {
        category: 'publishing',
        keywords: ['rustore', 'android', 'publishing', 'aab', 'apk', 'mcp'],
        labels: ['rustore', 'mcp'],
      },
      versions: [
        {
          version: pkg.version,
          publishTimestamp: publishTimestamp(),
          source: { type: 'git', url: repo, commit },
          engines: { dsh: '>=0.2.0' },
        },
      ],
    },
  ],
};

const serialized = `${JSON.stringify(index, null, 2)}\n`;
if (process.argv.includes('--print')) {
  process.stdout.write(serialized);
} else {
  fs.writeFileSync(path.join(root, 'market.json'), serialized, 'utf8');
  console.log(`market.json: ${pkg.name}@${pkg.version} -> ${commit}`);
}
