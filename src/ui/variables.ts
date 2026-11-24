/*! SPDX-License-Identifier: MIT | Copyright (c) 2025 Van Nguyen | github.com/vannt-dev/network-overrides-devtools */
/// <reference path="./types.ts" />
/// <reference path="./headers-editor.ts" />
/// <reference path="./notifications.ts" />

// The Variables dialog: values written as {{name}} in rules, kept for every
// site (global) or for the site of the inspected tab. A site value wins.
namespace NetworkOverridesUi {
  type RuleVariable = NetworkOverridesShared.RuleVariable;

  /** Site values over global ones, as the background fills them in. */
  export function uiVariables(state: UiState): NetworkOverridesUtils.Variables {
    return NetworkOverridesUtils.mergeVariables(state.variables?.global, state.variables?.site);
  }

  /** Reads both lists from storage into the state. */
  export async function loadVariables(state: UiState, siteKey: string): Promise<void> {
    const globalKey = NetworkOverridesUtils.GLOBAL_VARIABLES_KEY;
    const data = await Promise.resolve(chrome.storage.local.get([globalKey, siteKey]));
    state.variables = {
      global: NetworkOverridesUtils.cleanVariables(data?.[globalKey]),
      site: NetworkOverridesUtils.cleanVariables(data?.[siteKey]),
    };
  }

  /** The variables of one list in the dialog, or the message that says what is wrong. */
  export function readVariablesText(
    text: string
  ): { variables: RuleVariable[] } | { error: string } {
    const variables: RuleVariable[] = [];
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed.indexOf(':') <= 0) return { error: t('error_variable_line', trimmed) };
    }
    for (const entry of parseHeadersText(text)) {
      const problem = NetworkOverridesUtils.variableNameError(entry.name);
      if (problem === 'reserved') return { error: t('error_variable_reserved', entry.name) };
      if (problem) return { error: t('error_variable_name', entry.name) };
      if (variables.some(existing => existing.name === entry.name)) {
        return { error: t('error_variable_twice', entry.name) };
      }
      variables.push({ name: entry.name, value: entry.value });
    }
    return { variables };
  }

  export interface VariablesDialogOptions {
    elements: Elements;
    state: UiState;
    getSiteKey: () => string;
    getDomain: () => string;
    /** Sends the rules and the new variables to the background. */
    apply: () => Promise<void>;
    renderRules: () => void;
  }

  const VARIABLE_TABLE_LABELS = (): HeaderTableLabels => ({
    name: t('variables_name'),
    value: t('variables_value'),
    add: t('variables_add'),
    remove: t('variables_delete'),
  });

  export function bindVariablesDialog(options: VariablesDialogOptions): void {
    const { elements, state } = options;
    const dialog = elements.variablesModal;
    const siteText = elements.variablesSite;
    const globalText = elements.variablesGlobal;
    if (!dialog || !siteText || !globalText || !elements.variablesBtn) return;
    let returnFocus: HTMLElement | null = null;

    const feedback = (message: string, kind: 'error' | 'info' | '') => {
      if (!elements.variablesFeedback) return;
      elements.variablesFeedback.textContent = message;
      elements.variablesFeedback.className = kind ? `modal-feedback is-${kind}` : 'modal-feedback';
    };
    const close = () => {
      dialog.style.display = 'none';
      returnFocus?.focus();
      returnFocus = null;
    };

    elements.variablesBtn.addEventListener('click', () => {
      returnFocus = elements.variablesBtn || null;
      siteText.value = formatHeadersText(state.variables.site);
      globalText.value = formatHeadersText(state.variables.global);
      if (elements.variablesSiteName) {
        elements.variablesSiteName.textContent = options.getDomain() || '—';
      }
      const labels = VARIABLE_TABLE_LABELS();
      if (elements.variablesSiteTable) {
        renderHeaderTable(elements.variablesSiteTable, siteText, labels);
      }
      if (elements.variablesGlobalTable) {
        renderHeaderTable(elements.variablesGlobalTable, globalText, labels);
      }
      feedback('', '');
      dialog.style.display = 'flex';
      (dialog.querySelector('.header-row-key, textarea') as HTMLElement | null)?.focus();
    });
    elements.variablesClose?.addEventListener('click', close);
    dialog.addEventListener('click', event => {
      if (event.target === dialog) close();
    });
    dialog.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    });

    elements.variablesSaveBtn?.addEventListener('click', async () => {
      const site = readVariablesText(siteText.value);
      if ('error' in site) {
        feedback(site.error, 'error');
        return;
      }
      const global = readVariablesText(globalText.value);
      if ('error' in global) {
        feedback(global.error, 'error');
        return;
      }
      const previous = state.variables;
      state.variables = { global: global.variables, site: site.variables };
      try {
        await Promise.resolve(
          chrome.storage.local.set({
            [NetworkOverridesUtils.GLOBAL_VARIABLES_KEY]: global.variables,
            [options.getSiteKey()]: site.variables,
          })
        );
      } catch (error) {
        state.variables = previous;
        feedback(t('toast_variables_save_failed', errorMessage(error)), 'error');
        return;
      }
      options.renderRules();
      close();
      let result: PersistenceResult = { applied: true };
      try {
        await options.apply();
      } catch (error) {
        result = { applied: false, warning: errorMessage(error), retry: options.apply };
      }
      showPersistenceNotification(t('toast_variables_saved'), result);
    });
  }
}
