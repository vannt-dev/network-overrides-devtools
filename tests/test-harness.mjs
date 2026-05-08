import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';

const repoRoot = process.cwd();

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
  runDistFile('shared.js', context);
  runDistFile('ui.js', context);
  return context;
}

export function createBackgroundContext() {
  const noop = () => {};
  const context = {
    console,
    atob: value => Buffer.from(value, 'base64').toString('binary'),
    btoa: value => Buffer.from(value, 'binary').toString('base64'),
    escape,
    unescape,
    chrome: {
      runtime: {
        lastError: null,
        onMessage: { addListener: noop },
      },
      tabs: {
        onRemoved: { addListener: noop },
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
          get: noop,
          set: noop,
        },
      },
    },
  };
  vm.createContext(context);
  runDistFile('shared.js', context);
  runDistFile('background.js', context);
  return context;
}

function buildUiHtml() {
  return `<!doctype html>
  <html>
    <body>
      <input id="enable" type="checkbox">
      <button id="refresh-apis" type="button">↻</button>
      <div class="tabs">
        <button class="tab-btn active" data-tab="overridden">Overridden APIs</button>
        <button class="tab-btn" data-tab="other">Other APIs</button>
        <button class="tab-btn" data-tab="overrides">Overrides</button>
      </div>
      <div id="overrides-section" style="display:none;"></div>
      <div id="apis-section" style="display:none;"></div>
      <input id="api-search" type="search">
      <div id="apis-list"></div>
      <div id="override-modal" style="display:none;">
        <span class="close">x</span>
        <span id="modal-url"></span>
        <div id="modal-status"></div>
        <input id="modal-pattern" type="text">
        <input id="modal-redirect-url" type="text">
        <select id="modal-mode">
          <option value="text">Text</option>
          <option value="file">Raw base64</option>
        </select>
        <textarea id="modal-body"></textarea>
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
} = {}) {
  const dom = new JSDOM(buildUiHtml(), {
    url: 'https://example.test/',
    runScripts: 'outside-only',
  });
  const { window } = dom;
  const localState = structuredClone(storageState);
  const sentMessages = [];
  const storageSets = [];
  const alerts = [];
  let getApisCallCount = 0;

  const chrome = {
    storage: {
      local: {
        async get(keys) {
          if (Array.isArray(keys)) {
            return Object.fromEntries(keys.map(key => [key, localState[key]]));
          }
          if (typeof keys === 'string') {
            return { [keys]: localState[keys] };
          }
          return { ...localState };
        },
        async set(value) {
          storageSets.push(structuredClone(value));
          Object.assign(localState, structuredClone(value));
        },
      },
    },
    tabs: {
      query(queryInfo, callback) {
        callback([{ id: tabId, url: tabUrl }]);
      },
    },
    runtime: {
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
        callback?.({ success: true });
      },
    },
  };

  Object.assign(window, {
    chrome,
    alert: message => alerts.push(String(message)),
  });

  const context = dom.getInternalVMContext();
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
    localState,
    getApisCallCount: () => getApisCallCount,
  };
}

export async function flushUi(window, ticks = 3) {
  for (let index = 0; index < ticks; index += 1) {
    await new Promise(resolve => window.setTimeout(resolve, 0));
  }
}

export function createBackgroundHarness() {
  const listeners = {
    onMessage: null,
    onRemoved: null,
    onEvent: null,
    onDetach: null,
  };
  const storageState = {};
  const storageSets = [];
  const commandLog = [];
  const attachedTabs = [];
  const detachedTabs = [];
  const responseBodies = new Map();
  const errors = [];

  const chrome = {
    runtime: {
      lastError: null,
      onMessage: {
        addListener(listener) {
          listeners.onMessage = listener;
        },
      },
    },
    tabs: {
      onRemoved: {
        addListener(listener) {
          listeners.onRemoved = listener;
        },
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
        callback?.();
      },
      detach(target, callback) {
        detachedTabs.push(target);
        callback?.();
      },
      sendCommand(target, method, params, callback) {
        commandLog.push({ target, method, params });
        if (method === 'Fetch.getResponseBody') {
          callback?.(responseBodies.get(params.requestId) || {});
          return;
        }
        callback?.();
      },
    },
    storage: {
      local: {
        get(keys, callback) {
          if (Array.isArray(keys)) {
            callback(Object.fromEntries(keys.map(key => [key, storageState[key]])));
            return;
          }
          if (typeof keys === 'string') {
            callback({ [keys]: storageState[keys] });
            return;
          }
          callback({ ...storageState });
        },
        set(value) {
          storageSets.push(structuredClone(value));
          Object.assign(storageState, structuredClone(value));
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
    Buffer,
    TextEncoder,
    TextDecoder,
    atob: value => Buffer.from(value, 'base64').toString('binary'),
    btoa: value => Buffer.from(value, 'binary').toString('base64'),
    escape,
    unescape,
    chrome,
  };
  vm.createContext(context);
  runDistFile('shared.js', context);
  runDistFile('background.js', context);

  return {
    chrome,
    listeners,
    storageState,
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
  };
}
