import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';

const repoRoot = process.cwd();

// createUiHarness() boots real jsdom windows to run src/ui.ts's init code,
// which schedules a real window.setInterval (see ui.ts's periodic
// startApiStream retry). jsdom backs window timers with real Node timers,
// so a window that's never closed leaves a live interval running. With many
// harnesses created across the suite and --test-isolation=none, those
// accumulate and keep the process alive after tests finish. Track every
// window here so closeAllUiHarnessWindows() can close them all in one place.
const activeUiWindows = [];

export function closeAllUiHarnessWindows() {
  while (activeUiWindows.length) {
    activeUiWindows.pop().close();
  }
}

export function readDistFile(name) {
  return fs.readFileSync(path.join(repoRoot, 'dist', name), 'utf8');
}

export function runDistFile(name, context) {
  vm.runInContext(readDistFile(name), context, {
    filename: path.join(repoRoot, 'dist', name),
  });
}

export function normalize(value) {
  return JSON.parse(JSON.stringify(value));
}

export function createUiContext() {
  const context = {
    console,
    URL,
  };
  vm.createContext(context);
  runDistFile('ui.bundle.js', context);
  return context;
}

export function createBackgroundContext() {
  const noop = () => {};
  const context = {
    console,
    URL,
    atob: value => Buffer.from(value, 'base64').toString('binary'),
    btoa: value => Buffer.from(value, 'binary').toString('base64'),
    escape,
    unescape,
    importScripts: noop,
    chrome: {
      runtime: {
        lastError: null,
        onMessage: { addListener: noop },
        onConnect: { addListener: noop },
      },
      tabs: {
        get: async () => ({ id: 0 }),
        onRemoved: { addListener: noop },
        onUpdated: { addListener: noop },
      },
      debugger: {
        onEvent: { addListener: noop },
        onDetach: { addListener: noop },
        attach: noop,
        detach: noop,
        sendCommand: noop,
      },
      storage: {
        local: {
          get: (keys, cb) => (cb ? cb({}) : Promise.resolve({})),
          set: noop,
          remove: async () => {},
        },
        session: {
          async get(keys) {
            if (keys === null || keys === undefined) return {};
            if (Array.isArray(keys)) return {};
            return { [keys]: undefined };
          },
          async set() {},
          async remove() {},
        },
      },
    },
  };
  vm.createContext(context);
  runDistFile('background.bundle.js', context);
  return context;
}

function buildUiHtml() {
  return `<!doctype html>
  <html>
    <body>
      <input id="enable" type="checkbox">
      <span id="attach-status" style="display:none"></span>
      <div class="header-actions">
        <button
          id="refresh-apis"
          type="button"
          title="Refresh captured requests"
          aria-label="Refresh captured requests"
        ><svg aria-hidden="true"></svg></button>
        <button
          id="info-btn"
          type="button"
          title="Open user guide"
          aria-label="Open user guide"
        ><svg aria-hidden="true"></svg></button>
      </div>
      <div class="tabs">
        <button class="tab-btn active" data-tab="overridden">Overridden APIs</button>
        <button class="tab-btn" data-tab="other">Other APIs</button>
        <button class="tab-btn" data-tab="overrides">Overrides</button>
      </div>
      <div id="apis-section" style="display:none;"></div>
      <input id="api-search" type="search">
      <button id="add-api-btn" type="button">+</button>
      <div id="apis-list"></div>
      <div id="override-modal" style="display:none;">
        <div class="modal-content modal-content--override">
          <header class="modal-header">
            <h4 class="modal-title">
              <span id="modal-title-text"></span>
              <span id="modal-url"></span>
            </h4>
            <button class="close modal-close" type="button">x</button>
          </header>
          <div class="modal-scroll-body">
        <input id="modal-pattern" type="text">
        <select id="modal-method">
          <option value="ANY">Any</option>
          <option value="GET">GET</option>
          <option value="POST">POST</option>
          <option value="PUT">PUT</option>
          <option value="PATCH">PATCH</option>
          <option value="DELETE">DELETE</option>
        </select>
        <input id="modal-graphql-op" type="text">
        <input id="modal-global-rule" type="checkbox">
        <div class="override-type-selector">
          <label class="type-radio">
            <input type="radio" name="modal-override-type" value="body" checked />
            <span>Override body</span>
          </label>
          <label class="type-radio">
            <input type="radio" name="modal-override-type" value="redirect" />
            <span>Redirect to URL</span>
          </label>
          <label class="type-radio">
            <input type="radio" name="modal-override-type" value="fail" />
            <span>Fail request</span>
          </label>
        </div>
        <div id="modal-body-fields">
          <select id="modal-mode">
            <option value="text">Text</option>
            <option value="file">Raw base64</option>
          </select>
          <textarea id="modal-body"></textarea>
          <input id="modal-process-templates" type="checkbox" checked>
          <div class="modal-body-footer">
            <button id="format-json-btn" type="button" style="display:none">Format JSON</button>
          </div>
          <div id="modal-preview-container" style="display:none"></div>
        </div>
        <div id="modal-redirect-fields" style="display: none">
          <input id="modal-redirect-url" type="text">
        </div>
        <div id="modal-fail-fields" style="display:none">
          <select id="modal-fail-reason">
            <option value="Failed">Failed</option>
            <option value="TimedOut">TimedOut</option>
            <option value="ConnectionRefused">ConnectionRefused</option>
            <option value="NameNotResolved">NameNotResolved</option>
            <option value="InternetDisconnected">InternetDisconnected</option>
          </select>
        </div>
        <div id="modal-advanced-fields">
          <label id="modal-request-body-field"><textarea id="modal-request-body"></textarea></label>
          <label id="modal-request-headers-field" class="modal-field">
            <textarea id="modal-request-headers"></textarea>
            <div id="modal-request-headers-table"></div>
          </label>
          <label id="modal-status-field"><input id="modal-status" type="number" /></label>
          <label><input id="modal-delay" type="number" /></label>
          <label id="modal-headers-field" class="modal-field">
            <textarea id="modal-headers"></textarea>
            <div id="modal-response-headers-table"></div>
          </label>
        </div>
          </div>
          <footer class="modal-footer">
            <div id="modal-feedback" role="status" aria-live="polite"></div>
            <button id="save-override" type="button">Save</button>
          </footer>
        </div>
      </div>
      <div id="curl-swagger-modal" style="display:none">
        <span id="curl-swagger-close">x</span>
        <textarea id="curl-swagger-textarea"></textarea>
        <input id="curl-swagger-file-input" type="file" />
        <button id="curl-swagger-import-btn" type="button">Import</button>
      </div>
      <div id="new-row" style="display:none;"></div>
      <input id="pattern" type="text">
      <input id="redirect-url" type="text">
      <textarea id="body"></textarea>
      <button id="add" type="button">Add</button>
      <select id="mode">
        <option value="text">Text</option>
        <option value="file">Raw base64</option>
      </select>
      <div id="overrides-section" style="display:none;">
        <button id="export-rules-btn" type="button">Export</button>
        <button id="import-rules-btn" type="button">Import</button>
        <button id="import-curl-swagger-btn" type="button">cURL / Swagger</button>
        <input id="import-rules-input" type="file">
        <select id="profiles-select"></select>
        <button id="save-profile-btn" type="button">Save Profile</button>
        <button id="delete-profile-btn" type="button">Delete Profile</button>
        <ul id="list"></ul>
      </div>
    </body>
  </html>`;
}

export function createUiHarness({
  storageState = {},
  apis = [],
  apiResponses = null,
  apiBodies = {},
  tabId = 99,
  tabUrl = 'https://example.test/',
  options = { autoFillOnOpen: true, showManualEditor: false },
  statusResponse = { type: 'statusResponse', attached: false },
  storageSetError = null,
  backgroundUpdateResponse = { success: true },
  promptResult = null,
} = {}) {
  const dom = new JSDOM(buildUiHtml(), {
    url: tabUrl,
    runScripts: 'outside-only',
  });
  const { window } = dom;
  activeUiWindows.push(window);
  const localState = structuredClone(storageState);

  let tabDomain = '';
  try {
    tabDomain = new URL(tabUrl).origin;
  } catch {}

  const domainOverridesKey = `overrides_${tabDomain}`;
  const domainEnabledKey = `enabled_${tabDomain}`;
  if (tabDomain) {
    if ('overrides' in localState && !(domainOverridesKey in localState)) {
      localState[domainOverridesKey] = structuredClone(localState.overrides);
    }
    if ('enabled' in localState && !(domainEnabledKey in localState)) {
      localState[domainEnabledKey] = localState.enabled;
    }
  }

  const sentMessages = [];
  const storageSets = [];
  const alerts = [];
  const downloads = [];
  const openedTabs = [];
  let confirmResult = true;
  const confirms = [];
  const prompts = [];
  let getApisCallCount = 0;
  const uiPorts = [];

  const chrome = {
    storage: {
      local: {
        async get(keys) {
          if (Array.isArray(keys)) {
            const result = Object.fromEntries(keys.map(key => [key, localState[key]]));
            if (tabDomain) {
              keys.forEach(key => {
                if ((key === domainOverridesKey || key === domainEnabledKey) && !(key in result)) {
                  const flatKey = key === domainOverridesKey ? 'overrides' : 'enabled';
                  result[key] = localState[flatKey];
                }
              });
            }
            return result;
          }
          if (typeof keys === 'string') {
            if (
              tabDomain &&
              (keys === domainOverridesKey || keys === domainEnabledKey) &&
              !(keys in localState)
            ) {
              const flatKey = keys === domainOverridesKey ? 'overrides' : 'enabled';
              return { [keys]: localState[flatKey] };
            }
            return { [keys]: localState[keys] };
          }
          return { ...localState };
        },
        async set(value) {
          if (storageSetError) {
            throw storageSetError instanceof Error
              ? storageSetError
              : new Error(String(storageSetError));
          }
          storageSets.push(structuredClone(value));
          Object.assign(localState, structuredClone(value));
          if (tabDomain) {
            if (domainOverridesKey in value) {
              localState.overrides = structuredClone(value[domainOverridesKey]);
            }
            if (domainEnabledKey in value) {
              localState.enabled = value[domainEnabledKey];
            }
          }
        },
      },
    },
    tabs: {
      query(queryInfo, callback) {
        callback([{ id: tabId, url: tabUrl }]);
      },
      create(options) {
        openedTabs.push(structuredClone(options));
      },
    },
    runtime: {
      connect() {
        const listeners = new Set();
        const disconnectListeners = new Set();
        uiPorts.push({ listeners });
        return {
          name: 'network-overrides-ui',
          onMessage: {
            addListener(fn) {
              listeners.add(fn);
            },
            removeListener(fn) {
              listeners.delete(fn);
            },
          },
          onDisconnect: {
            addListener(fn) {
              disconnectListeners.add(fn);
            },
            removeListener(fn) {
              disconnectListeners.delete(fn);
            },
          },
          postMessage() {},
          disconnect() {
            listeners.clear();
            disconnectListeners.clear();
          },
        };
      },
      sendMessage(message, callback) {
        sentMessages.push(structuredClone(message));
        if (message.type === 'getApis') {
          const responseApis = Array.isArray(apiResponses)
            ? apiResponses[Math.min(getApisCallCount, apiResponses.length - 1)] || []
            : apis;
          getApisCallCount += 1;
          callback?.({ apis: responseApis });
          return;
        }
        if (message.type === 'getApiData') {
          callback?.({ body: apiBodies[message.url] || '' });
          return;
        }
        if (message.type === 'getStatus') {
          callback?.(structuredClone(statusResponse));
          return;
        }
        if (message.type === 'update') {
          callback?.(structuredClone(backgroundUpdateResponse));
          return;
        }
        callback?.({ success: true });
      },
    },
  };

  Object.assign(window, {
    chrome,
    alert: message => alerts.push(String(message)),
    confirm: message => {
      confirms.push(String(message));
      return confirmResult;
    },
    prompt: message => {
      prompts.push(String(message));
      return promptResult;
    },
  });
  window.URL.createObjectURL = blob => {
    const entry = { content: '', filename: '' };
    downloads.push(entry);
    blob
      .text()
      .then(text => {
        entry.content = text;
      })
      .catch(() => {});
    return 'blob:mock-url';
  };
  window.URL.revokeObjectURL = () => {};
  const originalClick = window.HTMLAnchorElement.prototype.click;
  window.HTMLAnchorElement.prototype.click = function click() {
    const pending = downloads.at(-1);
    if (pending) {
      pending.filename = this.download;
    }
    return originalClick.call(this);
  };

  const context = dom.getInternalVMContext();
  runDistFile('ui.bundle.js', context);
  window.NetworkOverridesUi.init(options);

  return {
    dom,
    window,
    document: window.document,
    chrome,
    sentMessages,
    storageSets,
    alerts,
    downloads,
    openedTabs,
    confirms,
    prompts,
    setConfirmResult: value => {
      confirmResult = value;
    },
    localState,
    getApisCallCount: () => getApisCallCount,
    emitPortMessage(msg) {
      uiPorts.forEach(({ listeners }) => listeners.forEach(fn => fn(structuredClone(msg))));
    },
  };
}

export async function flushUi(window, ticks = 3) {
  for (let index = 0; index < ticks; index += 1) {
    await new Promise(resolve => window.setTimeout(resolve, 0));
  }
}
