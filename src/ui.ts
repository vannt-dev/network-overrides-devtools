/// <reference types="chrome" />
/// <reference path="./shared.ts" />
/// <reference path="./utils.ts" />
/// <reference path="./ui/types.ts" />
/// <reference path="./ui/view-utils.ts" />
/// <reference path="./ui/primitives.ts" />
/// <reference path="./ui/notifications.ts" />
/// <reference path="./ui/dialogs.ts" />
/// <reference path="./ui/persistence.ts" />
/// <reference path="./ui/attach-status.ts" />
/// <reference path="./ui/headers-editor.ts" />
/// <reference path="./ui/curl.ts" />
/// <reference path="./ui/swagger.ts" />
/// <reference path="./ui/har.ts" />
/// <reference path="./ui/modal.ts" />
/// <reference path="./ui/rules-list.ts" />
/// <reference path="./ui/api-list.ts" />
/// <reference path="./ui/profiles.ts" />
/// <reference path="./ui/modal-controller.ts" />
/// <reference path="./ui/rules-io-controller.ts" />
/// <reference path="./ui/toolbar-controller.ts" />

namespace NetworkOverridesUi {
  let currentDomain = '';
  const GLOBAL_OVERRIDES_KEY = 'overrides_global';

  export function matchPattern(pattern: string, url: string): string[] | null {
    return NetworkOverridesUtils.matchPattern(pattern, url);
  }

  export function substituteWildcards(template: string, captures: string[]): string {
    return NetworkOverridesUtils.substituteWildcards(template, captures);
  }

  export function patternMatches(pattern: string, url: string): boolean {
    return NetworkOverridesUtils.patternMatches(pattern, url);
  }

  export function getStorageKey(suffix: string): string {
    return currentDomain ? `${suffix}_${currentDomain}` : suffix;
  }

  function getElements(): Elements {
    return {
      enableCheckbox: document.getElementById('enable') as HTMLInputElement,
      attachStatus: document.getElementById('attach-status') as HTMLElement,
      patternInput: document.getElementById('pattern') as HTMLInputElement,
      bodyInput: document.getElementById('body') as HTMLTextAreaElement,
      addBtn: document.getElementById('add') as HTMLButtonElement,
      listEl: document.getElementById('list') as HTMLUListElement,
      modeSelect: document.getElementById('mode') as HTMLSelectElement,
      apisSection: document.getElementById('apis-section') as HTMLDivElement,
      apiSearchInput: document.getElementById('api-search') as HTMLInputElement,
      apisList: document.getElementById('apis-list') as HTMLDivElement,
      tabsContainer: document.querySelector('.tabs') as HTMLDivElement,
      overridesSection: document.getElementById('overrides-section') as HTMLDivElement,
      modal: document.getElementById('override-modal') as HTMLDivElement,
      modalUrl: document.getElementById('modal-url') as HTMLElement,
      modalTitleText: document.getElementById('modal-title-text') as HTMLElement,
      modalPattern: document.getElementById('modal-pattern') as HTMLInputElement,
      modalMethod: document.getElementById('modal-method') as HTMLSelectElement,
      modalMode: document.getElementById('modal-mode') as HTMLSelectElement,
      modalBody: document.getElementById('modal-body') as HTMLTextAreaElement,
      modalRedirectUrl: document.getElementById('modal-redirect-url') as HTMLInputElement,
      modalBodyFields: document.getElementById('modal-body-fields') as HTMLDivElement,
      modalRedirectFields: document.getElementById('modal-redirect-fields') as HTMLDivElement,
      modalStatus: document.getElementById('modal-status') as HTMLInputElement,
      modalDelay: document.getElementById('modal-delay') as HTMLInputElement,
      modalHeaders: document.getElementById('modal-headers') as HTMLTextAreaElement,
      modalFailFields: document.getElementById('modal-fail-fields') as HTMLDivElement,
      modalFailReason: document.getElementById('modal-fail-reason') as HTMLSelectElement,
      modalAdvancedFields: document.getElementById('modal-advanced-fields') as HTMLDivElement,
      modalStatusField: document.getElementById('modal-status-field') as HTMLElement,
      modalHeadersField: document.getElementById('modal-headers-field') as HTMLElement,
      modalFeedback: document.getElementById('modal-feedback') as HTMLElement,
      saveOverrideBtn: document.getElementById('save-override') as HTMLButtonElement,
      formatJsonBtn: document.getElementById('format-json-btn') as HTMLButtonElement,
      closeModal: document.querySelector('.close') as HTMLElement,
      newRow: document.getElementById('new-row') as HTMLDivElement,
      refreshBtn: document.getElementById('refresh-apis') as HTMLButtonElement,
      infoBtn: document.getElementById('info-btn') as HTMLButtonElement,
      redirectUrlInput: document.getElementById('redirect-url') as HTMLInputElement,
      addApiBtn: document.getElementById('add-api-btn') as HTMLButtonElement,
      exportRulesBtn: document.getElementById('export-rules-btn') as HTMLButtonElement,
      importRulesBtn: document.getElementById('import-rules-btn') as HTMLButtonElement,
      importRulesInput: document.getElementById('import-rules-input') as HTMLInputElement,
      modalRequestHeaders: document.getElementById('modal-request-headers') as HTMLTextAreaElement,
      modalRequestHeadersField: document.getElementById(
        'modal-request-headers-field'
      ) as HTMLElement,
      modalRequestBody: document.getElementById('modal-request-body') as HTMLTextAreaElement,
      modalRequestBodyField: document.getElementById('modal-request-body-field') as HTMLElement,
      modalProcessTemplates: document.getElementById('modal-process-templates') as HTMLInputElement,
      modalGlobalRule: document.getElementById('modal-global-rule') as HTMLInputElement,
      modalGraphqlOp: document.getElementById('modal-graphql-op') as HTMLInputElement,
      modalPreviewContainer: document.getElementById('modal-preview-container') as HTMLDivElement,
      profilesSelect: document.getElementById('profiles-select') as HTMLSelectElement,
      saveProfileBtn: document.getElementById('save-profile-btn') as HTMLButtonElement,
      deleteProfileBtn: document.getElementById('delete-profile-btn') as HTMLButtonElement,
      importCurlSwaggerBtn: document.getElementById('import-curl-swagger-btn') as HTMLButtonElement,
      curlSwaggerModal: document.getElementById('curl-swagger-modal') as HTMLDivElement,
      curlSwaggerTextarea: document.getElementById('curl-swagger-textarea') as HTMLTextAreaElement,
      curlSwaggerFileInput: document.getElementById('curl-swagger-file-input') as HTMLInputElement,
      curlSwaggerImportBtn: document.getElementById('curl-swagger-import-btn') as HTMLButtonElement,
      curlSwaggerCloseModal: document.getElementById('curl-swagger-close') as HTMLElement,
      modalRequestHeadersTable: document.getElementById(
        'modal-request-headers-table'
      ) as HTMLDivElement,
      modalResponseHeadersTable: document.getElementById(
        'modal-response-headers-table'
      ) as HTMLDivElement,
    };
  }

  export function init(options: AppOptions = { autoFillOnOpen: true, showManualEditor: false }): {
    addApis: (apis: ApiEntry[]) => void;
  } {
    const elements = getElements();
    upgradeUiPrimitives();
    const state: UiState = {
      overrides: [],
      currentEditIndex: null,
      capturedApis: [],
      apiFilter: '',
      activeTab: 'other',
      attached: false,
      enabled: false,
      attachError: null,
    };

    let activeTabId: number | null = null;
    let activeTabUrl = '';
    let port: chrome.runtime.Port | null = null;

    if (elements.newRow) {
      elements.newRow.style.display = options.showManualEditor ? '' : 'none';
    }
    elements.apisSection.style.display = 'block';
    elements.overridesSection.style.display = 'none';

    function renderRules(): void {
      renderRulesList(
        elements,
        state,
        index => openEditModal(index),
        (index, enabled) => toggleRule(index, enabled),
        index => deleteRule(index),
        index => duplicateRule(index)
      );
      renderApis();
    }

    function renderApis(): void {
      renderCapturedApis(elements, state, api => handleApiClick(api));
    }

    let persistenceQueue: Promise<void> = Promise.resolve();

    function saveState(newOverrides: OverrideRule[]): Promise<PersistenceResult> {
      const previousOverrides = state.overrides;
      const snapshot = newOverrides.map(rule => ({ ...rule }));
      state.overrides = snapshot;

      const operation = persistenceQueue.then(async () => {
        const overridesKey = getStorageKey('overrides');
        const localRules = snapshot.filter(rule => rule.isGlobal !== true);
        const globalRules = snapshot.filter(rule => rule.isGlobal === true);
        try {
          await Promise.resolve(
            chrome.storage.local.set({
              [overridesKey]: localRules,
              [GLOBAL_OVERRIDES_KEY]: globalRules,
            })
          );
        } catch (error) {
          if (state.overrides === snapshot) state.overrides = previousOverrides;
          throw error;
        }
        try {
          await notifyBackground(snapshot);
          return { applied: true };
        } catch (error) {
          return {
            applied: false,
            warning: errorMessage(error),
            retry: () => notifyBackground(),
          };
        }
      });
      persistenceQueue = operation.then(
        () => undefined,
        () => undefined
      );
      return operation;
    }

    function notifyBackground(overrides = state.overrides, isRetry = false): Promise<void> {
      if (activeTabId === null) return Promise.reject(new Error('No active tab is available'));
      return new Promise((resolve, reject) => {
        try {
          chrome.runtime.sendMessage(
            {
              type: 'update',
              tabId: activeTabId,
              tabUrl: activeTabUrl,
              enabled: state.enabled,
              overrides,
            },
            (response: { success?: boolean; error?: string } | undefined) => {
              if (chrome.runtime.lastError) {
                const lastErrMsg = chrome.runtime.lastError.message || '';
                if (
                  !isRetry &&
                  (lastErrMsg.includes('message port closed') ||
                    lastErrMsg.includes('Could not establish connection'))
                ) {
                  window.setTimeout(() => {
                    notifyBackground(overrides, true).then(resolve, reject);
                  }, 150);
                  return;
                }
                reject(new Error(lastErrMsg));
                return;
              }
              if (!response || response.success === false) {
                reject(new Error(response?.error || 'Background did not confirm the update'));
                return;
              }
              resolve();
            }
          );
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
    }

    function toggleRule(index: number, enabled: boolean): void {
      if (index < 0 || index >= state.overrides.length) return;
      const nextOverrides = state.overrides.map((rule, ruleIndex) =>
        ruleIndex === index ? { ...rule, enabled } : rule
      );
      void persistRuleChange(
        saveState,
        nextOverrides,
        enabled ? 'Rule enabled' : 'Rule disabled',
        renderRules
      );
    }

    function deleteRule(index: number): void {
      if (index < 0 || index >= state.overrides.length) return;
      const nextOverrides = state.overrides.filter((_, ruleIndex) => ruleIndex !== index);
      void persistRuleChange(saveState, nextOverrides, 'Rule deleted', renderRules);
    }

    function duplicateRule(index: number): void {
      if (index < 0 || index >= state.overrides.length) return;
      const copy = JSON.parse(JSON.stringify(state.overrides[index]));
      const nextOverrides = [...state.overrides];
      nextOverrides.splice(index + 1, 0, copy);
      void persistRuleChange(saveState, nextOverrides, 'Rule duplicated', renderRules);
    }

    function openEditModal(index: number): void {
      const rule = state.overrides[index];
      if (!rule) return;

      state.currentEditIndex = index;
      elements.modalTitleText.textContent = 'Edit override';
      elements.modalUrl.textContent = rule.pattern;
      elements.modalPattern.value = rule.pattern;
      const storedMethod = (rule.method || 'ANY').toUpperCase();
      elements.modalMethod.value = KNOWN_METHODS.includes(storedMethod) ? storedMethod : 'ANY';

      let type: 'body' | 'redirect' | 'fail' = 'body';
      if (rule.failReason) type = 'fail';
      else if (rule.redirectUrl) type = 'redirect';

      const typeRadio = elements.modal.querySelector(
        `input[name="modal-override-type"][value="${type}"]`
      ) as HTMLInputElement;
      if (typeRadio) typeRadio.checked = true;

      updateModalVisibility(elements, type);
      elements.modalMode.value = rule.mode || 'text';
      elements.modalBody.value = formatJsonIfPossible(rule.body || '');
      elements.modalRedirectUrl.value = rule.redirectUrl || '';

      prefillAdvancedFields(elements, rule);
      updateBodyFormatAction(elements);
      updateImagePreview(elements, elements.modalBody.value);
      openModal(elements);
    }

    async function fillModalBody(url: string): Promise<void> {
      if (!options.autoFillOnOpen || activeTabId === null) return;
      const response = await new Promise<any>(resolve => {
        chrome.runtime.sendMessage({ type: 'getApiData', tabId: activeTabId, url }, resolve);
      });
      if (typeof response?.body === 'string' && response.body) {
        elements.modalBody.value = formatJsonIfPossible(response.body);
        updateBodyFormatAction(elements);
        updateImagePreview(elements, elements.modalBody.value);
      }
    }

    function handleApiClick(api: UiApi): void {
      const match = getMatchingRuleStatus(api, state.overrides);
      if (match) {
        openEditModal(match.index);
        void fillModalBody(api.url);
        return;
      }

      state.currentEditIndex = null;
      elements.modalTitleText.textContent = 'Add override';
      elements.modalUrl.textContent = api.url;

      try {
        const u = new URL(api.url);
        elements.modalPattern.value = u.pathname + u.search;
      } catch {
        elements.modalPattern.value = api.url;
      }

      elements.modalMethod.value = (api.method || 'ANY').toUpperCase();
      const bodyRadio = elements.modal.querySelector(
        'input[name="modal-override-type"][value="body"]'
      ) as HTMLInputElement;
      if (bodyRadio) bodyRadio.checked = true;

      updateModalVisibility(elements, 'body');
      elements.modalMode.value = 'text';
      elements.modalBody.value = formatJsonIfPossible(api.body || '');
      elements.modalRedirectUrl.value = '';

      prefillAdvancedFields(elements, null);
      updateBodyFormatAction(elements);
      updateImagePreview(elements, elements.modalBody.value);
      openModal(elements);
      void fillModalBody(api.url);
    }

    bindModalController({ elements, state, saveState, renderRules });
    bindRulesIoController({
      elements,
      state,
      getCurrentDomain: () => currentDomain,
      saveState,
      renderRules,
    });
    bindToolbarController({
      elements,
      state,
      getStorageKey,
      saveState,
      renderRules,
      renderApis,
      loadApis: () => loadApisWithRetry(),
      notifyBackground,
    });

    async function loadApisWithRetry(attempt = 0): Promise<void> {
      if (activeTabId === null) return;
      const response = await new Promise<any>(resolve => {
        chrome.runtime.sendMessage({ type: 'getApis', tabId: activeTabId }, resolve);
      });
      const apis = Array.isArray(response?.apis) ? response.apis : [];
      state.capturedApis = apis.map((api: ApiEntry) => ({
        ...api,
        type: normalizeApiType(api.type),
      }));
      renderApis();
      if (apis.length === 0 && attempt < 4) {
        window.setTimeout(() => void loadApisWithRetry(attempt + 1), 200);
      }
    }

    async function handleActiveTab(tab: chrome.tabs.Tab | undefined): Promise<void> {
      if (!tab || typeof tab.id !== 'number') return;
      activeTabId = tab.id;
      activeTabUrl = tab.url || '';

      if (tab.url) {
        try {
          currentDomain = NetworkOverridesUtils.getOrigin(tab.url);
        } catch {}
      }

      const overridesKey = getStorageKey('overrides');
      const enabledKey = getStorageKey('enabled');

      const data = await chrome.storage.local.get([
        overridesKey,
        enabledKey,
        GLOBAL_OVERRIDES_KEY,
        'overrides',
        'enabled',
      ]);
      const domainRules = Array.isArray(data[overridesKey])
        ? data[overridesKey]
        : Array.isArray(data.overrides)
          ? data.overrides
          : [];
      const globalRules = Array.isArray(data[GLOBAL_OVERRIDES_KEY])
        ? data[GLOBAL_OVERRIDES_KEY].filter((rule: OverrideRule) => rule?.isGlobal === true)
        : [];
      const seenGlobals = new Set<string>();
      const uniqueGlobals = [
        ...domainRules.filter((rule: OverrideRule) => rule?.isGlobal === true),
        ...globalRules,
      ].filter((rule: OverrideRule) => {
        const signature = JSON.stringify(rule);
        if (seenGlobals.has(signature)) return false;
        seenGlobals.add(signature);
        return true;
      });
      // Domain-specific rules take precedence over broader global rules.
      state.overrides = domainRules
        .filter((rule: OverrideRule) => rule?.isGlobal !== true)
        .concat(uniqueGlobals);
      state.enabled =
        typeof data[enabledKey] === 'boolean'
          ? data[enabledKey]
          : typeof data.enabled === 'boolean'
            ? data.enabled
            : false;
      elements.enableCheckbox.checked = state.enabled;
      renderRules();
      void notifyBackground().catch(() => {
        // Startup sync: if port closes during worker startup, ignore silently;
        // getStatus will report the real debugger attachment status.
      });

      if (!port) {
        port = chrome.runtime.connect({ name: 'network-overrides-ui' });
        port.onMessage.addListener((msg: any) => {
          if (msg.type === 'apis' && Array.isArray(msg.apis)) {
            state.capturedApis = msg.apis.map((api: ApiEntry) => ({
              ...api,
              type: normalizeApiType(api.type),
            }));
            renderApis();
          } else if (msg.type === 'apisDelta' && Array.isArray(msg.apis)) {
            const byUrl = new Map(state.capturedApis.map(api => [api.url, api]));
            msg.apis.forEach((api: ApiEntry) => {
              byUrl.set(api.url, { ...api, type: normalizeApiType(api.type) });
            });
            state.capturedApis = Array.from(byUrl.values());
            renderApis();
          } else if (msg.type === 'status') {
            updateAttachStatus(
              elements,
              state,
              getStorageKey('enabled'),
              !!msg.attached,
              msg.error
            );
          }
        });
        port.onDisconnect.addListener(() => {
          port = null;
          window.setTimeout(() => {
            if (activeTabId === null) return;
            void handleActiveTab({ id: activeTabId, url: activeTabUrl } as chrome.tabs.Tab);
          }, 100);
        });
      }
      port.postMessage({ type: 'subscribe', tabId: activeTabId });

      chrome.runtime.sendMessage({ type: 'getStatus', tabId: activeTabId }, resp => {
        if (resp) {
          updateAttachStatus(
            elements,
            state,
            getStorageKey('enabled'),
            !!resp.attached,
            resp.error
          );
        }
      });
      void loadApisWithRetry();
      loadProfiles(elements.profilesSelect, currentDomain);
    }

    function refreshActiveTab(): Promise<void> {
      return new Promise(resolve => {
        const finish = (tab: chrome.tabs.Tab | undefined) => {
          if (
            tab?.url?.startsWith('chrome-extension://') &&
            activeTabUrl &&
            !activeTabUrl.startsWith('chrome-extension://')
          ) {
            resolve();
            return;
          }
          void handleActiveTab(tab).finally(resolve);
        };
        // DevTools must target the inspected tab, which is not necessarily the
        // browser window's active tab.
        if (typeof chrome.devtools !== 'undefined' && chrome.devtools?.inspectedWindow?.tabId) {
          chrome.tabs.get(chrome.devtools.inspectedWindow.tabId, finish);
        } else {
          chrome.tabs.query({ active: true, currentWindow: true }, tabs => finish(tabs[0]));
        }
      });
    }

    void refreshActiveTab();
    window.addEventListener('focus', () => void refreshActiveTab());

    function addApis(newApis: ApiEntry[]): void {
      state.capturedApis.push(
        ...newApis.map(a => ({
          url: a.url,
          type: normalizeApiType(a.type),
          method: a.method,
          headers: a.headers,
          postData: a.postData,
          body: a.body,
          statusCode: a.statusCode,
        }))
      );
      renderApis();
    }

    return { addApis };
  }
}
