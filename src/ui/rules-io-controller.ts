/*! SPDX-License-Identifier: MIT | Copyright (c) 2025 Van Nguyen | github.com/vannt-dev/network-overrides-devtools */
/// <reference path="./types.ts" />
/// <reference path="./curl.ts" />
/// <reference path="./swagger.ts" />
/// <reference path="./profiles.ts" />
/// <reference path="./notifications.ts" />
/// <reference path="./dialogs.ts" />
/// <reference path="./websocket-rule.ts" />

namespace NetworkOverridesUi {
  export interface RulesIoControllerOptions {
    elements: Elements;
    state: UiState;
    getCurrentDomain: () => string;
    saveState: (rules: OverrideRule[]) => Promise<PersistenceResult>;
    renderRules: () => void;
  }

  function isValidImportHeader(header: any): boolean {
    return (
      !!header &&
      typeof header.name === 'string' &&
      header.name.trim() !== '' &&
      typeof header.value === 'string'
    );
  }

  function isValidMatchConditions(conditions: any): boolean {
    return (
      conditions === undefined ||
      (Array.isArray(conditions) &&
        conditions.every(
          (condition: any) =>
            !!condition &&
            typeof condition.name === 'string' &&
            condition.name.trim() !== '' &&
            (condition.value === undefined || typeof condition.value === 'string')
        ))
    );
  }

  function cleanMatchConditions(conditions: any[]): NetworkOverridesShared.MatchCondition[] {
    return conditions.map(condition =>
      condition.value === undefined
        ? { name: condition.name }
        : { name: condition.name, value: condition.value }
    );
  }

  function isWholeNumber(value: unknown, min: number, max: number): boolean {
    return Number.isInteger(value) && (value as number) >= min && (value as number) <= max;
  }

  function isValidRemovedHeaders(names: any): boolean {
    if (names === undefined) return true;
    if (!Array.isArray(names) || !names.every(name => typeof name === 'string')) return false;
    const parsed = NetworkOverridesUtils.parseHeaderNames(names.join('\n'));
    return 'names' in parsed && parsed.names.length === names.length;
  }

  function isValidResponseVariants(rule: any): boolean {
    if (rule.responses === undefined) {
      return rule.weight === undefined && rule.randomSeed === undefined;
    }
    const maxWeight = NetworkOverridesUtils.MAX_RESPONSE_WEIGHT;
    return (
      (rule.mode === 'text' || rule.mode === 'file') &&
      Array.isArray(rule.responses) &&
      rule.responses.every(
        (variant: any) =>
          !!variant &&
          typeof variant === 'object' &&
          isWholeNumber(variant.weight, 0, maxWeight) &&
          (variant.statusCode === undefined || isWholeNumber(variant.statusCode, 100, 599)) &&
          (typeof variant.body === 'string' ||
            (typeof variant.body === 'object' && variant.body !== null)) &&
          (variant.responseHeaders === undefined ||
            (Array.isArray(variant.responseHeaders) &&
              variant.responseHeaders.every(isValidImportHeader)))
      ) &&
      (rule.weight === undefined || isWholeNumber(rule.weight, 0, maxWeight)) &&
      (rule.randomSeed === undefined ||
        isWholeNumber(rule.randomSeed, 0, NetworkOverridesUtils.MAX_RANDOM_SEED))
    );
  }

  function isValidImportedRule(rule: any): boolean {
    return (
      !!rule &&
      typeof rule === 'object' &&
      typeof rule.pattern === 'string' &&
      (rule.mode === 'text' ||
        rule.mode === 'file' ||
        rule.mode === 'script' ||
        rule.mode === 'patch' ||
        rule.mode === 'passthrough') &&
      // A patch rule carries its operations; no other rule may.
      (rule.mode === 'patch'
        ? NetworkOverridesUtils.validatePatchOperations(rule.patch) === null
        : rule.patch === undefined) &&
      (rule.method === undefined ||
        (typeof rule.method === 'string' && KNOWN_METHODS.includes(rule.method.toUpperCase()))) &&
      (rule.body === undefined ||
        typeof rule.body === 'string' ||
        (typeof rule.body === 'object' && rule.body !== null)) &&
      (rule.redirectUrl === undefined || typeof rule.redirectUrl === 'string') &&
      (rule.statusCode === undefined ||
        (Number.isInteger(rule.statusCode) && rule.statusCode >= 100 && rule.statusCode <= 599)) &&
      (rule.delayMs === undefined ||
        (typeof rule.delayMs === 'number' && rule.delayMs >= 0 && rule.delayMs <= 120000)) &&
      (rule.responseHeaders === undefined ||
        (Array.isArray(rule.responseHeaders) && rule.responseHeaders.every(isValidImportHeader))) &&
      (rule.requestHeaders === undefined ||
        (Array.isArray(rule.requestHeaders) && rule.requestHeaders.every(isValidImportHeader))) &&
      (rule.graphqlOperation === undefined || typeof rule.graphqlOperation === 'string') &&
      isValidMatchConditions(rule.matchQuery) &&
      isValidMatchConditions(rule.matchHeaders) &&
      (rule.matchBody === undefined || typeof rule.matchBody === 'string') &&
      (rule.processTemplates === undefined || typeof rule.processTemplates === 'boolean') &&
      (rule.isGlobal === undefined || typeof rule.isGlobal === 'boolean') &&
      (rule.requestBody === undefined || typeof rule.requestBody === 'string') &&
      (rule.respondAtRequest === undefined || typeof rule.respondAtRequest === 'boolean') &&
      (rule.failReason === undefined ||
        (typeof rule.failReason === 'string' &&
          FAIL_REASONS.includes(rule.failReason) &&
          rule.redirectUrl === undefined)) &&
      (rule.kind === undefined ||
        rule.kind === 'http' ||
        rule.kind === 'websocket' ||
        rule.kind === 'inject') &&
      (rule.fileName === undefined || typeof rule.fileName === 'string') &&
      (rule.injectScript === undefined || typeof rule.injectScript === 'string') &&
      (rule.injectStyle === undefined || typeof rule.injectStyle === 'string') &&
      (rule.relaxCsp === undefined || typeof rule.relaxCsp === 'boolean') &&
      (rule.wsDirection === undefined || isValidWsDirection(rule.wsDirection)) &&
      (rule.wsMatch === undefined || typeof rule.wsMatch === 'string') &&
      (rule.wsMatchRegex === undefined || typeof rule.wsMatchRegex === 'boolean') &&
      (rule.wsAction === undefined || isValidWsAction(rule.wsAction)) &&
      isValidRemovedHeaders(rule.removeResponseHeaders) &&
      isValidResponseVariants(rule) &&
      (rule.enabled === undefined || typeof rule.enabled === 'boolean')
    );
  }

  function cleanImportedRule(source: any): OverrideRule {
    const clean = { pattern: source.pattern, mode: source.mode } as OverrideRule;
    if (source.body !== undefined) {
      clean.body = typeof source.body === 'string' ? source.body : JSON.stringify(source.body);
    }
    if (source.redirectUrl !== undefined) clean.redirectUrl = source.redirectUrl;
    if (source.enabled !== undefined) clean.enabled = source.enabled;
    if (source.method !== undefined) clean.method = source.method.toUpperCase();
    if (source.graphqlOperation !== undefined) clean.graphqlOperation = source.graphqlOperation;
    if (source.matchQuery !== undefined) clean.matchQuery = cleanMatchConditions(source.matchQuery);
    if (source.matchHeaders !== undefined) {
      clean.matchHeaders = cleanMatchConditions(source.matchHeaders);
    }
    if (source.matchBody !== undefined) clean.matchBody = source.matchBody;
    if (source.processTemplates !== undefined) clean.processTemplates = source.processTemplates;
    if (source.isGlobal !== undefined) clean.isGlobal = source.isGlobal;
    if (source.requestBody !== undefined) clean.requestBody = source.requestBody;
    if (source.mode === 'patch') {
      clean.body = '';
      clean.patch = source.patch.map((operation: any) =>
        operation.op === 'set'
          ? { op: 'set', path: operation.path, value: operation.value }
          : { op: 'remove', path: operation.path }
      );
    } else if (source.mode === 'passthrough') {
      // The real body is kept, so no body is carried.
      clean.body = '';
    } else if (source.respondAtRequest !== undefined) {
      // A patch or pass-through rule needs the real response, so it never
      // answers without the server.
      clean.respondAtRequest = source.respondAtRequest;
    }
    if (source.removeResponseHeaders !== undefined) {
      clean.removeResponseHeaders = source.removeResponseHeaders.map((name: string) =>
        name.trim().toLowerCase()
      );
    }
    if (source.responses !== undefined) {
      clean.responses = source.responses.map((variant: any) => {
        const copy: NetworkOverridesShared.ResponseVariant = {
          weight: variant.weight,
          body: typeof variant.body === 'string' ? variant.body : JSON.stringify(variant.body),
        };
        if (variant.statusCode !== undefined) copy.statusCode = variant.statusCode;
        if (variant.responseHeaders !== undefined) {
          copy.responseHeaders = variant.responseHeaders.map((header: any) => ({
            name: header.name,
            value: header.value,
          }));
        }
        return copy;
      });
      if (source.weight !== undefined) clean.weight = source.weight;
      if (source.randomSeed !== undefined) clean.randomSeed = source.randomSeed;
    }
    if (source.statusCode !== undefined) clean.statusCode = source.statusCode;
    if (source.delayMs !== undefined) clean.delayMs = source.delayMs;
    if (source.responseHeaders !== undefined) {
      clean.responseHeaders = source.responseHeaders.map((header: any) => ({
        name: header.name,
        value: header.value,
      }));
    }
    if (source.requestHeaders !== undefined) {
      clean.requestHeaders = source.requestHeaders.map((header: any) => ({
        name: header.name,
        value: header.value,
      }));
    }
    if (source.failReason !== undefined) clean.failReason = source.failReason;
    if (source.kind !== undefined) clean.kind = source.kind;
    if (source.wsDirection !== undefined) clean.wsDirection = source.wsDirection;
    if (source.wsMatch !== undefined) clean.wsMatch = source.wsMatch;
    if (source.wsMatchRegex !== undefined) clean.wsMatchRegex = source.wsMatchRegex;
    if (source.wsAction !== undefined) clean.wsAction = source.wsAction;
    if (source.fileName !== undefined) clean.fileName = source.fileName;
    if (source.injectScript !== undefined) clean.injectScript = source.injectScript;
    if (source.injectStyle !== undefined) clean.injectStyle = source.injectStyle;
    if (source.relaxCsp !== undefined) clean.relaxCsp = source.relaxCsp;
    return clean;
  }

  function exportRules(state: UiState, currentDomain: string): void {
    let blob: Blob;
    try {
      const compactRules = state.overrides.map(rule => {
        if (!rule.body) return rule;
        try {
          const body = JSON.parse(rule.body);
          return body !== null && typeof body === 'object'
            ? { ...rule, body: body as unknown as string }
            : rule;
        } catch {
          return rule;
        }
      });
      blob = new Blob(
        [
          JSON.stringify(
            {
              version: 1,
              domain: currentDomain,
              exportedAt: new Date().toISOString(),
              overrides: compactRules,
            },
            null,
            2
          ),
        ],
        { type: 'application/json' }
      );
    } catch (error) {
      showNotification(t('toast_export_failed', errorMessage(error)), 'error');
      return;
    }
    const url = URL.createObjectURL(blob);
    const safeDomain = currentDomain.replace(/[^a-z0-9.-]+/gi, '_') || 'rules';
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `network-overrides-${safeDomain}-${Date.now()}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    showNotification(t('toast_exported'), 'success');
  }

  /**
   * The Import button opens a small menu: a rules file exported from this
   * extension, or rules made from cURL / OpenAPI. Arrow keys move between
   * the items; Escape and Tab close it.
   */
  function bindImportMenu(elements: Elements): void {
    const button = elements.importMenuBtn;
    const menu = elements.importMenu;
    if (!button || !menu) return;
    const items = () => Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]'));
    const isOpen = () => !menu.hidden;
    const close = (focusButton: boolean) => {
      menu.hidden = true;
      button.setAttribute('aria-expanded', 'false');
      if (focusButton) button.focus();
    };
    const open = (focusIndex: number) => {
      menu.hidden = false;
      button.setAttribute('aria-expanded', 'true');
      const list = items();
      list[(focusIndex + list.length) % list.length]?.focus();
    };

    button.addEventListener('click', event => {
      event.stopPropagation();
      if (isOpen()) close(true);
      else open(0);
    });
    button.addEventListener('keydown', event => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        open(event.key === 'ArrowDown' ? 0 : -1);
      }
    });
    menu.addEventListener('keydown', event => {
      const list = items();
      const current = list.indexOf(document.activeElement as HTMLElement);
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const step = event.key === 'ArrowDown' ? 1 : -1;
        list[(current + step + list.length) % list.length]?.focus();
      } else if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        list[event.key === 'Home' ? 0 : list.length - 1]?.focus();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        close(true);
      } else if (event.key === 'Tab') {
        close(false);
      }
    });
    // An item runs its own action (bound below); the menu just closes.
    menu.addEventListener('click', event => {
      if ((event.target as HTMLElement).closest?.('[role="menuitem"]')) close(false);
    });
    document.addEventListener('click', event => {
      if (isOpen() && !menu.contains(event.target as Node) && event.target !== button) {
        close(false);
      }
    });
  }

  export function bindRulesIoController(options: RulesIoControllerOptions): void {
    const { elements, state, getCurrentDomain, saveState, renderRules } = options;
    elements.exportRulesBtn?.addEventListener('click', () => {
      exportRules(state, getCurrentDomain());
    });
    elements.importRulesBtn?.addEventListener('click', () => elements.importRulesInput?.click());
    elements.importRulesInput?.addEventListener('change', async event => {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (!file) return;
      let parsed: any;
      try {
        parsed = JSON.parse(await file.text());
      } catch (error) {
        showNotification(t('toast_invalid_file', errorMessage(error)), 'error');
        elements.importRulesInput.value = '';
        return;
      }
      if (!parsed || !Array.isArray(parsed.overrides)) {
        showNotification(t('toast_invalid_file_list'), 'error');
        elements.importRulesInput.value = '';
        return;
      }
      if (!parsed.overrides.every(isValidImportedRule)) {
        showNotification(t('toast_invalid_file_rule'), 'error');
        elements.importRulesInput.value = '';
        return;
      }

      const currentDomain = getCurrentDomain();
      if (typeof parsed.domain === 'string' && parsed.domain && parsed.domain !== currentDomain) {
        const continueImport = await showConfirmDialog(
          t('import_other_domain_title'),
          t('import_other_domain_message', parsed.domain, currentDomain),
          t('import_anyway')
        );
        if (!continueImport) return;
      }

      const importedRules = parsed.overrides.map(cleanImportedRule);
      let nextOverrides: OverrideRule[];
      if (state.overrides.length > 0) {
        const merge = await showConfirmDialog(
          t('import_merge_title'),
          t('import_merge_message'),
          t('import_append'),
          t('import_replace')
        );
        if (merge === null) return;
        nextOverrides = merge ? [...state.overrides, ...importedRules] : importedRules;
      } else {
        nextOverrides = importedRules;
      }
      try {
        const result = await saveState(nextOverrides);
        renderRules();
        showPersistenceNotification(
          importedRules.length === 1
            ? t('toast_imported_one')
            : t('toast_imported_other', importedRules.length),
          result
        );
      } catch (error) {
        showNotification(t('toast_import_failed', errorMessage(error)), 'error');
      } finally {
        elements.importRulesInput.value = '';
      }
    });

    bindImportMenu(elements);

    if (elements.importCurlSwaggerBtn && elements.curlSwaggerModal) {
      const dialog = elements.curlSwaggerModal;
      let returnFocus: HTMLElement | null = null;
      const closeDialog = () => {
        dialog.style.display = 'none';
        returnFocus?.focus();
        returnFocus = null;
      };
      elements.importCurlSwaggerBtn.addEventListener('click', () => {
        returnFocus = elements.importMenuBtn || elements.importCurlSwaggerBtn || null;
        dialog.style.display = 'flex';
        elements.curlSwaggerTextarea?.focus();
      });
      elements.curlSwaggerCloseModal?.addEventListener('click', closeDialog);
      dialog.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
          event.preventDefault();
          closeDialog();
        }
      });
      elements.curlSwaggerImportBtn?.addEventListener('click', async () => {
        const text = elements.curlSwaggerTextarea?.value || '';
        const curlRule = parseCurlToRule(text);
        const harRules = parseHarToRules(text);
        const newRules = curlRule
          ? [curlRule]
          : harRules.length > 0
            ? harRules
            : parseSwaggerToRules(text);
        if (newRules.length === 0) {
          showNotification(t('toast_import_nothing'), 'error');
          return;
        }
        try {
          const result = await saveState([...state.overrides, ...newRules]);
          renderRules();
          closeDialog();
          if (elements.curlSwaggerTextarea) elements.curlSwaggerTextarea.value = '';
          showPersistenceNotification(
            newRules.length === 1
              ? t('toast_imported_one')
              : t('toast_imported_other', newRules.length),
            result
          );
        } catch (error) {
          showNotification(t('toast_import_failed', errorMessage(error)), 'error');
        }
      });
      elements.curlSwaggerFileInput?.addEventListener('change', event => {
        const file = (event.target as HTMLInputElement).files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = loadEvent => {
          if (elements.curlSwaggerTextarea) {
            elements.curlSwaggerTextarea.value = loadEvent.target?.result as string;
          }
        };
        reader.onerror = () => {
          showNotification(t('toast_import_read_failed'), 'error');
        };
        reader.readAsText(file);
        elements.curlSwaggerFileInput!.value = '';
      });
    }

    if (elements.profilesSelect) loadProfiles(elements.profilesSelect, getCurrentDomain());
    elements.saveProfileBtn?.addEventListener('click', () => {
      saveProfile(elements.profilesSelect, getCurrentDomain(), state.overrides);
    });
    elements.deleteProfileBtn?.addEventListener('click', () => {
      deleteProfile(elements.profilesSelect, getCurrentDomain());
    });
  }
}
