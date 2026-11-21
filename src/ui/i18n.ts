/*! SPDX-License-Identifier: MIT | Copyright (c) 2025 Van Nguyen | github.com/vannt-dev/network-overrides-devtools */
/// <reference types="chrome" />

/**
 * The messages of `_locales/<lang>/messages.json`, key to text, put in front
 * of the UI bundle at build time (scripts/bundle.mjs). They give the English
 * fallback and the languages a user can pick, with no fetch.
 */
declare const NETWORK_OVERRIDES_MESSAGES: Record<string, Record<string, string>> | undefined;

namespace NetworkOverridesUi {
  /** `auto` follows the browser's language through chrome.i18n. */
  export type UiLanguage = 'auto' | 'en' | 'vi';

  export const UI_LANGUAGE_KEY = 'uiLanguage';
  const PICKABLE_LANGUAGES: UiLanguage[] = ['en', 'vi'];

  let languageOverride: UiLanguage = 'auto';

  function bundledMessages(lang: string): Record<string, string> | undefined {
    return typeof NETWORK_OVERRIDES_MESSAGES === 'undefined'
      ? undefined
      : NETWORK_OVERRIDES_MESSAGES[lang];
  }

  /** chrome.i18n's substitution rules: `$1`..`$9` take the values, `$$` is a `$`. */
  function fillMessage(message: string, subs: string[]): string {
    return message.replace(/\$(\$|[1-9])/g, (_, token: string) =>
      token === '$' ? '$' : (subs[Number(token) - 1] ?? '')
    );
  }

  /**
   * The text of a message in the UI language. A key the language lacks, or a
   * page without chrome.i18n (tests), falls back to English.
   */
  export function t(key: string, ...subs: Array<string | number>): string {
    const values = subs.map(String);
    if (languageOverride !== 'auto') {
      const message = bundledMessages(languageOverride)?.[key];
      if (message !== undefined) return fillMessage(message, values);
    } else if (typeof chrome !== 'undefined' && chrome.i18n?.getMessage) {
      try {
        const message = chrome.i18n.getMessage(key, values.length ? values : undefined);
        if (message) return message;
      } catch {}
    }
    const english = bundledMessages('en')?.[key];
    return english === undefined ? key : fillMessage(english, values);
  }

  export function getUiLanguage(): UiLanguage {
    return languageOverride;
  }

  /** Picks the UI language: `auto`, or one of the bundled languages. */
  export function setUiLanguage(language: unknown): UiLanguage {
    languageOverride = PICKABLE_LANGUAGES.includes(language as UiLanguage)
      ? (language as UiLanguage)
      : 'auto';
    return languageOverride;
  }

  /** Text with `<code>` tags only: everything else is escaped. */
  function setCodeHtml(element: Element, text: string): void {
    const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    element.innerHTML = escaped.replace(/&lt;(\/?)code&gt;/g, '<$1code>');
  }

  /** `data-*` attribute that names a message, and the attribute it fills. */
  const ATTRIBUTE_MESSAGES: Array<[string, string]> = [
    ['data-i18n-title', 'title'],
    ['data-i18n-placeholder', 'placeholder'],
    ['data-i18n-aria-label', 'aria-label'],
  ];

  /**
   * Fills the `data-i18n*` marked text of static markup: `data-i18n` sets the
   * text, `data-i18n-html` the text with `<code>` tags (with `data-i18n-args`
   * as its `$1`), and `data-i18n-title` / `-placeholder` / `-aria-label`
   * those attributes.
   */
  export function applyI18n(root: ParentNode = document): void {
    root.querySelectorAll<HTMLElement>('[data-i18n]').forEach(element => {
      element.textContent = t(element.dataset.i18n || '');
    });
    root.querySelectorAll<HTMLElement>('[data-i18n-html]').forEach(element => {
      const args = element.dataset.i18nArgs;
      setCodeHtml(element, t(element.dataset.i18nHtml || '', ...(args ? [args] : [])));
    });
    for (const [source, attribute] of ATTRIBUTE_MESSAGES) {
      root.querySelectorAll<HTMLElement>(`[${source}]`).forEach(element => {
        element.setAttribute(attribute, t(element.getAttribute(source) || ''));
      });
    }
    const lang = languageOverride === 'auto' ? uiLocaleFromBrowser() : languageOverride;
    if (lang && typeof document !== 'undefined') document.documentElement.lang = lang;
  }

  function uiLocaleFromBrowser(): string {
    if (typeof chrome === 'undefined' || !chrome.i18n?.getMessage) return '';
    try {
      return chrome.i18n.getMessage('@@ui_locale').replace(/_/g, '-');
    } catch {
      return '';
    }
  }

  /**
   * Wires the language picker: the stored choice is read once, and a change
   * is stored and shown at once. `rerender` redraws the dynamic text.
   */
  export function initLanguageSwitch(rerender: () => void): void {
    const select = document.getElementById('ui-language') as HTMLSelectElement | null;
    const show = (language: UiLanguage) => {
      setUiLanguage(language);
      if (select) select.value = getUiLanguage();
      applyI18n(document);
      rerender();
    };
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
    void Promise.resolve(chrome.storage.local.get([UI_LANGUAGE_KEY]))
      .then(data => {
        const stored = setUiLanguage(data?.[UI_LANGUAGE_KEY]);
        if (stored !== 'auto' || select?.value !== 'auto') show(stored);
      })
      .catch(() => {});
    select?.addEventListener('change', () => {
      const language = setUiLanguage(select.value);
      show(language);
      void Promise.resolve(chrome.storage.local.set({ [UI_LANGUAGE_KEY]: language })).catch(error =>
        showNotification(t('toast_language_save_failed', errorMessage(error)), 'error')
      );
    });
  }
}
