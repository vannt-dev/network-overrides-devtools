/*! SPDX-License-Identifier: MIT | Copyright (c) 2025 Van Nguyen | github.com/vannt-dev/network-overrides-devtools */
/// <reference types="chrome" />
/// <reference path="../shared.ts" />
/// <reference path="../utils.ts" />
/// <reference path="../tab-state.ts" />
/// <reference path="./collection-store.ts" />
namespace NetworkOverridesBackground {
  import TabState = NetworkOverridesTabState;

  type OverrideRule = NetworkOverridesShared.OverrideRule;
  type ApiEntry = NetworkOverridesShared.ApiEntry;
  type ThrottlePreset = NetworkOverridesShared.ThrottlePreset;
  const THROTTLE_PRESETS: ThrottlePreset[] = ['none', 'fast3g', 'slow3g', 'offline'];

  type Msg =
    | {
        type: 'update';
        tabId: number;
        enabled: boolean;
        overrides?: OverrideRule[];
        variables?: Record<string, string>;
        tabUrl?: string;
      }
    | { type: 'getApis'; tabId: number; includeBodies?: boolean }
    | { type: 'getApiData'; tabId: number; url?: string }
    | { type: 'clearApis'; tabId: number }
    | { type: 'resetRuleHits'; tabId: number }
    | { type: 'getStatus'; tabId: number }
    | { type: 'setThrottle'; tabId: number; preset: ThrottlePreset }
    | { type: 'updateCapturedBodyTypes'; types: string[] }
    | { type: 'getCollection'; tabId: number; pattern: string }
    | { type: 'resetCollection'; tabId: number; pattern: string }
    | { type: 'setCollection'; tabId: number; pattern: string; items: unknown };

  /**
   * Reads, resets or replaces the list of a tab's collection rule, for the
   * rule editor. The rule must have been sent to the tab already (saved).
   */
  function handleCollectionMessage(msg: Msg, sendResponse: (response: unknown) => void): void {
    const type = `${msg.type}Response`;
    const tabId = Number((msg as { tabId?: unknown }).tabId);
    const pattern = String((msg as { pattern?: unknown }).pattern ?? '');
    const rule = Number.isNaN(tabId) ? null : collectionRuleOf(tabId, pattern);
    if (!rule) {
      sendResponse({ type, success: false, error: 'not-saved' });
      return;
    }
    let result: ReturnType<typeof collectionStore>;
    if (msg.type === 'setCollection') {
      const items = msg.items;
      if (
        !Array.isArray(items) ||
        items.some(item => !item || typeof item !== 'object' || Array.isArray(item))
      ) {
        sendResponse({ type, success: false, error: 'not a JSON array of objects' });
        return;
      }
      result = setCollectionItems(tabId, rule, items as NetworkOverridesCollection.Item[]);
    } else {
      result = collectionStore(tabId, rule, '', msg.type === 'resetCollection');
    }
    if ('error' in result) {
      sendResponse({ type, success: false, error: result.error });
      return;
    }
    sendResponse({ type, success: true, items: result.store.items });
  }

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
        // A panel that predates variables sends none; the ones held are kept then.
        if (msg.variables !== undefined) {
          state.variables = NetworkOverridesUtils.variablesFrom(msg.variables);
        }
        if (tabUrl) state.origin = NetworkOverridesUtils.getOrigin(tabUrl);
        TabState.rulesChanged(tabId);
        TabState.schedulePersist(tabId);
        // A first attach installs the WebSocket rules itself. A tab that is
        // attached, or still attaching (its sync may have read the old rules
        // already), needs the new rules pushed.
        const needsSync =
          !!TabState.get(tabId)?.attached || !!TabState.runtime(tabId).attachPromise;
        const update = enabled
          ? attachDebugger(tabId).then(() => (needsSync ? syncWebSocketRules(tabId) : undefined))
          : detachDebugger(tabId);
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
        // The list normally travels without bodies, which are fetched one at a
        // time when a rule is created. An export asks for all of them at once.
        const withBodies = (apis: ApiEntry[], bodyOf: (url: string) => unknown): ApiEntry[] =>
          msg.includeBodies !== true
            ? apis
            : apis.map(api => {
                const body = bodyOf(api.url);
                return typeof body === 'string' ? { ...api, body } : api;
              });
        const state = TabState.get(tabId);
        if (state && typeof sendResponse === 'function') {
          sendResponse({
            type: 'apisResponse',
            apis: withBodies(Array.from(state.recentApis.values()), url =>
              state.recentApiBodies.get(url)
            ),
          });
          return true;
        }

        void Promise.resolve(chrome.storage.session.get(TabState.stateKey(tabId))).then(
          (data: any) => {
            const snapshot = data?.[TabState.stateKey(tabId)];
            const apis: ApiEntry[] = snapshot?.recentApis ? Object.values(snapshot.recentApis) : [];
            if (typeof sendResponse === 'function') {
              sendResponse({
                type: 'apisResponse',
                apis: withBodies(apis, url => snapshot?.recentApiBodies?.[url]),
              });
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
            state.stats = { totalOverridden: 0, totalFailed: 0 };
            TabState.schedulePersist(clearTabId);
            TabState.runtime(clearTabId).subscriberPorts.forEach(port => {
              try {
                port.postMessage({ type: 'stats', stats: { ...state.stats } });
              } catch {}
            });
            TabState.resetRuleHits(clearTabId);
          }
        }
        if (typeof sendResponse === 'function') {
          sendResponse({ type: 'clearApisResponse', success: true });
        }
        return;
      }
      case 'resetRuleHits': {
        const tabId = Number(msg.tabId);
        if (!Number.isNaN(tabId)) TabState.resetRuleHits(tabId);
        if (typeof sendResponse === 'function') {
          sendResponse({ type: 'resetRuleHitsResponse', success: true });
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
      case 'setThrottle': {
        const tabId = Number(msg.tabId);
        const preset = msg.preset;
        if (Number.isNaN(tabId) || !THROTTLE_PRESETS.includes(preset)) {
          sendResponse({
            type: 'setThrottleResponse',
            success: false,
            error: 'Invalid throttle preset',
          });
          return;
        }
        const state = TabState.ensure(tabId);
        const previousPreset = state.throttlePreset;
        state.throttlePreset = preset;
        TabState.schedulePersist(tabId);
        const update = state.attached ? applyThrottle(tabId, preset) : Promise.resolve();
        void update
          .then(() => {
            TabState.runtime(tabId).subscriberPorts.forEach(port => {
              try {
                port.postMessage({ type: 'throttle', throttlePreset: preset });
              } catch {}
            });
            sendResponse({ type: 'setThrottleResponse', success: true, preset });
          })
          .catch(error => {
            state.throttlePreset = previousPreset;
            TabState.schedulePersist(tabId);
            sendResponse({
              type: 'setThrottleResponse',
              success: false,
              error: error instanceof Error ? error.message : String(error),
            });
          });
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
      case 'getCollection':
      case 'resetCollection':
      case 'setCollection': {
        if (typeof sendResponse === 'function') handleCollectionMessage(msg, sendResponse);
        return;
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
