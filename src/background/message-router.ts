/// <reference types="chrome" />
/// <reference path="../shared.ts" />
/// <reference path="../utils.ts" />
/// <reference path="../tab-state.ts" />
namespace NetworkOverridesBackground {
  import TabState = NetworkOverridesTabState;

  type OverrideRule = NetworkOverridesShared.OverrideRule;

  type Msg =
    | {
        type: 'update';
        tabId: number;
        enabled: boolean;
        overrides?: OverrideRule[];
        tabUrl?: string;
      }
    | { type: 'getApis'; tabId: number }
    | { type: 'getApiData'; tabId: number; url?: string }
    | { type: 'clearApis'; tabId: number }
    | { type: 'getStatus'; tabId: number }
    | { type: 'updateCapturedBodyTypes'; types: string[] };

  chrome.runtime.onMessage.addListener((msg: Msg, sender, sendResponse) => {
    if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') {
      return;
    }
    switch (msg.type) {
      case 'update': {
        const tabId = Number(msg.tabId);
        if (Number.isNaN(tabId)) return;

        const enabled = Boolean(msg.enabled);
        const overrides = Array.isArray(msg.overrides) ? msg.overrides : [];
        const tabUrl = typeof msg.tabUrl === 'string' ? msg.tabUrl : '';

        const state = TabState.ensure(tabId);
        state.enabled = enabled;
        state.overrides = overrides;
        if (tabUrl) state.origin = NetworkOverridesUtils.getOrigin(tabUrl);
        TabState.schedulePersist(tabId);
        const update = enabled ? attachDebugger(tabId) : detachDebugger(tabId);
        void update
          .then(() => {
            sendResponse({
              type: 'updateResponse',
              success: true,
              attached: !!TabState.get(tabId)?.attached,
            });
          })
          .catch(error => {
            console.error(error);
            sendResponse({
              type: 'updateResponse',
              success: false,
              attached: false,
              error: error instanceof Error ? error.message : String(error),
            });
          });
        return true;
      }
      case 'getApis': {
        const tabId = Number(msg.tabId);
        if (Number.isNaN(tabId)) return;
        const state = TabState.get(tabId);
        if (state && typeof sendResponse === 'function') {
          sendResponse({ type: 'apisResponse', apis: Array.from(state.recentApis.values()) });
          return true;
        }

        void Promise.resolve(chrome.storage.session.get(TabState.stateKey(tabId))).then(
          (data: any) => {
            const snapshot = data?.[TabState.stateKey(tabId)];
            const apis = snapshot?.recentApis ? Object.values(snapshot.recentApis) : [];
            if (typeof sendResponse === 'function') {
              sendResponse({ type: 'apisResponse', apis });
            }
          }
        );
        return true;
      }
      case 'clearApis': {
        const clearTabId = Number(msg.tabId);
        if (!Number.isNaN(clearTabId)) {
          const state = TabState.get(clearTabId);
          if (state) {
            state.recentApis.clear();
            state.recentApiBodies.clear();
            TabState.schedulePersist(clearTabId);
          }
        }
        if (typeof sendResponse === 'function') {
          sendResponse({ type: 'clearApisResponse', success: true });
        }
        return;
      }
      case 'getStatus': {
        const tabId = Number(msg.tabId);
        if (Number.isNaN(tabId)) return;
        const respond = () => {
          const state = TabState.get(tabId);
          if (typeof sendResponse === 'function') {
            const payload: { type: string; attached: boolean; error?: string } = {
              type: 'statusResponse',
              attached: !!state?.attached,
            };
            if (state?.attachError) payload.error = state.attachError;
            sendResponse(payload);
          }
        };
        // Answering mid-attach would report a stale { attached: false } with no
        // error; wait for the in-flight attempt so the UI sees the real outcome.
        const pending = TabState.runtime(tabId).attachPromise;
        if (pending) {
          void pending.catch(() => {}).then(respond);
        } else {
          respond();
        }
        return true;
      }
      case 'getApiData': {
        const tabId = Number(msg.tabId);
        const url = String(msg.url || '');
        if (Number.isNaN(tabId) || !url) return;

        const state = TabState.get(tabId);
        if (state?.recentApiBodies.has(url)) {
          if (typeof sendResponse === 'function') {
            sendResponse({
              type: 'apiDataResponse',
              url,
              body: state.recentApiBodies.get(url) || '',
            });
          }
          return true;
        }

        void Promise.resolve(chrome.storage.session.get(TabState.stateKey(tabId))).then(
          (data: any) => {
            const snapshot = data?.[TabState.stateKey(tabId)];
            const body = snapshot?.recentApiBodies?.[url] ?? '';
            if (typeof sendResponse === 'function') {
              sendResponse({ type: 'apiDataResponse', url, body });
            }
          }
        );
        return true;
      }
      case 'updateCapturedBodyTypes': {
        if (Array.isArray((msg as any).types)) {
          setCapturedBodyTypes((msg as any).types);
        }
        if (typeof sendResponse === 'function') {
          sendResponse({ success: true });
        }
        return;
      }
      default:
        if (typeof sendResponse === 'function') {
          sendResponse({ success: true });
        }
        break;
    }
  });
}
