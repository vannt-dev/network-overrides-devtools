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
  };
  vm.createContext(context);
  runDistFile('utils.js', context);
  runDistFile('shared.js', context);
  runDistFile('ui.js', context);
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
    // utils.js is already loaded into this context below; real service workers
    // use importScripts to do the same thing at runtime.
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
  runDistFile('utils.js', context);
  runDistFile('shared.js', context);
  runDistFile('tab-state.js', context);
  runDistFile('background.js', context);
  return context;
}

function buildUiHtml() {
  return `<!doctype html>
  <html>
    <body>
      <input id="enable" type="checkbox">
      <span id="attach-status" style="display:none"></span>
      <button id="refresh-apis" type="button">↻</button>
      <button id="info-btn" type="button">ⓘ</button>
      <div class="tabs">
        <button class="tab-btn active" data-tab="overridden">Overridden APIs</button>
        <button class="tab-btn" data-tab="other">Other APIs</button>
        <button class="tab-btn" data-tab="overrides">Overrides</button>
      </div>
      <div id="overrides-section" style="display:none;"></div>
      <div id="apis-section" style="display:none;"></div>
      <input id="api-search" type="search">
      <button id="add-api-btn" type="button">+</button>
      <div id="apis-list"></div>
      <div id="override-modal" style="display:none;">
        <span class="close">x</span>
        <h4 class="modal-title">
          <span id="modal-title-text"></span>
          <span id="modal-url"></span>
        </h4>
        <input id="modal-pattern" type="text">
        <select id="modal-method">
          <option value="ANY">Any</option>
          <option value="GET">GET</option>
          <option value="POST">POST</option>
          <option value="PUT">PUT</option>
          <option value="PATCH">PATCH</option>
          <option value="DELETE">DELETE</option>
        </select>
        <div class="override-type-selector">
          <label class="type-radio">
            <input type="radio" name="modal-override-type" value="body" checked />
            <span>Override body</span>
          </label>
          <label class="type-radio">
            <input type="radio" name="modal-override-type" value="redirect" />
            <span>Redirect to URL</span>
          </label>
        </div>
        <div id="modal-body-fields">
          <select id="modal-mode">
            <option value="text">Text</option>
            <option value="file">Raw base64</option>
          </select>
          <textarea id="modal-body"></textarea>
          <div class="modal-body-footer">
            <span id="body-type-badge" class="body-type-badge">text</span>
            <button id="format-json-btn" type="button">Format JSON</button>
          </div>
        </div>
        <div id="modal-redirect-fields" style="display: none">
          <input id="modal-redirect-url" type="text">
        </div>
        <button id="save-override" type="button">Save</button>
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
      <button id="export-rules-btn" type="button">Export</button>
      <button id="import-rules-btn" type="button">Import</button>
      <input id="import-rules-input" type="file">
      <ul id="list"></ul>
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
  let confirmResult = true;
  const confirms = [];
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
  runDistFile('utils.js', context);
  runDistFile('shared.js', context);
  runDistFile('ui.js', context);
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
    confirms,
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

export function createBackgroundHarness({
  sessionState: initialSessionState = {},
  storageState: initialStorageState = {},
  existingTabIds = [7],
  preAttachedTabIds = [],
} = {}) {
  const listeners = {
    onMessage: null,
    onConnect: null,
    onRemoved: null,
    onEvent: null,
    onDetach: null,
    onUpdated: null,
  };
  const storageState = structuredClone(initialStorageState);
  const sessionState = structuredClone(initialSessionState);
  const existingTabs = new Set(existingTabIds);
  const storageSets = [];
  const commandLog = [];
  const attachedTabs = [];
  const detachedTabs = [];
  const responseBodies = new Map();
  const errors = [];
  let attachError = null;
  // Browser-side attachment state: chrome.debugger sessions belong to the
  // extension, not the worker instance, so they survive worker restarts.
  const attachedTargets = new Set(preAttachedTabIds);

  const chrome = {
    runtime: {
      lastError: null,
      onMessage: {
        addListener(listener) {
          listeners.onMessage = listener;
        },
      },
      onConnect: {
        addListener(listener) {
          listeners.onConnect = listener;
        },
      },
    },
    tabs: {
      onRemoved: {
        addListener(listener) {
          listeners.onRemoved = listener;
        },
      },
      onUpdated: {
        addListener(listener) {
          listeners.onUpdated = listener;
        },
      },
      async get(tabId) {
        if (!existingTabs.has(tabId)) throw new Error(`No tab with id: ${tabId}`);
        return { id: tabId };
      },
    },
    debugger: {
      onEvent: {
        addListener(listener) {
          listeners.onEvent = listener;
        },
      },
      onDetach: {
        addListener(listener) {
          listeners.onDetach = listener;
        },
      },
      attach(target, version, callback) {
        attachedTabs.push({ target, version });
        // Async like the real API so double-attach races are reproducible.
        setTimeout(() => {
          if (attachError) {
            chrome.runtime.lastError = { message: attachError };
            callback?.();
            chrome.runtime.lastError = null;
            return;
          }
          if (attachedTargets.has(target.tabId)) {
            chrome.runtime.lastError = {
              message: `Another debugger is already attached to the tab with id: ${target.tabId}.`,
            };
            callback?.();
            chrome.runtime.lastError = null;
            return;
          }
          attachedTargets.add(target.tabId);
          callback?.();
        }, 0);
      },
      detach(target, callback) {
        detachedTabs.push(target);
        attachedTargets.delete(target.tabId);
        callback?.();
      },
      sendCommand(target, method, params, callback) {
        commandLog.push({ target, method, params });
        // Real Chrome scopes runtime.lastError per callback; this mock runs
        // callbacks synchronously, so isolate it from any enclosing callback.
        const priorLastError = chrome.runtime.lastError;
        chrome.runtime.lastError = null;
        if (!attachedTargets.has(target.tabId)) {
          chrome.runtime.lastError = {
            message: `Debugger is not attached to the tab with id: ${target.tabId}.`,
          };
          callback?.();
        } else if (method === 'Fetch.getResponseBody') {
          callback?.(responseBodies.get(params.requestId) || {});
        } else {
          callback?.();
        }
        chrome.runtime.lastError = priorLastError;
      },
    },
    storage: {
      local: {
        get(keys, callback) {
          const result = Array.isArray(keys)
            ? Object.fromEntries(keys.map(key => [key, storageState[key]]))
            : typeof keys === 'string'
              ? { [keys]: storageState[keys] }
              : { ...storageState };
          if (callback) {
            callback(result);
            return;
          }
          return Promise.resolve(result);
        },
        set(value) {
          storageSets.push(structuredClone(value));
          Object.assign(storageState, structuredClone(value));
        },
        async remove(keys) {
          for (const key of Array.isArray(keys) ? keys : [keys]) {
            delete storageState[key];
          }
        },
      },
      session: {
        async get(keys) {
          if (keys === null || keys === undefined) return { ...sessionState };
          if (Array.isArray(keys)) {
            return Object.fromEntries(keys.map(key => [key, sessionState[key]]));
          }
          return { [keys]: sessionState[keys] };
        },
        async set(value) {
          Object.assign(sessionState, structuredClone(value));
        },
        async remove(keys) {
          for (const key of Array.isArray(keys) ? keys : [keys]) {
            delete sessionState[key];
          }
        },
      },
    },
  };

  const context = {
    console: {
      ...console,
      error: (...args) => {
        errors.push(args);
      },
    },
    setTimeout,
    clearTimeout,
    Buffer,
    TextEncoder,
    TextDecoder,
    URL,
    atob: value => Buffer.from(value, 'base64').toString('binary'),
    btoa: value => Buffer.from(value, 'binary').toString('base64'),
    escape,
    unescape,
    // utils.js is already loaded into this context below; real service workers
    // use importScripts to do the same thing at runtime.
    importScripts: () => {},
    chrome,
  };
  vm.createContext(context);
  runDistFile('utils.js', context);
  runDistFile('shared.js', context);
  runDistFile('tab-state.js', context);
  runDistFile('background.js', context);

  return {
    context,
    chrome,
    listeners,
    storageState,
    sessionState,
    existingTabs,
    storageSets,
    commandLog,
    attachedTabs,
    detachedTabs,
    responseBodies,
    errors,
    callMessage(message) {
      let response;
      const keepAlive = listeners.onMessage?.(message, {}, value => {
        response = value;
      });
      return { keepAlive, response };
    },
    emitDebuggerEvent(method, params, tabId = 7) {
      listeners.onEvent?.({ tabId }, method, params);
    },
    removeTab(tabId = 7) {
      listeners.onRemoved?.(tabId);
    },
    navigateTab(tabId, url) {
      listeners.onUpdated?.(tabId, { url }, { id: tabId, url });
    },
    setAttachError(message) {
      attachError = message;
    },
  };
}
