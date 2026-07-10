/// <reference types="chrome" />
/// <reference path="./shared.ts" />
/// <reference path="./utils.ts" />

namespace NetworkOverridesUi {
  type OverrideMode = NetworkOverridesShared.OverrideMode;
  type OverrideRule = NetworkOverridesShared.OverrideRule;
  type ApiEntry = NetworkOverridesShared.ApiEntry;

  let currentDomain = '';

  const TYPE_ORDER = [
    'xhr',
    'fetch',
    'script',
    'stylesheet',
    'image',
    'media',
    'font',
    'document',
    'websocket',
    'manifest',
    'eventsource',
    'texttrack',
    'other',
  ];
  const TYPE_LABELS: Record<string, string> = {
    xhr: 'XHR',
    fetch: 'Fetch',
    script: 'JS',
    stylesheet: 'CSS',
    image: 'Img',
    media: 'Media',
    font: 'Font',
    document: 'Doc',
    websocket: 'WS',
    manifest: 'Manifest',
    eventsource: 'EventSource',
    texttrack: 'TextTrack',
    other: 'Other',
  };

  export function matchPattern(pattern: string, url: string): string[] | null {
    return NetworkOverridesUtils.matchPattern(pattern, url);
  }

  export function substituteWildcards(template: string, captures: string[]): string {
    return NetworkOverridesUtils.substituteWildcards(template, captures);
  }

  export function patternMatches(pattern: string, url: string): boolean {
    return NetworkOverridesUtils.patternMatches(pattern, url);
  }

  function wouldApply(override: OverrideRule, api: ApiEntry): boolean {
    return (
      NetworkOverridesUtils.matchesMethod(override.method, api.method) &&
      patternMatches(override.pattern, api.url)
    );
  }

  const KNOWN_METHODS = ['ANY', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

  function resolveModalMethodValue(method: string | undefined): string {
    return method && KNOWN_METHODS.includes(method) ? method : 'ANY';
  }

  function isValidPattern(pattern: string): boolean {
    const trimmed = pattern.trim();
    if (trimmed === '*' || trimmed.toLowerCase() === 'all') {
      return true;
    }
    if (NetworkOverridesUtils.isRegexPattern(trimmed)) {
      const lastSlash = trimmed.lastIndexOf('/');
      const source = trimmed.slice(1, lastSlash);
      const flags = trimmed.slice(lastSlash + 1);
      try {
        new RegExp(source, flags);
        return true;
      } catch {
        return false;
      }
    }
    if (trimmed.includes('*')) {
      const parts = trimmed.split('*').map(NetworkOverridesUtils.escapeRegex);
      try {
        new RegExp('^' + parts.join('(.*)') + '$');
        return true;
      } catch {
        return false;
      }
    }
    return trimmed.length > 0;
  }

  function domainKey(suffix: string): string {
    return currentDomain ? `${suffix}_${currentDomain}` : suffix;
  }

  interface Elements {
    enableCheckbox: HTMLInputElement;
    attachStatus: HTMLElement;
    patternInput: HTMLInputElement;
    bodyInput: HTMLTextAreaElement;
    addBtn: HTMLButtonElement;
    listEl: HTMLUListElement;
    modeSelect: HTMLSelectElement;
    apisSection: HTMLDivElement;
    apiSearchInput: HTMLInputElement;
    apisList: HTMLDivElement;
    tabsContainer: HTMLDivElement;
    overridesSection: HTMLDivElement;
    modal: HTMLDivElement;
    modalUrl: HTMLElement;
    modalTitleText: HTMLElement;
    modalPattern: HTMLInputElement;
    modalMethod: HTMLSelectElement;
    modalMode: HTMLSelectElement;
    modalBody: HTMLTextAreaElement;
    modalRedirectUrl: HTMLInputElement;
    modalBodyFields: HTMLDivElement;
    modalRedirectFields: HTMLDivElement;
    saveOverrideBtn: HTMLButtonElement;
    formatJsonBtn: HTMLButtonElement;
    bodyTypeBadge: HTMLElement;
    closeModal: HTMLElement;
    newRow: HTMLDivElement;
    refreshBtn: HTMLButtonElement;
    infoBtn: HTMLButtonElement;
    redirectUrlInput: HTMLInputElement;
    addApiBtn: HTMLButtonElement;
    exportRulesBtn: HTMLButtonElement;
    importRulesBtn: HTMLButtonElement;
    importRulesInput: HTMLInputElement;
  }

  export interface AppOptions {
    autoFillOnOpen: boolean;
    showManualEditor: boolean;
  }

  export interface UiApi {
    addApis: (newApis: ApiEntry[]) => void;
  }

  export function init(options: AppOptions): UiApi {
    const elements = getElements();
    const state = {
      overrides: [] as OverrideRule[],
      apis: [] as ApiEntry[],
      apiSearchTerm: '',
      currentTab: 'other' as 'overridden' | 'other' | 'overrides',
      collapsedTypes: {} as Record<string, boolean>,
      selectedApi: null as string | null,
      currentEditIndex: null as number | null,
      autoFillFromPayload: true,
    };
    elements.overridesSection.style.display = 'none';

    elements.newRow.style.display = options.showManualEditor ? '' : 'none';

    const apiByUrl = new Map<string, ApiEntry>();
    let apiStreamPort: chrome.runtime.Port | null = null;
    let subscribedTabId: number | null = null;

    async function persistApiUiState(): Promise<void> {
      await chrome.storage.local.set({
        apiSearchTerm: state.apiSearchTerm,
      });
    }

    function renderAttachStatus(attached: boolean, error?: string): void {
      const el = elements.attachStatus;
      if (!el) return;
      el.classList.remove('attach-status--on', 'attach-status--error');
      if (error) {
        el.classList.add('attach-status--error');
        el.textContent = `Attach failed: ${error}`;
        el.style.display = '';
      } else if (attached) {
        el.classList.add('attach-status--on');
        el.textContent = 'Intercepting requests';
        el.style.display = '';
      } else {
        el.textContent = '';
        el.style.display = 'none';
      }
    }

    async function refreshAttachStatus(): Promise<void> {
      const tab = await getActiveTab();
      if (typeof tab?.id !== 'number') return;
      const response = await new Promise<any>(resolve => {
        chrome.runtime.sendMessage({ type: 'getStatus', tabId: tab.id }, resolve);
      });
      if (response?.type === 'statusResponse') {
        renderAttachStatus(!!response.attached, response.error);
        // Same behavior as the port 'status' push: a failed attach means
        // nothing is intercepted, so the toggle must not stay checked.
        if (response.error) {
          elements.enableCheckbox.checked = false;
          void chrome.storage.local.set({ enabled: false });
        }
      }
    }

    function addApisToState(newApis: ApiEntry[]): void {
      let changed = false;
      newApis.forEach(entry => {
        const { url } = entry;
        const existing = apiByUrl.get(url);
        if (existing) {
          if (entry.body && !existing.body) {
            existing.body = entry.body;
            changed = true;
          }
        } else {
          state.apis.push(entry);
          apiByUrl.set(url, entry);
          changed = true;
        }
      });
      if (changed) {
        renderApis();
      }
    }

    async function startApiStream(): Promise<void> {
      const tab = await getActiveTab();
      const tabId = tab?.id;
      if (typeof tabId !== 'number') return;

      if (apiStreamPort && subscribedTabId === tabId) {
        return;
      }

      try {
        if (apiStreamPort) {
          try {
            apiStreamPort.disconnect();
          } catch {}
        }

        const port = chrome.runtime.connect({ name: 'network-overrides-ui' });
        apiStreamPort = port;
        subscribedTabId = tabId;
        port.onDisconnect.addListener(() => {
          if (apiStreamPort === port) {
            apiStreamPort = null;
            subscribedTabId = null;
          }
        });
        port.onMessage.addListener((msg: any) => {
          if (!msg || typeof msg !== 'object') return;
          if (msg.type === 'status') {
            renderAttachStatus(!!msg.attached, msg.error);
            if (msg.error) {
              elements.enableCheckbox.checked = false;
              void chrome.storage.local.set({ enabled: false });
            }
            return;
          }
          if (msg.type === 'apis' && Array.isArray(msg.apis)) {
            addApisToState(msg.apis as ApiEntry[]);
            return;
          }
          if (msg.type === 'apisDelta' && Array.isArray(msg.apis)) {
            addApisToState(msg.apis as ApiEntry[]);
            return;
          }
          if (msg.type === 'api' && msg.api && typeof msg.api.url === 'string') {
            addApisToState([msg.api as ApiEntry]);
            return;
          }
        });
        port.postMessage({ type: 'subscribe', tabId });
      } catch {
        // Port is optional; keep manual refresh working.
      }
    }

    function renderList(): void {
      elements.listEl.innerHTML = '';
      state.overrides.forEach((override, index) => {
        const li = document.createElement('li');
        li.className = 'override-item';
        if (override.enabled === false) {
          li.classList.add('override-item--disabled');
        }
        const methodBadge =
          override.method && override.method !== 'ANY'
            ? `<span class="override-method-badge">${escapeHtml(override.method)}</span> `
            : '';
        li.innerHTML = `
          <div class="override-item-main">
            <input
              type="checkbox"
              class="override-enabled-toggle"
              data-index="${index}"
              ${override.enabled === false ? '' : 'checked'}
              title="Enable/disable this rule"
            />
            <div class="override-item-info">
              <b class="override-pattern">${escapeHtml(override.pattern)}</b>
              ${override.redirectUrl ? `<div class="override-redirect">→ ${escapeHtml(override.redirectUrl)}</div>` : ''}
              <div class="override-meta">${methodBadge}${escapeHtml(override.mode)}${override.body ? ` · ${escapeHtml(override.body.substring(0, 80))}${override.body.length > 80 ? '…' : ''}` : ''}</div>
            </div>
            <div class="override-item-actions">
              <button data-index="${index}" class="edit-btn" title="Edit">✎</button>
              <button data-index="${index}" class="del-btn" title="Delete">✕</button>
            </div>
          </div>
        `;
        elements.listEl.appendChild(li);
      });
      updateTabLabels();
    }

    function setModalOverrideType(type: 'body' | 'redirect'): void {
      const bodyRadio = document.querySelector(
        'input[name="modal-override-type"][value="body"]'
      ) as HTMLInputElement;
      const redirectRadio = document.querySelector(
        'input[name="modal-override-type"][value="redirect"]'
      ) as HTMLInputElement;
      bodyRadio.checked = type === 'body';
      redirectRadio.checked = type === 'redirect';
      elements.modalBodyFields.style.display = type === 'body' ? '' : 'none';
      elements.modalRedirectFields.style.display = type === 'redirect' ? '' : 'none';
      elements.modalPattern.disabled = type === 'body';
    }

    function updateBodyTypeBadge(): void {
      const val = elements.modalBody.value.trim();
      if (!val) {
        elements.bodyTypeBadge.textContent = 'text';
        elements.bodyTypeBadge.classList.remove('json');
        return;
      }
      try {
        JSON.parse(val);
        elements.bodyTypeBadge.textContent = 'json';
        elements.bodyTypeBadge.classList.add('json');
      } catch {
        elements.bodyTypeBadge.textContent = 'text';
        elements.bodyTypeBadge.classList.remove('json');
      }
    }

    function openOverrideModalForIndex(index: number): void {
      const existing = state.overrides[index];
      if (!existing) {
        return;
      }

      state.selectedApi = existing.pattern;
      state.currentEditIndex = index;
      elements.modalUrl.textContent = formatApiLabel(existing.pattern);
      elements.modalUrl.title = existing.pattern;
      elements.modalTitleText.textContent = 'Edit override';
      elements.modalPattern.value = existing.pattern;
      elements.modalMethod.value = resolveModalMethodValue(existing.method);
      elements.modalMode.value = existing.mode || 'text';
      elements.modalBody.value = formatJsonIfPossible(existing.body || '');
      elements.modalRedirectUrl.value = existing.redirectUrl || '';
      setModalOverrideType(existing.redirectUrl ? 'redirect' : 'body');
      elements.modal.style.display = 'block';
      updateBodyTypeBadge();
      elements.modalBody.focus();
    }

    async function openOverrideModal(url: string): Promise<void> {
      state.selectedApi = url;
      elements.modalUrl.textContent = formatApiLabel(url);
      elements.modalUrl.title = url;

      let existingIndex = state.overrides.findIndex(override => override.pattern === url);
      if (existingIndex === -1) {
        existingIndex = state.overrides.findIndex(override =>
          patternMatches(override.pattern, url)
        );
      }

      state.currentEditIndex = existingIndex !== -1 ? existingIndex : null;
      const existing =
        state.currentEditIndex !== null ? state.overrides[state.currentEditIndex] : null;

      elements.modalPattern.value = existing ? existing.pattern : url;

      if (existing) {
        elements.modalTitleText.textContent = 'Edit override';
        elements.modalBody.value = formatJsonIfPossible(existing.body || '');
        elements.modalMode.value = existing.mode || 'text';
        elements.modalMethod.value = resolveModalMethodValue(existing.method);
        elements.modalRedirectUrl.value = existing.redirectUrl || '';
        setModalOverrideType(existing.redirectUrl ? 'redirect' : 'body');
      } else {
        elements.modalTitleText.textContent = 'New override';
        elements.modalMode.value = 'text';
        elements.modalRedirectUrl.value = '';
        setModalOverrideType('body');

        const capturedMethod = apiByUrl.get(url)?.method?.toUpperCase();
        elements.modalMethod.value = resolveModalMethodValue(capturedMethod);

        const apiEntry = apiByUrl.get(url);
        if (apiEntry?.body) {
          elements.modalBody.value = formatJsonIfPossible(apiEntry.body);
        } else {
          elements.modalBody.value = '';
        }

        if (!apiEntry?.body && options.autoFillOnOpen && state.autoFillFromPayload) {
          await fillModalWithCurrentBody(url, elements.modalBody);
        }
      }

      elements.modal.style.display = 'block';
      updateBodyTypeBadge();
      elements.modalBody.focus();
    }

    function closeOverrideModal(): void {
      elements.modal.style.display = 'none';
      state.selectedApi = null;
      state.currentEditIndex = null;
      elements.modalTitleText.textContent = '';
      elements.modalUrl.title = '';
      renderApis();
    }

    function renderApis(): void {
      elements.apisList.innerHTML = '';
      const searchTerm = state.apiSearchTerm.trim().toLowerCase();

      const visibleApis = state.apis.filter(
        api => !searchTerm || api.url.toLowerCase().includes(searchTerm)
      );
      const overriddenApis = visibleApis.filter(api =>
        state.overrides.some(override => wouldApply(override, api))
      );
      const otherApis = visibleApis.filter(
        api => !state.overrides.some(override => wouldApply(override, api))
      );

      if (state.currentTab === 'overridden') {
        appendApiBucket(overriddenApis, searchTerm);
      } else {
        appendApiBucket(otherApis, searchTerm);
      }

      if (elements.apisList.childElementCount === 0) {
        const emptyState = document.createElement('div');
        emptyState.className = 'api-empty-state';
        emptyState.textContent = searchTerm
          ? `No APIs match "${state.apiSearchTerm}".`
          : 'No captured APIs yet.';
        elements.apisList.appendChild(emptyState);
      }
      updateTabLabels();
    }

    function switchTab(tab: 'overridden' | 'other' | 'overrides'): void {
      state.currentTab = tab;

      elements.tabsContainer
        .querySelectorAll('.tab-btn')
        .forEach(btn => btn.classList.toggle('active', (btn as HTMLElement).dataset.tab === tab));

      elements.apisSection.style.display = 'none';
      elements.overridesSection.style.display = 'none';

      if (tab === 'overrides') {
        elements.overridesSection.style.display = 'block';
        renderList();
      } else {
        elements.apisSection.style.display = 'block';
        renderApis();
      }
    }

    function updateTabLabels(): void {
      const overriddenCount = state.apis.filter(api =>
        state.overrides.some(override => wouldApply(override, api))
      ).length;
      const otherCount = state.apis.length - overriddenCount;

      elements.tabsContainer.querySelectorAll('.tab-btn').forEach(btn => {
        const tab = (btn as HTMLElement).dataset.tab;
        if (tab === 'other') btn.textContent = `Captured APIs (${otherCount})`;
        else if (tab === 'overridden') btn.textContent = `Overridden (${overriddenCount})`;
        else if (tab === 'overrides') btn.textContent = `Rules (${state.overrides.length})`;
      });
    }

    function renderApiSection(type: string, apis: ApiEntry[], searchTerm: string): HTMLDivElement {
      const collKey = `${state.currentTab}_${type}`;
      const isCollapsed = !!state.collapsedTypes[collKey];

      const section = document.createElement('div');
      section.className = 'api-section';

      const ul = document.createElement('ul');
      ul.style.display = isCollapsed ? 'none' : '';

      const h4 = document.createElement('h4');
      h4.style.cursor = 'pointer';
      h4.style.userSelect = 'none';
      h4.appendChild(document.createTextNode(`${TYPE_LABELS[type] || type.toUpperCase()} `));
      const count = document.createElement('span');
      count.className = 'api-count';
      count.textContent = String(apis.length);
      h4.appendChild(count);
      h4.appendChild(document.createTextNode(' '));
      const chevron = document.createElement('span');
      chevron.className = 'type-chevron';
      chevron.textContent = isCollapsed ? '▶' : '▼';
      h4.appendChild(chevron);
      h4.addEventListener('click', () => {
        state.collapsedTypes[collKey] = !state.collapsedTypes[collKey];
        void persistApiUiState();
        ul.style.display = state.collapsedTypes[collKey] ? 'none' : '';
        chevron.textContent = state.collapsedTypes[collKey] ? '▶' : '▼';
      });
      section.appendChild(h4);

      apis.forEach(api => {
        const li = document.createElement('li');
        li.className = 'api-item';
        const matchingOverrides = state.overrides.filter(override => wouldApply(override, api));
        const matchedOverride =
          matchingOverrides.find(override => override.enabled !== false) ?? matchingOverrides[0];
        const isOverridden = matchingOverrides.length > 0;
        const isSelected = state.selectedApi ? patternMatches(state.selectedApi, api.url) : false;
        if (isOverridden) li.classList.add('active');
        if (matchedOverride?.enabled === false) li.classList.add('api-item--rule-disabled');
        if (isSelected) li.classList.add('selected');
        li.dataset.url = api.url;
        const statusLabel =
          typeof api.statusCode === 'number'
            ? `<span class="api-status">${api.statusCode}</span> `
            : '';
        li.innerHTML = `
          <div class="api-item-content">
            <b title="${escapeHtml(api.url)}">${highlightApiLabel(api.url, searchTerm)} ${statusLabel}</b>
          </div>
          <div class="api-item-controls">
            <button class="copy-curl-btn" title="Copy cURL">cURL</button>
          </div>
        `;
        li.addEventListener('click', event => {
          const target = event.target as HTMLElement;
          if (target.classList.contains('copy-curl-btn')) {
            event.stopPropagation();
            void copyCurl(api);
            return;
          }
          void openOverrideModal(api.url);
        });
        ul.appendChild(li);
      });

      section.appendChild(ul);
      return section;
    }

    function appendApiBucket(apis: ApiEntry[], searchTerm: string): void {
      if (apis.length === 0) return;

      const grouped: Record<string, ApiEntry[]> = {};

      apis.forEach(api => {
        const t = normalizeApiType(api.type);
        if (!grouped[t]) grouped[t] = [];
        grouped[t].push(api);
      });

      const bucket = document.createElement('div');
      bucket.className = 'api-bucket';

      TYPE_ORDER.forEach(type => {
        if (!grouped[type]?.length) return;
        bucket.appendChild(renderApiSection(type, grouped[type], searchTerm));
      });

      elements.apisList.appendChild(bucket);
    }

    async function loadApis(): Promise<number> {
      const tab = await getActiveTab();
      const tabId = tab?.id;
      if (typeof tabId !== 'number') {
        return 0;
      }

      const newDomain = tab?.url ? NetworkOverridesUtils.getOrigin(tab.url) : '';
      if (newDomain && newDomain !== currentDomain) {
        currentDomain = newDomain;
        const data = await chrome.storage.local.get([domainKey('overrides')]);
        state.overrides = data[domainKey('overrides')] || [];
        renderList();
        updateTabLabels();
        await notifyBackground();
      }

      return new Promise(resolve => {
        chrome.runtime.sendMessage({ type: 'getApis', tabId }, (response: any) => {
          const apisResponse = response?.apis;
          if (Array.isArray(apisResponse)) {
            const existingBodies = new Map<string, string>();
            state.apis.forEach(api => {
              if (api.body) existingBodies.set(api.url, api.body);
            });

            state.apis = apisResponse;
            apiByUrl.clear();
            state.apis.forEach(api => apiByUrl.set(api.url, api));

            state.apis.forEach(api => {
              if (!api.body && existingBodies.has(api.url)) {
                api.body = existingBodies.get(api.url);
              }
            });

            renderApis();
            resolve(apisResponse.length);
            return;
          }

          resolve(0);
        });
      });
    }

    async function refreshApisWithRetry(): Promise<void> {
      elements.refreshBtn.classList.add('loading');
      const attempts = 5;
      try {
        for (let attempt = 0; attempt < attempts; attempt += 1) {
          const count = await loadApis();
          if (count > 0) {
            return;
          }
          if (attempt < attempts - 1) {
            await delay(250);
          }
        }
      } finally {
        elements.refreshBtn.classList.remove('loading');
      }
    }

    async function notifyBackground(): Promise<void> {
      const tab = await getActiveTab();
      if (typeof tab?.id !== 'number') {
        return;
      }

      const overridesKey = domainKey('overrides');
      const data = await chrome.storage.local.get(['enabled', overridesKey, 'overrides']);
      const domainOverrides = data[overridesKey];
      const flatOverrides = data['overrides'];
      chrome.runtime.sendMessage({
        type: 'update',
        tabId: tab.id,
        tabUrl: tab.url,
        enabled: !!data['enabled'],
        overrides: domainOverrides !== undefined ? domainOverrides : flatOverrides || [],
      });
    }

    async function persistOverrides(): Promise<void> {
      await chrome.storage.local.set({ [domainKey('overrides')]: state.overrides });
      renderList();
      renderApis();
      await notifyBackground();
    }

    elements.addBtn.addEventListener('click', async () => {
      const pattern = elements.patternInput.value.trim();
      if (!pattern) {
        alert('Pattern is required');
        return;
      }
      if (!isValidPattern(pattern)) {
        alert('Invalid pattern format');
        return;
      }

      const mode = elements.modeSelect.value as OverrideMode;
      const body = elements.bodyInput.value || '';
      const redirectUrl = elements.redirectUrlInput.value.trim() || undefined;

      const override: OverrideRule = { pattern, body, mode };
      if (redirectUrl) {
        override.redirectUrl = redirectUrl;
      }

      state.overrides.push(override);
      try {
        await chrome.storage.local.set({ [domainKey('overrides')]: state.overrides });
      } catch (e) {
        state.overrides.pop();
        alert(`Failed to save override: ${e instanceof Error ? e.message : String(e)}`);
        return;
      }

      elements.patternInput.value = '';
      elements.bodyInput.value = '';
      elements.redirectUrlInput.value = '';

      renderList();
      renderApis();
      await notifyBackground();
    });

    elements.listEl.addEventListener('click', async event => {
      const target = event.target as HTMLElement;
      const index = Number(target.dataset.index);
      if (Number.isNaN(index)) {
        return;
      }

      if (target.classList.contains('edit-btn')) {
        openOverrideModalForIndex(index);
        return;
      }

      if (!target.classList.contains('del-btn')) {
        return;
      }

      state.overrides.splice(index, 1);
      await chrome.storage.local.set({ [domainKey('overrides')]: state.overrides });
      renderList();
      renderApis();
      await notifyBackground();
    });

    elements.listEl.addEventListener('change', async event => {
      const target = event.target as HTMLElement;
      if (!target.classList.contains('override-enabled-toggle')) {
        return;
      }
      const index = Number(target.dataset.index);
      if (Number.isNaN(index) || !state.overrides[index]) {
        return;
      }
      state.overrides[index].enabled = (target as HTMLInputElement).checked;
      await persistOverrides();
    });

    elements.closeModal.addEventListener('click', closeOverrideModal);
    window.addEventListener('click', event => {
      if (event.target === elements.modal) {
        closeOverrideModal();
      }
    });

    elements.saveOverrideBtn.addEventListener('click', async () => {
      if (!state.selectedApi) {
        return;
      }

      const pattern = elements.modalPattern.value.trim() || state.selectedApi;
      if (!isValidPattern(pattern)) {
        alert('Invalid pattern format');
        return;
      }

      const isRedirect =
        (document.querySelector('input[name="modal-override-type"]:checked') as HTMLInputElement)
          ?.value === 'redirect';

      const mode = isRedirect ? 'text' : (elements.modalMode.value as OverrideMode);
      const body = isRedirect ? '' : elements.modalBody.value || '';
      const redirectUrl = isRedirect
        ? elements.modalRedirectUrl.value.trim() || undefined
        : undefined;
      const method = elements.modalMethod.value;

      const oldOverride =
        state.currentEditIndex !== null && state.overrides[state.currentEditIndex]
          ? { ...state.overrides[state.currentEditIndex] }
          : null;

      const override: OverrideRule = { pattern, body, mode };
      if (redirectUrl) {
        override.redirectUrl = redirectUrl;
      }
      if (method && method !== 'ANY') {
        override.method = method;
      }
      if (oldOverride?.enabled === false) {
        override.enabled = false;
      }

      if (state.currentEditIndex !== null && state.overrides[state.currentEditIndex]) {
        state.overrides[state.currentEditIndex] = override;
      } else {
        state.overrides.unshift(override);
      }

      try {
        await persistOverrides();
      } catch (e) {
        if (oldOverride) {
          state.overrides[state.currentEditIndex!] = oldOverride;
        } else {
          state.overrides.shift();
        }
        alert(`Failed to save override: ${e instanceof Error ? e.message : String(e)}`);
        return;
      }
      closeOverrideModal();
    });

    elements.formatJsonBtn.addEventListener('click', () => {
      const current = elements.modalBody.value;
      const formatted = formatJsonIfPossible(current);
      if (formatted !== current) {
        elements.modalBody.value = formatted;
        updateBodyTypeBadge();
      }
    });

    elements.modalBody.addEventListener('input', updateBodyTypeBadge);

    document.querySelectorAll('input[name="modal-override-type"]').forEach(radio => {
      radio.addEventListener('change', () => {
        setModalOverrideType((radio as HTMLInputElement).value as 'body' | 'redirect');
      });
    });

    elements.enableCheckbox.addEventListener('change', async () => {
      await chrome.storage.local.set({ enabled: elements.enableCheckbox.checked });
      await notifyBackground();
      // The port broadcast corrects this moments later if attach is still in flight.
      await refreshAttachStatus();
    });

    elements.refreshBtn.addEventListener('click', async () => {
      await refreshApisWithRetry();
    });

    elements.infoBtn.addEventListener('click', () => {
      window.open('guide.html', '_blank');
    });

    elements.addApiBtn.addEventListener('click', () => {
      state.selectedApi = '__new__';
      state.currentEditIndex = null;
      elements.modalUrl.textContent = '';
      elements.modalUrl.title = '';
      elements.modalTitleText.textContent = 'New override';
      elements.modalPattern.value = '';
      elements.modalMethod.value = 'ANY';
      elements.modalMode.value = 'text';
      elements.modalBody.value = '';
      elements.modalRedirectUrl.value = '';
      setModalOverrideType('body');
      elements.modalPattern.disabled = false;
      elements.modal.style.display = 'block';
      updateBodyTypeBadge();
      elements.modalPattern.focus();
    });

    elements.exportRulesBtn.addEventListener('click', () => {
      let blob: Blob;
      try {
        // Bodies that hold JSON objects/arrays are exported as real nested
        // JSON (pretty-printed with the envelope, no escaped-string noise);
        // import converts them back to string bodies.
        const compactRules = state.overrides.map(override => {
          if (!override.body) return override;
          try {
            const parsed = JSON.parse(override.body);
            if (parsed !== null && typeof parsed === 'object') {
              return { ...override, body: parsed as unknown as string };
            }
            return override;
          } catch {
            return override;
          }
        });
        const payload = {
          version: 1,
          domain: currentDomain,
          exportedAt: new Date().toISOString(),
          overrides: compactRules,
        };
        blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      } catch (e) {
        alert(`Failed to export rules: ${e instanceof Error ? e.message : String(e)}`);
        return;
      }
      const url = URL.createObjectURL(blob);
      const safeDomain = currentDomain.replace(/[^a-z0-9.-]+/gi, '_') || 'rules';
      const a = document.createElement('a');
      a.href = url;
      a.download = `network-overrides-${safeDomain}-${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    });

    elements.importRulesBtn.addEventListener('click', () => {
      elements.importRulesInput.value = '';
      elements.importRulesInput.click();
    });

    elements.importRulesInput.addEventListener('change', async () => {
      const file = elements.importRulesInput.files?.[0];
      if (!file) {
        return;
      }

      let parsed: any;
      try {
        parsed = JSON.parse(await file.text());
      } catch (e) {
        alert(`Invalid file: ${e instanceof Error ? e.message : String(e)}`);
        return;
      }

      if (!parsed || !Array.isArray(parsed.overrides)) {
        alert('Invalid file: missing "overrides" list.');
        return;
      }

      const isValidRule = (rule: any): boolean =>
        !!rule &&
        typeof rule.pattern === 'string' &&
        (rule.mode === 'text' || rule.mode === 'file') &&
        (rule.method === undefined ||
          (typeof rule.method === 'string' && KNOWN_METHODS.includes(rule.method.toUpperCase()))) &&
        (rule.body === undefined ||
          typeof rule.body === 'string' ||
          (typeof rule.body === 'object' && rule.body !== null)) &&
        (rule.redirectUrl === undefined || typeof rule.redirectUrl === 'string') &&
        (rule.enabled === undefined || typeof rule.enabled === 'boolean');
      if (!parsed.overrides.every(isValidRule)) {
        alert(
          'Invalid file: a rule has a missing/invalid "pattern", "mode", "method", or field type.'
        );
        return;
      }

      if (typeof parsed.domain === 'string' && parsed.domain && parsed.domain !== currentDomain) {
        const proceedDespiteDomainMismatch = confirm(
          `This file was exported from "${parsed.domain}", but you are on "${currentDomain}". Import into "${currentDomain}" anyway?`
        );
        if (!proceedDespiteDomainMismatch) {
          return;
        }
      }

      // Only carry over known OverrideRule fields; drop anything else an
      // untrusted file might have included so it never reaches storage/background.
      const importedRules: OverrideRule[] = parsed.overrides.map((rule: any): OverrideRule => {
        const clean = { pattern: rule.pattern, mode: rule.mode } as OverrideRule;
        if (rule.body !== undefined) {
          // Nested-JSON bodies (the export format) become string bodies again.
          clean.body = typeof rule.body === 'string' ? rule.body : JSON.stringify(rule.body);
        }
        if (rule.redirectUrl !== undefined) clean.redirectUrl = rule.redirectUrl;
        if (rule.enabled !== undefined) clean.enabled = rule.enabled;
        if (rule.method !== undefined) clean.method = rule.method.toUpperCase();
        return clean;
      });

      if (state.overrides.length > 0) {
        const merge = confirm(
          'Rules already exist for this domain.\nOK = append the imported rules to the end of the list.\nCancel = delete the existing rules and replace them with the imported file.'
        );
        state.overrides = merge ? [...state.overrides, ...importedRules] : importedRules;
      } else {
        state.overrides = importedRules;
      }

      await persistOverrides();
    });

    elements.tabsContainer.addEventListener('click', event => {
      const btn = (event.target as HTMLElement).closest('.tab-btn') as HTMLElement;
      if (btn?.dataset.tab) {
        switchTab(btn.dataset.tab as 'overridden' | 'other' | 'overrides');
      }
    });

    elements.apiSearchInput.addEventListener('input', () => {
      state.apiSearchTerm = elements.apiSearchInput.value;
      void persistApiUiState();
      renderApis();
    });

    void (async () => {
      const tab = await getActiveTab();
      if (tab?.url) {
        currentDomain = NetworkOverridesUtils.getOrigin(tab.url);
      }

      const data = await chrome.storage.local.get(
        [
          'enabled',
          currentDomain && domainKey('enabled'),
          currentDomain && domainKey('overrides'),
          'overrides',
          'apiSearchTerm',
        ].filter(Boolean)
      );

      let savedEnabled = data['enabled'];
      if (savedEnabled === undefined) {
        savedEnabled = data[domainKey('enabled')];
        if (savedEnabled !== undefined) {
          await chrome.storage.local.set({ enabled: !!savedEnabled });
        }
      }
      elements.enableCheckbox.checked = !!savedEnabled;

      const domainOverrides = data[domainKey('overrides')];
      const flatOverrides = data['overrides'];
      state.overrides = domainOverrides !== undefined ? domainOverrides : flatOverrides || [];

      if (flatOverrides?.length && domainOverrides === undefined && currentDomain) {
        await chrome.storage.local.set({ [domainKey('overrides')]: flatOverrides });
      }

      state.apiSearchTerm = typeof data.apiSearchTerm === 'string' ? data.apiSearchTerm : '';
      elements.apiSearchInput.value = state.apiSearchTerm;

      await notifyBackground();
      await refreshAttachStatus();
      await refreshApisWithRetry();
      await startApiStream();
      switchTab('other');
    })();

    window.addEventListener('focus', () => void startApiStream());
    // onDisconnect already triggers a reconnect as soon as the port dies; this is
    // just a low-frequency safety net in case a disconnect event is ever missed.
    window.setInterval(() => void startApiStream(), 15000);

    let scrollTimer: ReturnType<typeof setTimeout> | null = null;
    const scrollContainers = [
      document.body,
      ...Array.from(document.querySelectorAll<HTMLElement>('.modal, .modal-content')),
    ].filter(Boolean);
    document.addEventListener(
      'scroll',
      () => {
        scrollContainers.forEach(el => el.classList.add('scrolling'));
        if (scrollTimer) clearTimeout(scrollTimer);
        scrollTimer = setTimeout(() => {
          scrollContainers.forEach(el => el.classList.remove('scrolling'));
        }, 500);
      },
      { passive: true }
    );

    return {
      addApis: addApisToState,
    };
  }

  async function fillModalWithCurrentBody(url: string, target: HTMLTextAreaElement): Promise<void> {
    const tab = await getActiveTab();
    const tabId = tab?.id;
    if (typeof tabId !== 'number') {
      return;
    }

    const response = await new Promise<any>(resolve => {
      chrome.runtime.sendMessage({ type: 'getApiData', tabId, url }, resolve);
    });

    if (response?.body) {
      target.value = formatJsonIfPossible(response.body);
    }
  }

  async function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
    if (typeof chrome.devtools !== 'undefined' && chrome.devtools?.inspectedWindow?.tabId) {
      return new Promise(resolve => {
        chrome.tabs.get(chrome.devtools.inspectedWindow.tabId, tab => resolve(tab));
      });
    }
    return new Promise(resolve => {
      chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
        resolve(tabs[0]);
      });
    });
  }

  function delay(ms: number): Promise<void> {
    return new Promise(resolve => {
      window.setTimeout(resolve, ms);
    });
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
      saveOverrideBtn: document.getElementById('save-override') as HTMLButtonElement,
      formatJsonBtn: document.getElementById('format-json-btn') as HTMLButtonElement,
      bodyTypeBadge: document.getElementById('body-type-badge') as HTMLElement,
      closeModal: document.querySelector('.close') as HTMLElement,
      newRow: document.getElementById('new-row') as HTMLDivElement,
      refreshBtn: document.getElementById('refresh-apis') as HTMLButtonElement,
      infoBtn: document.getElementById('info-btn') as HTMLButtonElement,
      redirectUrlInput: document.getElementById('redirect-url') as HTMLInputElement,
      addApiBtn: document.getElementById('add-api-btn') as HTMLButtonElement,
      exportRulesBtn: document.getElementById('export-rules-btn') as HTMLButtonElement,
      importRulesBtn: document.getElementById('import-rules-btn') as HTMLButtonElement,
      importRulesInput: document.getElementById('import-rules-input') as HTMLInputElement,
    };
  }

  export function escapeHtml(value: string): string {
    const replacements: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };

    return value.replace(/[&<>"']/g, char => replacements[char] || char);
  }

  export function highlightApiLabel(url: string, rawSearchTerm: string): string {
    const label = formatApiLabel(url);
    const searchTerm = rawSearchTerm.trim().toLowerCase();
    if (!searchTerm) {
      return escapeHtml(label);
    }

    const lowerLabel = label.toLowerCase();
    const matchIndex = lowerLabel.indexOf(searchTerm);
    if (matchIndex === -1) {
      return escapeHtml(label);
    }

    const before = escapeHtml(label.slice(0, matchIndex));
    const match = escapeHtml(label.slice(matchIndex, matchIndex + searchTerm.length));
    const after = escapeHtml(label.slice(matchIndex + searchTerm.length));
    return `${before}<mark class="api-match">${match}</mark>${after}`;
  }

  export function formatApiLabel(url: string): string {
    if (!url.startsWith('data:')) {
      return url;
    }

    const commaIndex = url.indexOf(',');
    const prefix = commaIndex === -1 ? url : url.slice(0, commaIndex);
    const mediaType = prefix.slice(5) || 'unknown';
    return `[data URL: ${mediaType}]`;
  }

  export function formatJsonIfPossible(value: string): string {
    try {
      const parsed = JSON.parse(value);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return value;
    }
  }

  export function normalizeApiType(type: any): string {
    const rawType = typeof type === 'string' ? type : 'other';
    const normalized = rawType.toLowerCase();
    if (normalized === 'xmlhttprequest') {
      return 'xhr';
    }
    return normalized;
  }

  async function copyCurl(api: ApiEntry): Promise<void> {
    const curl = generateCurl(api);
    await copyToClipboard(curl);
  }

  function generateCurl(api: ApiEntry): string {
    const method = (api.method || 'GET').toUpperCase();
    let curl = `curl '${api.url}' \\\n  -X '${method}'`;

    if (api.headers && api.headers.length > 0) {
      api.headers.forEach(h => {
        curl += ` \\\n  -H '${h.name}: ${h.value}'`;
      });
    }

    if (api.postData) {
      curl += ` \\\n  --data-raw '${api.postData.replace(/'/g, "'\\''")}'`;
    }

    return curl;
  }

  async function copyToClipboard(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
    } catch (err) {
      console.error('Failed to copy: ', err);
    }
  }
}
