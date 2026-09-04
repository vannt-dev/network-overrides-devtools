/// <reference path="./types.ts" />
/// <reference path="./curl.ts" />
/// <reference path="./swagger.ts" />
/// <reference path="./profiles.ts" />
/// <reference path="./notifications.ts" />
/// <reference path="./dialogs.ts" />

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

  function isValidImportedRule(rule: any): boolean {
    return (
      !!rule &&
      typeof rule === 'object' &&
      typeof rule.pattern === 'string' &&
      (rule.mode === 'text' || rule.mode === 'file') &&
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
      (rule.processTemplates === undefined || typeof rule.processTemplates === 'boolean') &&
      (rule.isGlobal === undefined || typeof rule.isGlobal === 'boolean') &&
      (rule.requestBody === undefined || typeof rule.requestBody === 'string') &&
      (rule.failReason === undefined ||
        (typeof rule.failReason === 'string' &&
          FAIL_REASONS.includes(rule.failReason) &&
          rule.redirectUrl === undefined)) &&
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
    if (source.processTemplates !== undefined) clean.processTemplates = source.processTemplates;
    if (source.isGlobal !== undefined) clean.isGlobal = source.isGlobal;
    if (source.requestBody !== undefined) clean.requestBody = source.requestBody;
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
      showNotification(`Failed to export rules: ${errorMessage(error)}`, 'error');
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
    showNotification('Rules exported.', 'success');
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
        showNotification(`Invalid file: ${errorMessage(error)}`, 'error');
        elements.importRulesInput.value = '';
        return;
      }
      if (!parsed || !Array.isArray(parsed.overrides)) {
        showNotification('Invalid file: missing “overrides” list.', 'error');
        elements.importRulesInput.value = '';
        return;
      }
      if (!parsed.overrides.every(isValidImportedRule)) {
        showNotification('Invalid file: a rule has a missing or invalid field.', 'error');
        elements.importRulesInput.value = '';
        return;
      }

      const currentDomain = getCurrentDomain();
      if (typeof parsed.domain === 'string' && parsed.domain && parsed.domain !== currentDomain) {
        const continueImport = await showConfirmDialog(
          'Import rules from another domain?',
          `This file was exported from “${parsed.domain}”, but the active domain is “${currentDomain}”.`,
          'Import anyway'
        );
        if (!continueImport) return;
      }

      const importedRules = parsed.overrides.map(cleanImportedRule);
      let nextOverrides: OverrideRule[];
      if (state.overrides.length > 0) {
        const merge = await showConfirmDialog(
          'Import rules',
          'Rules already exist for this domain. Choose how the imported rules should be added.',
          'Append rules',
          'Replace rules'
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
          `${importedRules.length} rule${importedRules.length === 1 ? '' : 's'} imported`,
          result
        );
      } catch (error) {
        showNotification(`Could not import rules: ${errorMessage(error)}`, 'error');
      } finally {
        elements.importRulesInput.value = '';
      }
    });

    if (elements.importCurlSwaggerBtn && elements.curlSwaggerModal) {
      elements.importCurlSwaggerBtn.addEventListener('click', () => {
        elements.curlSwaggerModal!.style.display = 'flex';
      });
      elements.curlSwaggerCloseModal?.addEventListener('click', () => {
        elements.curlSwaggerModal!.style.display = 'none';
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
          showNotification(
            'Could not parse any rules from cURL, HAR file, or Swagger/OpenAPI specification.',
            'error'
          );
          return;
        }
        try {
          const result = await saveState([...state.overrides, ...newRules]);
          renderRules();
          elements.curlSwaggerModal!.style.display = 'none';
          if (elements.curlSwaggerTextarea) elements.curlSwaggerTextarea.value = '';
          showPersistenceNotification(
            `${newRules.length} rule${newRules.length === 1 ? '' : 's'} imported`,
            result
          );
        } catch (error) {
          showNotification(`Could not import rules: ${errorMessage(error)}`, 'error');
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
          showNotification('Could not read the selected import file.', 'error');
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
