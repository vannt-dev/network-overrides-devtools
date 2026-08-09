import vm from 'node:vm';
import { runDistFile } from './test-harness.mjs';

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
    // Strict like the browser: Buffer.from silently ignores invalid characters,
    // which would make the invalid-base64 fallback branch unreachable in tests.
    atob: value => {
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
        throw new Error('Invalid character in base64 string');
      }
      return Buffer.from(value, 'base64').toString('binary');
    },
    btoa: value => Buffer.from(value, 'binary').toString('base64'),
    escape,
    unescape,
    // utils.js is already loaded into this context below; real service workers
    // use importScripts to do the same thing at runtime.
    importScripts: () => {},
    chrome,
  };
  vm.createContext(context);
  runDistFile('background.bundle.js', context);

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
      const result = { keepAlive: undefined, response: undefined };
      result.keepAlive = listeners.onMessage?.(message, {}, value => {
        result.response = value;
      });
      return result;
    },
    emitDebuggerEvent(method, params, tabId = 7) {
      listeners.onEvent?.({ tabId }, method, params);
    },
    removeTab(tabId = 7) {
      listeners.onRemoved?.(tabId);
    },
    emitDetach(tabId = 7, reason = 'canceled_by_user') {
      // An external detach (infobar Cancel, DevTools takeover) has already
      // released the browser-side session before the event reaches us.
      attachedTargets.delete(tabId);
      listeners.onDetach?.({ tabId }, reason);
    },
    navigateTab(tabId, url) {
      listeners.onUpdated?.(tabId, { url }, { id: tabId, url });
    },
    setAttachError(message) {
      attachError = message;
    },
  };
}
