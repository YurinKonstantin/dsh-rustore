/**
 * Клиентская половина плагина dsh-rustore.
 *
 * Регистрирует страницу настроек RuStore в разделе Plugins: keyId, приватный
 * ключ, готовый JWE-токен и адрес API. Значения читаются и пишутся через
 * HTTP-маршруты Host (`/api/dsh-rustore/*`) — клиент не имеет доступа к файлам
 * и никогда не получает сохранённые секреты, только признак «задан».
 *
 * @module dsh-rustore/client
 */
window.__ModuleLoader__.load({
  id: 'dsh-rustore',
  factory: (require) => {
    const React = require('react');
    const module = { exports: {} };
    const exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

    const { useCallback, useEffect, useMemo, useState } = React;

    /** Базовый адрес маршрутов настроек на Host. */
    const API = '/api/dsh-rustore';

    /** Общие стили полей: следуют теме хоста через currentColor и system-ui. */
    const S = {
      section: { display: 'flex', flexDirection: 'column', gap: '14px', maxWidth: '720px', padding: '4px 0' },
      row: { display: 'flex', flexDirection: 'column', gap: '6px' },
      label: { fontSize: '13px', fontWeight: 600, opacity: 0.9 },
      hint: { fontSize: '12px', opacity: 0.65, lineHeight: 1.4 },
      input: {
        width: '100%',
        boxSizing: 'border-box',
        padding: '8px 10px',
        borderRadius: '8px',
        border: '1px solid color-mix(in srgb, currentColor 22%, transparent)',
        background: 'color-mix(in srgb, currentColor 4%, transparent)',
        color: 'inherit',
        font: 'inherit',
      },
      buttons: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '4px' },
      primary: {
        padding: '8px 16px',
        borderRadius: '8px',
        border: 'none',
        background: '#7B3FE4',
        color: '#fff',
        fontWeight: 600,
        cursor: 'pointer',
      },
      secondary: {
        padding: '8px 16px',
        borderRadius: '8px',
        border: '1px solid color-mix(in srgb, currentColor 25%, transparent)',
        background: 'transparent',
        color: 'inherit',
        cursor: 'pointer',
      },
      status: { fontSize: '13px', lineHeight: 1.5, whiteSpace: 'pre-wrap' },
      badge: (ok) => ({
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: '999px',
        fontSize: '12px',
        fontWeight: 600,
        background: ok ? 'rgba(46, 160, 67, 0.16)' : 'rgba(220, 80, 80, 0.16)',
        color: ok ? '#2ea043' : '#d05050',
      }),
      path: { fontSize: '12px', opacity: 0.6, wordBreak: 'break-all' },
    };

    /**
     * Запросить маршрут настроек.
     *
     * @param {string} suffix - `/settings` или `/check`.
     * @param {object} [init] - параметры fetch.
     * @returns {Promise<object>} разобранный ответ.
     */
    async function callApi(suffix, init) {
      const response = await fetch(`${API}${suffix}`, {
        headers: { 'content-type': 'application/json' },
        ...init,
      });
      const text = await response.text();
      let payload;
      try {
        payload = text ? JSON.parse(text) : {};
      } catch {
        payload = { error: text || `HTTP ${response.status}` };
      }
      if (!response.ok && !payload.error) payload.error = `HTTP ${response.status}`;
      return payload;
    }

    /** Страница настроек RuStore. */
    function RuStoreSettings() {
      const [loading, setLoading] = useState(true);
      const [state, setState] = useState(null);
      const [error, setError] = useState('');
      const [status, setStatus] = useState('');
      const [busy, setBusy] = useState(false);
      const [draft, setDraft] = useState({ keyId: '', privateKey: '', token: '', apiBase: '', authUrl: '' });

      const applyState = useCallback((next) => {
        if (!next || next.error) {
          setError(next?.error ?? 'Настройки недоступны.');
          setLoading(false);
          return;
        }
        setError('');
        setState(next);
        setDraft((previous) => ({
          keyId: next.keyId ?? previous.keyId,
          privateKey: '',
          token: '',
          apiBase: next.apiBase ?? previous.apiBase,
          authUrl: next.authUrl ?? previous.authUrl,
        }));
        setLoading(false);
      }, []);

      const load = useCallback(async () => {
        setLoading(true);
        try {
          applyState(await callApi('/settings'));
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : String(failure));
          setLoading(false);
        }
      }, [applyState]);

      useEffect(() => {
        load();
      }, [load]);

      const save = useCallback(async () => {
        setBusy(true);
        setStatus('Сохраняю…');
        try {
          const body = { keyId: draft.keyId, apiBase: draft.apiBase, authUrl: draft.authUrl };
          if (draft.privateKey.trim()) body.privateKey = draft.privateKey.trim();
          if (draft.token.trim()) body.token = draft.token.trim();
          const next = await callApi('/settings', { method: 'POST', body: JSON.stringify(body) });
          if (next.error) {
            setStatus(`Ошибка: ${next.error}`);
          } else {
            applyState(next);
            setStatus('Сохранено. Значения вступят в силу сразу — повторите проверку авторизации.');
          }
        } catch (failure) {
          setStatus(`Ошибка: ${failure instanceof Error ? failure.message : String(failure)}`);
        } finally {
          setBusy(false);
        }
      }, [applyState, draft]);

      const clearSecret = useCallback(
        async (field) => {
          setBusy(true);
          setStatus('Удаляю…');
          try {
            const next = await callApi('/settings', { method: 'POST', body: JSON.stringify({ clear: field }) });
            if (next.error) setStatus(`Ошибка: ${next.error}`);
            else {
              applyState(next);
              setStatus(field === 'privateKey' ? 'Приватный ключ удалён.' : 'Токен удалён.');
            }
          } catch (failure) {
            setStatus(`Ошибка: ${failure instanceof Error ? failure.message : String(failure)}`);
          } finally {
            setBusy(false);
          }
        },
        [applyState],
      );

      const check = useCallback(async () => {
        setBusy(true);
        setStatus('Проверяю авторизацию в RuStore…');
        try {
          const result = await callApi('/check', { method: 'POST', body: '{}' });
          if (result.ok) {
            setStatus(`Успешно. Приложений доступно: ${result.appsVisible}. Токен: ${result.tokenPrefix}`);
            if (result.description) applyState(result.description);
          } else {
            setStatus(`Не получилось: ${result.error ?? 'неизвестная ошибка'}`);
          }
        } catch (failure) {
          setStatus(`Ошибка: ${failure instanceof Error ? failure.message : String(failure)}`);
        } finally {
          setBusy(false);
        }
      }, [applyState]);

      const configured = state?.authMode && state.authMode !== 'none';

      const fields = useMemo(
        () => [
          {
            key: 'keyId',
            label: 'ID ключа (keyId)',
            hint: 'RuStore Консоль → Компания/Разработчик → API RuStore: ID в таблице ключей.',
            secret: false,
          },
          {
            key: 'privateKey',
            label: 'Приватный ключ',
            hint: state?.hasPrivateKey
              ? 'Ключ уже сохранён. Оставьте поле пустым, чтобы не менять; введите новый, чтобы заменить.'
              : 'Base64 из RuStore Консоли (показывается один раз). Хранится в ~/.dsh/rustore.json с правами 0600.',
            secret: true,
          },
          {
            key: 'token',
            label: 'Готовый JWE-токен (необязательно)',
            hint: state?.hasToken
              ? 'Токен сохранён. Он живёт 900 секунд — обычно его не задают вручную.'
              : 'Если хотите проверить конкретный токен; иначе плагин выпускает его сам из keyId и ключа.',
            secret: true,
          },
          { key: 'apiBase', label: 'Адрес API', hint: 'По умолчанию https://public-api-m.rustore.ru', secret: false },
          { key: 'authUrl', label: 'Адрес выдачи токена', hint: 'По умолчанию …/public/auth/', secret: false },
        ],
        [state],
      );

      if (loading) return React.createElement('div', { style: S.status }, 'Загружаю настройки RuStore…');
      if (error) {
        return React.createElement(
          'div',
          { style: S.section },
          React.createElement('div', { style: S.status }, `Настройки недоступны: ${error}`),
          React.createElement('button', { type: 'button', style: S.secondary, onClick: load }, 'Повторить'),
        );
      }

      return React.createElement(
        'div',
        { style: S.section },
        React.createElement(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: '10px' } },
          React.createElement('span', { style: S.badge(Boolean(configured)) }, configured ? 'Подключено' : 'Не настроено'),
          React.createElement('span', { style: S.hint }, `Режим: ${state.authMode}`),
        ),
        ...fields.map((field) =>
          React.createElement(
            'div',
            { key: field.key, style: S.row },
            React.createElement('label', { style: S.label, htmlFor: `rustore-${field.key}` }, field.label),
            React.createElement('input', {
              id: `rustore-${field.key}`,
              type: field.secret ? 'password' : 'text',
              style: S.input,
              value: draft[field.key] ?? '',
              placeholder: field.secret ? 'не показывается' : '',
              autoComplete: 'off',
              spellCheck: false,
              onChange: (event) => {
                const value = event.target.value;
                setDraft((previous) => ({ ...previous, [field.key]: value }));
              },
            }),
            React.createElement('span', { style: S.hint }, field.hint),
          ),
        ),
        React.createElement(
          'div',
          { style: S.buttons },
          React.createElement('button', { type: 'button', style: S.primary, disabled: busy, onClick: save }, 'Сохранить'),
          React.createElement('button', { type: 'button', style: S.secondary, disabled: busy, onClick: check }, 'Проверить авторизацию'),
          state?.hasPrivateKey
            ? React.createElement(
                'button',
                { type: 'button', style: S.secondary, disabled: busy, onClick: () => clearSecret('privateKey') },
                'Удалить ключ',
              )
            : null,
          state?.hasToken
            ? React.createElement(
                'button',
                { type: 'button', style: S.secondary, disabled: busy, onClick: () => clearSecret('token') },
                'Удалить токен',
              )
            : null,
        ),
        status ? React.createElement('div', { style: S.status }, status) : null,
        React.createElement('div', { style: S.path }, `Файл настроек: ${state.settingsPath}`),
      );
    }

    /**
     * Подключить страницу настроек.
     *
     * Ключи слотов заданы так, как их вычисляет UI менеджера плагинов:
     * конфигурация строки — `<пакет>#<id строки>`, конфигурация пакета — имя
     * пакета. Слоты рендерят только зарегистрированный ключ, поэтому прежний
     * `key: 'rustore'` страницу не показывал.
     *
     * @param {object} ctx - контекст браузерного плагина.
     */
    function apply(ctx) {
      const slots = ctx.get('slots');
      if (!slots) return;
      const page = (slotProps) =>
        slotProps && slotProps.view === 'summary'
          ? 'RuStore: публикация Android-приложений через Publishing API. Откройте, чтобы задать keyId и приватный ключ.'
          : React.createElement(RuStoreSettings, null);

      ctx.effect(() => {
        const disposers = [
          slots.inject('plugins.row.config', () =>
            slots.register({ name: 'plugins.row.config', key: 'dsh-rustore#rustore' }, page),
          ),
          slots.inject('plugins.bundle.config', () =>
            slots.register({ name: 'plugins.bundle.config', key: 'dsh-rustore' }, page),
          ),
          slots.inject('plugins.item', () => slots.register({ name: 'plugins.item', key: 'dsh-rustore' }, page)),
        ];
        return () => {
          for (const dispose of disposers) {
            try {
              dispose?.();
            } catch {
              // слот мог быть снят вместе с панелью
            }
          }
        };
      });
    }

    exports.apply = apply;
    exports.inject = ['slots'];
    return module.exports;
  },
});
