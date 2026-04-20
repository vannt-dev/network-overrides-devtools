/// <reference types="chrome" />
/// <reference path="./shared.ts" />

namespace NetworkOverridesUi {
  type OverrideMode = NetworkOverridesShared.OverrideMode;
  type OverrideRule = NetworkOverridesShared.OverrideRule;
  type ApiEntry = NetworkOverridesShared.ApiEntry;

  let currentDomain = '';

  function isRegexPattern(pattern: string): boolean {
    return pattern.startsWith('/') && pattern.lastIndexOf('/') > 0;
  }

  export function patternMatches(pattern: string, url: string): boolean {
    const trimmedPattern = pattern.trim();
    if (trimmedPattern === '*' || trimmedPattern.toLowerCase() === 'all') {
      return true;
    }
    if (isRegexPattern(trimmedPattern)) {
      const lastSlash = trimmedPattern.lastIndexOf('/');
      const source = trimmedPattern.slice(1, lastSlash);
      const flags = trimmedPattern.slice(lastSlash + 1);
      try {
        const regex = new RegExp(source, flags);
        return regex.test(url);
      } catch {
        return false;
      }
    }
    return url.includes(trimmedPattern);
  }

  function getOrigin(url: string): string {
    try {
      return new URL(url).origin;
    } catch {
      return '';
    }
  }

  interface Elements {
    enableCheckbox: HTMLInputElement;
    patternInput: HTMLInputElement;
    bodyInput: HTMLTextAreaElement;
    addBtn: HTMLButtonElement;
    listEl: HTMLUListElement;
    modeSelect: HTMLSelectElement;
    apisSection: HTMLDivElement;
    apiSearchInput: HTMLInputElement;
    onlyOverriddenCheckbox: HTMLInputElement;
    expandAllBtn: HTMLButtonElement;
    collapseAllBtn: HTMLButtonElement;
    apisList: HTMLUListElement;
    modal: HTMLDivElement;
    modalUrl: HTMLElement;
    modalStatus: HTMLElement;
    modalPattern: HTMLInputElement;
    modalMode: HTMLSelectElement;
    modalBody: HTMLTextAreaElement;
    saveOverrideBtn: HTMLButtonElement;
    closeModal: HTMLElement;
    autoFillCheckbox: HTMLInputElement;
    useCurrentBodyBtn: HTMLButtonElement;
    newRow: HTMLDivElement;
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
      onlyOverridden: false,
      collapsedBuckets: {
        overridden: false,
        other: false,
      },
      selectedApi: null as string | null,
      currentEditIndex: null as number | null,
      autoFillFromPayload: true,
    };

    elements.newRow.style.display = options.showManualEditor ? '' : 'none';

    async function persistApiUiState(): Promise<void> {
      await chrome.storage.local.set({
        apiSearchTerm: state.apiSearchTerm,
        onlyOverridden: state.onlyOverridden,
        collapsedBuckets: {
          overridden: state.collapsedBuckets.overridden,
          other: state.collapsedBuckets.other,
        },
      });
    }

    function renderList(): void {
      elements.listEl.innerHTML = '';
      state.overrides.forEach((override, index) => {
        const li = document.createElement('li');
        li.className = 'override-item';
        li.innerHTML = `
          <b>Pattern:</b> ${escapeHtml(override.pattern)}
          <button data-index="${index}" class="edit-btn">Edit</button>
          <button data-index="${index}" class="del-btn">Delete</button>
          <div class="override-meta">Mode: ${escapeHtml(override.mode)}</div>
          <pre>${escapeHtml((override.body || '').substring(0, 400))}${(override.body || '').length > 400 ? '...' : ''}</pre>
        `;
        elements.listEl.appendChild(li);
      });
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
      elements.modalStatus.textContent = 'Editing saved override';
      elements.modalStatus.classList.add('update');
      elements.modalStatus.classList.remove('new');
      elements.modalPattern.value = existing.pattern;
      elements.modalMode.value = existing.mode || 'text';
      elements.modalBody.value = formatJsonIfPossible(existing.body || '');
      elements.modal.style.display = 'block';
      renderApis();
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
        elements.modalStatus.textContent = 'Updating existing override';
        elements.modalStatus.classList.add('update');
        elements.modalStatus.classList.remove('new');
        elements.modalBody.value = formatJsonIfPossible(existing.body || '');
        elements.modalMode.value = existing.mode || 'text';
      } else {
        elements.modalStatus.textContent = 'Creating new override';
        elements.modalStatus.classList.add('new');
        elements.modalStatus.classList.remove('update');
        elements.modalBody.value = '';
        elements.modalMode.value = 'text';

        if (options.autoFillOnOpen && state.autoFillFromPayload) {
          await fillModalWithCurrentBody(url, elements.modalBody);
        }
      }

      elements.modal.style.display = 'block';
      renderApis();
      elements.modalBody.focus();
    }

    function closeOverrideModal(): void {
      elements.modal.style.display = 'none';
      state.selectedApi = null;
      state.currentEditIndex = null;
      elements.modalStatus.textContent = '';
      elements.modalUrl.title = '';
      elements.modalStatus.classList.remove('new', 'update');
      renderApis();
    }

    function renderApis(): void {
      elements.apisList.innerHTML = '';
      const searchTerm = state.apiSearchTerm.trim().toLowerCase();

      const visibleApis = state.apis.filter(
        api => !searchTerm || api.url.toLowerCase().includes(searchTerm)
      );
      const overriddenApis = visibleApis.filter(api =>
        state.overrides.some(override => patternMatches(override.pattern, api.url))
      );
      const otherApis = state.onlyOverridden
        ? []
        : visibleApis.filter(
            api => !state.overrides.some(override => patternMatches(override.pattern, api.url))
          );

      elements.expandAllBtn.style.display = visibleApis.length > 0 ? 'inline-flex' : 'none';
      elements.collapseAllBtn.style.display = visibleApis.length > 0 ? 'inline-flex' : 'none';

      appendApiBucket('Overridden APIs', overriddenApis, 'overridden', searchTerm);
      appendApiBucket('Other APIs', otherApis, 'other', searchTerm);

      if (elements.apisList.childElementCount === 0) {
        const emptyState = document.createElement('div');
        emptyState.className = 'api-empty-state';
        emptyState.textContent = searchTerm
          ? `No APIs match "${state.apiSearchTerm}".`
          : 'No captured APIs yet.';
        elements.apisList.appendChild(emptyState);
      }

      const hasVisibleApis = elements.apisList.childElementCount > 0;
      elements.apisSection.style.display = hasVisibleApis ? 'block' : 'none';
    }

    function appendApiBucket(
      title: string,
      apis: ApiEntry[],
      key: 'overridden' | 'other',
      searchTerm: string
    ): void {
      if (apis.length === 0) {
        return;
      }

      const grouped: Record<string, ApiEntry[]> = {};
      const typeOrder = [
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
      const typeLabels: Record<string, string> = {
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

      apis.forEach(api => {
        const type = normalizeApiType(api.type);
        if (!grouped[type]) {
          grouped[type] = [];
        }
        grouped[type].push(api);
      });

      const bucket = document.createElement('div');
      bucket.className = 'api-bucket';
      const header = document.createElement('button');
      header.type = 'button';
      header.className = 'api-bucket-toggle';
      header.setAttribute('aria-expanded', String(!state.collapsedBuckets[key]));
      header.innerHTML = `
        <span class="api-bucket-title">${title}</span>
        <span class="api-bucket-meta">
          <span class="api-count">${apis.length}</span>
          <span class="api-bucket-chevron ${state.collapsedBuckets[key] ? 'collapsed' : ''}" aria-hidden="true"></span>
        </span>
      `;
      header.addEventListener('click', () => {
        state.collapsedBuckets[key] = !state.collapsedBuckets[key];
        void persistApiUiState();
        renderApis();
      });
      bucket.appendChild(header);

      if (state.collapsedBuckets[key]) {
        elements.apisList.appendChild(bucket);
        return;
      }

      typeOrder.forEach(type => {
        if (!grouped[type]?.length) {
          return;
        }

        grouped[type].sort((left, right) => left.url.localeCompare(right.url));

        const section = document.createElement('div');
        section.className = 'api-section';
        section.innerHTML = `<h4>${typeLabels[type] || type.toUpperCase()} <span class="api-count">${grouped[type].length}</span></h4>`;

        const ul = document.createElement('ul');
        grouped[type].forEach(api => {
          const li = document.createElement('li');
          li.className = 'api-item';
          const isOverridden = state.overrides.some(override =>
            patternMatches(override.pattern, api.url)
          );
          const isSelected = state.selectedApi ? patternMatches(state.selectedApi, api.url) : false;
          if (isOverridden) {
            li.classList.add('active');
          }
          if (isSelected) {
            li.classList.add('selected');
          }
          li.dataset.url = api.url;
          li.innerHTML = `
            <div class="api-item-content">
              <b title="${escapeHtml(api.url)}">${highlightApiLabel(api.url, searchTerm)}</b>
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
        bucket.appendChild(section);
      });

      elements.apisList.appendChild(bucket);
    }

    async function loadApis(): Promise<number> {
      const tab = await getActiveTab();
      const tabId = tab?.id;
      if (typeof tabId !== 'number') {
        return 0;
      }

      if (tab?.url) {
        currentDomain = getOrigin(tab.url);
      }

      return new Promise(resolve => {
        chrome.runtime.sendMessage({ type: 'getApis', tabId }, (response: any) => {
          const apisResponse = response?.apis;
          if (Array.isArray(apisResponse)) {
            state.apis = apisResponse;
            renderApis();
            resolve(apisResponse.length);
            return;
          }

          resolve(0);
        });
      });
    }

    async function refreshApisWithRetry(): Promise<void> {
      const attempts = 5;
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        const count = await loadApis();
        if (count > 0) {
          return;
        }

        if (attempt < attempts - 1) {
          await delay(250);
        }
      }
    }

    async function notifyBackground(): Promise<void> {
      const tab = await getActiveTab();
      if (typeof tab?.id !== 'number') {
        return;
      }

      const data = await chrome.storage.local.get(['enabled', 'overrides']);
      chrome.runtime.sendMessage({
        type: 'update',
        tabId: tab.id,
        tabUrl: tab.url,
        enabled: !!data.enabled,
        overrides: data.overrides || [],
      });
    }

    elements.addBtn.addEventListener('click', async () => {
      const pattern = elements.patternInput.value.trim();
      if (!pattern) {
        alert('Pattern is required');
        return;
      }

      const mode = elements.modeSelect.value as OverrideMode;
      const body = elements.bodyInput.value || '';

      state.overrides.push({ pattern, body, mode });
      await chrome.storage.local.set({ overrides: state.overrides });

      elements.patternInput.value = '';
      elements.bodyInput.value = '';

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
      await chrome.storage.local.set({ overrides: state.overrides });
      renderList();
      renderApis();
      await notifyBackground();
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
      const mode = elements.modalMode.value as OverrideMode;
      const body = elements.modalBody.value || '';

      if (state.currentEditIndex !== null && state.overrides[state.currentEditIndex]) {
        state.overrides[state.currentEditIndex] = { pattern, body, mode };
      } else {
        state.overrides.unshift({ pattern, body, mode });
      }

      await chrome.storage.local.set({ overrides: state.overrides });
      renderList();
      renderApis();
      await notifyBackground();
      closeOverrideModal();
    });

    elements.enableCheckbox.addEventListener('change', async () => {
      await chrome.storage.local.set({ enabled: elements.enableCheckbox.checked });
      await notifyBackground();
    });

    elements.autoFillCheckbox.addEventListener('change', async () => {
      state.autoFillFromPayload = elements.autoFillCheckbox.checked;
      await chrome.storage.local.set({ autoFillFromPayload: state.autoFillFromPayload });
    });

    elements.useCurrentBodyBtn.addEventListener('click', async () => {
      if (!state.selectedApi) {
        return;
      }

      await fillModalWithCurrentBody(state.selectedApi, elements.modalBody);
    });

    elements.apiSearchInput.addEventListener('input', () => {
      state.apiSearchTerm = elements.apiSearchInput.value;
      void persistApiUiState();
      renderApis();
    });

    elements.onlyOverriddenCheckbox.addEventListener('change', () => {
      state.onlyOverridden = elements.onlyOverriddenCheckbox.checked;
      void persistApiUiState();
      renderApis();
    });

    elements.expandAllBtn.addEventListener('click', () => {
      state.collapsedBuckets.overridden = false;
      state.collapsedBuckets.other = false;
      void persistApiUiState();
      renderApis();
    });

    elements.collapseAllBtn.addEventListener('click', () => {
      state.collapsedBuckets.overridden = true;
      state.collapsedBuckets.other = true;
      void persistApiUiState();
      renderApis();
    });

    void (async () => {
      const data = await chrome.storage.local.get([
        'enabled',
        'overrides',
        'autoFillFromPayload',
        'apiSearchTerm',
        'onlyOverridden',
        'collapsedBuckets',
      ]);
      elements.enableCheckbox.checked = !!data.enabled;
      state.autoFillFromPayload = data.autoFillFromPayload !== false;
      elements.autoFillCheckbox.checked = state.autoFillFromPayload;
      state.overrides = data.overrides || [];
      state.apiSearchTerm = typeof data.apiSearchTerm === 'string' ? data.apiSearchTerm : '';
      elements.apiSearchInput.value = state.apiSearchTerm;
      state.onlyOverridden = data.onlyOverridden === true;
      elements.onlyOverriddenCheckbox.checked = state.onlyOverridden;

      const collapsedBuckets = data.collapsedBuckets || {};
      state.collapsedBuckets.overridden = collapsedBuckets.overridden === true;
      state.collapsedBuckets.other = collapsedBuckets.other === true;

      renderList();
      await notifyBackground();
      await refreshApisWithRetry();
    })();

    return {
      addApis(newApis: ApiEntry[]): void {
        let changed = false;
        newApis.forEach(entry => {
          const { url } = entry;
          if (!state.apis.some(api => api.url === url)) {
            state.apis.push(entry);
            changed = true;
          }
        });
        if (changed) {
          renderApis();
        }
      },
    };
  }

  async function fillModalWithCurrentBody(url: string, target: HTMLTextAreaElement): Promise<void> {
    const tab = await getActiveTab();
    const tabId = tab?.id;
    if (typeof tabId !== 'number') {
      return;
    }

    chrome.runtime.sendMessage({ type: 'getApiData', tabId, url }, (response: any) => {
      if (response?.body) {
        target.value = formatJsonIfPossible(response.body);
      }
    });
  }

  async function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
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
      patternInput: document.getElementById('pattern') as HTMLInputElement,
      bodyInput: document.getElementById('body') as HTMLTextAreaElement,
      addBtn: document.getElementById('add') as HTMLButtonElement,
      listEl: document.getElementById('list') as HTMLUListElement,
      modeSelect: document.getElementById('mode') as HTMLSelectElement,
      apisSection: document.getElementById('apis-section') as HTMLDivElement,
      apiSearchInput: document.getElementById('api-search') as HTMLInputElement,
      onlyOverriddenCheckbox: document.getElementById('only-overridden') as HTMLInputElement,
      expandAllBtn: document.getElementById('expand-all') as HTMLButtonElement,
      collapseAllBtn: document.getElementById('collapse-all') as HTMLButtonElement,
      apisList: document.getElementById('apis-list') as HTMLUListElement,
      modal: document.getElementById('override-modal') as HTMLDivElement,
      modalUrl: document.getElementById('modal-url') as HTMLElement,
      modalStatus: document.getElementById('modal-status') as HTMLElement,
      modalPattern: document.getElementById('modal-pattern') as HTMLInputElement,
      modalMode: document.getElementById('modal-mode') as HTMLSelectElement,
      modalBody: document.getElementById('modal-body') as HTMLTextAreaElement,
      saveOverrideBtn: document.getElementById('save-override') as HTMLButtonElement,
      closeModal: document.querySelector('.close') as HTMLElement,
      autoFillCheckbox: document.getElementById('auto-fill') as HTMLInputElement,
      useCurrentBodyBtn: document.getElementById('use-current-body') as HTMLButtonElement,
      newRow: document.getElementById('new-row') as HTMLDivElement,
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
