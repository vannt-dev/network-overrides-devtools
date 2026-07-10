/// <reference types="chrome" />
/// <reference path="./shared.ts" />
/// <reference path="./utils.ts" />
/// <reference path="./tab-state.ts" />
declare const Buffer: any;
declare function importScripts(...urls: string[]): void;

// Service workers can't use <script> tags like the UI pages do, so pull in
// the shared pattern-matching logic the same way at runtime instead of
// duplicating it here.
importScripts('utils.js', 'tab-state.js');

function stringToBase64Local(str: string): string {
  if (typeof Buffer !== 'undefined') {
    try {
      return Buffer.from(str, 'utf8').toString('base64');
    } catch {}
  }
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
  }
  return btoa(binary);
}
function normalizeBodyLocal(body: string, isBase64: boolean): string {
  try {
    if (isBase64) {
      if (typeof Buffer !== 'undefined') {
        return Buffer.from(body, 'base64').toString('utf8');
      }
      const decoded = atob(body);
      return decodeURIComponent(escape(decoded));
    }
    return body;
  } catch {
    return body;
  }
}

namespace NetworkOverridesBackground {
  import TabState = NetworkOverridesTabState;

  type OverrideRule = NetworkOverridesShared.OverrideRule;
  type FetchHeader = NetworkOverridesShared.FetchHeader;
  type ApiEntry = NetworkOverridesShared.ApiEntry;

  function toFetchHeaders(headers: Record<string, unknown> | undefined): FetchHeader[] {
    if (!headers) return [];
    return Object.entries(headers).map(([name, value]) => ({ name, value: String(value) }));
  }

  const CAPTURED_BODY_TYPES = ['xhr', 'fetch'];

  export function matchPattern(pattern: string, url: string): string[] | null {
    return NetworkOverridesUtils.matchPattern(pattern, url);
  }

  export function patternMatches(pattern: string, url: string): boolean {
    return NetworkOverridesUtils.patternMatches(pattern, url);
  }

  export function substituteWildcards(template: string, captures: string[]): string {
    return NetworkOverridesUtils.substituteWildcards(template, captures);
  }

  export function normalizeBody(body: string, isBase64: boolean): string {
    return normalizeBodyLocal(body, isBase64);
  }

  function recordApi(tabId: number, entry: ApiEntry): void {
    TabState.setRecentApi(tabId, entry);
    scheduleApiBroadcast(tabId, entry);
  }

  function scheduleApiBroadcast(tabId: number, entry: ApiEntry): void {
    const rt = TabState.runtime(tabId);
    if (rt.subscriberPorts.size === 0) return;
    rt.broadcastQueue.set(entry.url, entry);
    if (rt.broadcastTimer) return;
    rt.broadcastTimer = setTimeout(() => {
      rt.broadcastTimer = null;
      const delta = Array.from(rt.broadcastQueue.values());
      rt.broadcastQueue.clear();
      if (delta.length === 0 || rt.subscriberPorts.size === 0) return;
      rt.subscriberPorts.forEach(port => {
        try {
          port.postMessage({ type: 'apisDelta', apis: delta });
        } catch {}
      });
    }, 150);
  }

  function storeResponseBody(
    tabId: number,
    url: string,
    requestId: string,
    callback: () => void
  ): void {
    chrome.debugger.sendCommand(
      { tabId },
      'Fetch.getResponseBody',
      { requestId },
      (response: { body?: string; base64Encoded?: boolean } | undefined) => {
        if (!chrome.runtime.lastError && response && typeof response.body === 'string') {
          const rawBody = normalizeBody(response.body, response.base64Encoded ?? false);
          TabState.setRecentApiBody(tabId, url, rawBody);
        }
        callback();
      }
    );
  }

  // Strongly-typed messaging surface
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
    | { type: 'getStatus'; tabId: number };

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
        if (enabled) {
          attachDebugger(tabId).catch(console.error);
        } else {
          detachDebugger(tabId).catch(console.error);
        }
        break;
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
      default:
        if (typeof sendResponse === 'function') {
          sendResponse({ success: true });
        }
        break;
    }
  });

  chrome.runtime.onConnect.addListener(port => {
    if (!port || port.name !== 'network-overrides-ui') return;

    let subscribedTabId: number | null = null;

    function unsubscribe(): void {
      if (subscribedTabId === null) return;
      TabState.runtime(subscribedTabId).subscriberPorts.delete(port);
      subscribedTabId = null;
    }

    port.onDisconnect.addListener(() => unsubscribe());

    port.onMessage.addListener((raw: any) => {
      if (!raw || typeof raw !== 'object') return;
      if (raw.type !== 'subscribe') return;

      const tabId = Number(raw.tabId);
      if (Number.isNaN(tabId)) return;

      if (subscribedTabId !== null && subscribedTabId !== tabId) {
        unsubscribe();
      }

      subscribedTabId = tabId;
      TabState.runtime(tabId).subscriberPorts.add(port);

      const state = TabState.get(tabId);
      const apis = state ? Array.from(state.recentApis.values()) : [];
      try {
        port.postMessage({ type: 'apis', apis });
      } catch {}
    });
  });

  async function enableInterception(tabId: number): Promise<void> {
    await sendDebugCommand(tabId, 'Network.enable', {});
    await sendDebugCommand(tabId, 'Fetch.enable', {
      patterns: [{ requestStage: 'Request' }, { requestStage: 'Response' }],
    });
  }

  function sendDebugCommand(tabId: number, method: string, params: object): Promise<void> {
    return new Promise((resolve, reject) => {
      chrome.debugger.sendCommand({ tabId }, method, params, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve();
        }
      });
    });
  }

  function broadcastStatus(tabId: number): void {
    const state = TabState.get(tabId);
    if (!state) return;
    const payload: { type: string; tabId: number; attached: boolean; error?: string } = {
      type: 'status',
      tabId,
      attached: state.attached,
    };
    if (state.attachError) payload.error = state.attachError;
    TabState.runtime(tabId).subscriberPorts.forEach(port => {
      try {
        port.postMessage(payload);
      } catch {}
    });
  }

  function attachDebugger(tabId: number): Promise<void> {
    const state = TabState.ensure(tabId);
    const rt = TabState.runtime(tabId);
    if (state.attached) return Promise.resolve();
    if (rt.attachPromise) return rt.attachPromise;

    const attempt = new Promise<void>((resolve, reject) => {
      try {
        chrome.debugger.attach({ tabId }, '1.3', async () => {
          if (chrome.runtime.lastError) {
            const message = chrome.runtime.lastError.message || 'attach failed';
            // Debugger sessions belong to the extension, not the worker
            // instance, so our own session survives a worker restart and makes
            // this attach fail. If commands still work, adopt that session;
            // if they fail too, a foreign debugger (e.g. DevTools) owns the tab.
            if (/already attached/i.test(message)) {
              try {
                await enableInterception(tabId);
                return resolve();
              } catch {
                return reject(new Error(message));
              }
            }
            return reject(new Error(message));
          }
          try {
            await enableInterception(tabId);
            resolve();
          } catch (err) {
            chrome.debugger.detach({ tabId }, () => {});
            reject(err instanceof Error ? err : new Error(String(err)));
          }
        });
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    })
      .then(() => {
        state.attached = true;
        state.attachError = undefined;
        TabState.schedulePersist(tabId);
        broadcastStatus(tabId);
      })
      .catch(error => {
        state.attached = false;
        state.attachError = error instanceof Error ? error.message : String(error);
        state.enabled = false;
        TabState.schedulePersist(tabId);
        broadcastStatus(tabId);
        throw error;
      })
      .finally(() => {
        rt.attachPromise = null;
      });

    rt.attachPromise = attempt;
    return attempt;
  }

  async function detachDebugger(tabId: number): Promise<void> {
    if (!TabState.get(tabId)?.attached) return;

    return new Promise(resolve => {
      try {
        chrome.debugger.sendCommand({ tabId }, 'Fetch.disable', {}, () => {
          chrome.debugger.detach({ tabId }, () => {
            TabState.dispose(tabId);
            resolve();
          });
        });
      } catch (error) {
        console.error(error);
        resolve();
      }
    });
  }

  chrome.tabs.onRemoved.addListener(tabId => {
    if (TabState.get(tabId)?.attached) {
      detachDebugger(tabId).catch(console.error);
    }
    TabState.dispose(tabId);
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (typeof changeInfo.url !== 'string') return;
    const state = TabState.get(tabId);
    if (!state) return;
    const newOrigin = NetworkOverridesUtils.getOrigin(changeInfo.url);
    if (!newOrigin || newOrigin === state.origin) return;

    state.origin = newOrigin;
    state.recentApis.clear();
    state.recentApiBodies.clear();
    const overridesKey = `overrides_${newOrigin}`;
    chrome.storage.local.get([overridesKey], (data: any) => {
      if (state.origin !== newOrigin) return;
      const saved = data?.[overridesKey];
      state.overrides = Array.isArray(saved) ? saved : [];
      TabState.schedulePersist(tabId);
    });
  });

  chrome.debugger.onDetach.addListener(source => {
    const tabId = source.tabId;
    if (typeof tabId !== 'number') return;
    TabState.dispose(tabId);
  });

  chrome.debugger.onEvent.addListener((source, method, params: any) => {
    const tabId = source.tabId;
    if (typeof tabId !== 'number') return;

    if (method === 'Fetch.requestPaused') {
      handleRequestPaused(tabId, params);
      return;
    }

    if (!TabState.get(tabId)?.attached) return;

    if (method === 'Network.requestWillBeSent') {
      const requestUrlInner = params?.request?.url;
      const requestType = params?.type || 'other';
      if (typeof requestUrlInner === 'string') {
        recordApi(tabId, {
          url: requestUrlInner,
          type: requestType,
          method: params.request.method,
          headers: toFetchHeaders(params.request.headers),
          postData: params.request.postData,
        });
      }
      return;
    }
  });

  function findOverride(
    url: string,
    method: string | undefined,
    overrides: OverrideRule[]
  ): { override: OverrideRule; captures: string[] } | null {
    for (const test of overrides) {
      if (test.enabled === false) continue;
      if (!NetworkOverridesUtils.matchesMethod(test.method, method)) continue;
      const captures = matchPattern(test.pattern, url);
      if (captures !== null) {
        return { override: test, captures };
      }
    }
    return null;
  }

  function handleRequestPaused(tabId: number, params: any): void {
    const isRequestStage = typeof params.responseStatusCode !== 'number';
    const url = params.request?.url || '';
    const state = TabState.get(tabId);

    const proceed = () => {
      chrome.debugger.sendCommand(
        { tabId },
        'Fetch.continueRequest',
        { requestId: params.requestId },
        () => {
          if (chrome.runtime.lastError) {
            // InterceptionId may already be invalid if request completed; ignore
          }
        }
      );
    };

    if (!state || !state.attached || !state.enabled) {
      proceed();
      return;
    }

    if (isRequestStage) {
      if (!state.recentApis.has(url)) {
        recordApi(tabId, {
          url,
          type: params.resourceType || 'other',
          method: params.request?.method,
          headers: toFetchHeaders(params.request?.headers),
          postData: params.request?.postData,
        });
      }

      try {
        const match = findOverride(url, params.request?.method, state.overrides);
        if (match && match.override.redirectUrl) {
          const newUrl = substituteWildcards(match.override.redirectUrl, match.captures);
          if (newUrl.includes('*')) {
            console.error('[NetworkOverrides] Unsubstituted * in redirect URL:', newUrl);
            proceed();
            return;
          }
          console.log('[NetworkOverrides] Redirect:', url, '→', newUrl);
          chrome.debugger.sendCommand(
            { tabId },
            'Fetch.continueRequest',
            { requestId: params.requestId, url: newUrl },
            () => {
              if (chrome.runtime.lastError) {
                console.error('continueRequest redirect failed:', chrome.runtime.lastError.message);
                proceed();
              }
            }
          );
          return;
        }
      } catch (error) {
        console.error(error);
      }

      proceed();
      return;
    }

    // Response stage
    console.log('[NetworkOverrides] Response:', url);

    try {
      recordApi(tabId, {
        url,
        type: params.resourceType || 'other',
        method: params.request?.method,
        headers: toFetchHeaders(params.request?.headers),
        postData: params.request?.postData,
        statusCode:
          typeof params.responseStatusCode === 'number' ? params.responseStatusCode : undefined,
      });

      const match = findOverride(url, params.request?.method, state.overrides);
      if (!match) {
        const resourceType = (params.resourceType || '').toLowerCase();
        if (CAPTURED_BODY_TYPES.includes(resourceType)) {
          storeResponseBody(tabId, url, params.requestId, proceed);
        } else {
          proceed();
        }
        return;
      }

      // If the override has a redirectUrl, skip body fulfillment at response stage.
      // The redirect was already handled at request stage; the server's response
      // for the redirected URL should pass through without alteration.
      if (match.override.redirectUrl) {
        proceed();
        return;
      }

      console.log('[NetworkOverrides] Fulfill body:', match.override.pattern, '→', url);

      const ov = match.override;

      function bodyToValidBase64(): string {
        if (ov.mode !== 'file') return stringToBase64Local(ov.body || '');
        try {
          atob(ov.body);
          return ov.body;
        } catch {
          console.warn(
            '[NetworkOverrides] Invalid base64 in file mode for',
            ov.pattern,
            '— encoding as text instead'
          );
          return stringToBase64Local(ov.body || '');
        }
      }

      const responseBodyBase64 = bodyToValidBase64();

      const headers = [...((params.responseHeaders as FetchHeader[]) || [])];
      if (!headers.find(h => h.name.toLowerCase() === 'content-type')) {
        headers.push({ name: 'Content-Type', value: 'application/json; charset=utf-8' });
      }

      headers.push({ name: 'x-network-overrides', value: 'true' });
      headers.push({ name: 'x-network-overrides-pattern', value: ov.pattern });

      const responseCode =
        typeof params.responseStatusCode === 'number' &&
        params.responseStatusCode >= 100 &&
        params.responseStatusCode <= 599
          ? params.responseStatusCode
          : 200;

      chrome.debugger.sendCommand(
        { tabId },
        'Fetch.fulfillRequest',
        {
          requestId: params.requestId,
          responseCode,
          responseHeaders: headers,
          body: responseBodyBase64,
        },
        () => {
          if (chrome.runtime.lastError) {
            console.error('fulfillRequest failed:', chrome.runtime.lastError.message);
            proceed();
          }
        }
      );
    } catch (error) {
      console.error(error);
      proceed();
    }
  }

  async function migrateLegacyLocalKeys(): Promise<void> {
    try {
      const all: Record<string, unknown> = await Promise.resolve(chrome.storage.local.get(null));
      const legacy = Object.keys(all || {}).filter(
        key => key.startsWith('recentApis_') || key.startsWith('recentApiBodies_')
      );
      if (legacy.length > 0) {
        await Promise.resolve(chrome.storage.local.remove(legacy));
      }
    } catch {
      // Non-fatal: migration retries on the next worker start.
    }
  }

  export const ready: Promise<void> = (async () => {
    const reattach = await TabState.rehydrate();
    for (const tabId of reattach) {
      // attachDebugger's catch already records the error and disables the tab.
      await attachDebugger(tabId).catch(error => {
        console.error('[NetworkOverrides] Re-attach failed for tab', tabId, error);
      });
    }
    await migrateLegacyLocalKeys();
  })();
}
