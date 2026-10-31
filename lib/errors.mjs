/**
 * Ошибки RuStore Publishing API.
 *
 * Публичный API отвечает конвертом `{ code, message, body, timestamp }`:
 * успех — `code: "OK"`, любое отклонение приходит с собственным кодом и
 * человекочитаемым `message`. Клиент превращает это в `RuStoreError`, чтобы
 * инструмент отдавал модели код и текст, а не «HTTP 400».
 *
 * @module dsh-rustore/lib/errors
 */

/** Ошибка вызова RuStore API или локальной конфигурации плагина. */
export class RuStoreError extends Error {
  /**
   * @param {string} message - что пошло не так, по-русски, без секретов.
   * @param {object} [details] - машинные подробности для модели и логов.
   * @param {string} [details.code] - код ответа RuStore или локальный код.
   * @param {number} [details.status] - HTTP-статус, если ответ пришёл.
   * @param {unknown} [details.body] - тело ответа без секретов.
   */
  constructor(message, details = {}) {
    super(message);
    this.name = 'RuStoreError';
    this.code = details.code ?? 'RUSTORE_ERROR';
    this.status = details.status;
    this.body = details.body;
  }

  /** @returns {object} безопасное для модели представление ошибки. */
  toJSON() {
    return {
      error: this.message,
      code: this.code,
      status: this.status,
      body: this.body,
    };
  }
}

/** Конфигурация неполная: нет ключа, нет токена, файл не найден. */
export class RuStoreConfigError extends RuStoreError {
  /**
   * @param {string} message - чего именно не хватает и где это задать.
   */
  constructor(message) {
    super(message, { code: 'CONFIG' });
    this.name = 'RuStoreConfigError';
  }
}

/**
 * Ограничить произвольный ответ API, чтобы не тащить мегабайты в контекст.
 *
 * @param {unknown} value - значение любой формы.
 * @param {number} [limit] - максимальная длина JSON-строки.
 * @returns {string} сериализованное значение, при необходимости обрезанное.
 */
export function asText(value, limit = 20000) {
  let text;
  try {
    text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  } catch {
    text = String(value);
  }
  if (text === undefined) text = String(value);
  return text.length > limit ? `${text.slice(0, limit)}\n… (обрезано, всего ${text.length} символов)` : text;
}
