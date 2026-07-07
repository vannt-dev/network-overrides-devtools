/// <reference types="chrome" />
/// <reference path="./shared.ts" />
/// <reference path="./utils.ts" />
declare const Buffer: any;
declare function importScripts(...urls: string[]): void;

// Service workers can't use <script> tags like the UI pages do, so pull in
// the shared pattern-matching logic the same way at runtime instead of
// duplicating it here.
importScripts('utils.js');

function recApisKey(tabId: number): string {
  return `recentApis_${tabId}`;
}
function recBodiesKey(tabId: number): string {
  return `recentApiBodies_${tabId}`;
}
function stringToBase64Local(str: string): string {
  if (typeof Buffer !== 'undefined') {
    try {
      return Buffer.from(str, 'utf8').toString('base64');
    } catch {}
  }
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  bytes.forEach(b => (binary += String.fromCharCode(b)));
  if (typeof (globalThis as any).btoa === 'function') {
    return (globalThis as any).btoa(binary);
  }
  return Buffer.from(binary, 'latin1').toString('base64');
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
  type OverrideRule = NetworkOverridesShared.OverrideRule;
  type OverrideState = NetworkOverridesShared.OverrideState;
  type FetchHeader = NetworkOverridesShared.FetchHeader;
  type ApiEntry = NetworkOverridesShared.ApiEntry;

  function toFetchHeaders(headers: Record<string, unknown> | undefined): FetchHeader[] {
    if (!headers) return [];
    return Object.entries(headers).map(([name, value]) => ({ name, value: String(value) }));
  }

  const attachedTabs = new Set<number>();
  const overridesMap = new Map<number, OverrideState>();
  const recentApisMap = new Map<number, Map<string, ApiEntry>>();
  const recentApiBodiesMap = new Map<number, Map<string, string>>();
  const currentDomainMap = new Map<number, string>();
  const apiSubscriberPorts = new Map<number, Set<chrome.runtime.Port>>();
  const apiBroadcastQueues = new Map<number, Map<string, ApiEntry>>();
  const apiBroadcastTimers = new Map<number, ReturnType<typeof setTimeout>>();
  const RECENT_APIS_LIMIT = 500;
  const RECENT_API_BODIES_LIMIT = 100;
  const CAPTURED_BODY_TYPES = ['xhr', 'fetch', 'script', 'image'];

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

  function getOrigin(url: string): string {
    try {
      return new URL(url).origin;
    } catch {
      return '';
    }
  }

  function urlMatchesDomain(url: string, domain: string): boolean {
    if (!domain) return true;
    return getOrigin(url) === domain;
  }

  function cleanupTabData(tabId: number): void {
    attachedTabs.delete(tabId);
    overridesMap.delete(tabId);
    recentApisMap.delete(tabId);
    recentApiBodiesMap.delete(tabId);
    currentDomainMap.delete(tabId);
    const ports = apiSubscriberPorts.get(tabId);
    if (ports) {
      ports.forEach(p => {
        try {
          p.disconnect();
        } catch {}
      });
      apiSubscriberPorts.delete(tabId);
    }
    const apiTimer = apiBroadcastTimers.get(tabId);
    if (apiTimer) {
      clearTimeout(apiTimer);
      apiBroadcastTimers.delete(tabId);
    }
    apiBroadcastQueues.delete(tabId);
    const timer = persistTimers.get(tabId);
    if (timer) {
      clearTimeout(timer);
      persistTimers.delete(tabId);
    }
    const bodyTimer = bodyPersistTimers.get(tabId);
    if (bodyTimer) {
      clearTimeout(bodyTimer);
      bodyPersistTimers.delete(tabId);
    }
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
        if (chrome.runtime.lastError) {
          if (chrome.runtime.lastError.message?.includes('Quota')) {
            callback();
            return;
          }
        }

        if (!chrome.runtime.lastError && response && typeof response.body === 'string') {
          const rawBody = normalizeBody(response.body, response.base64Encoded ?? false);
          let map = recentApiBodiesMap.get(tabId);
          if (!map) {
            map = new Map<string, string>();
          }
          if (map.has(url)) {
            map.delete(url);
          }
          map.set(url, rawBody);
          if (map.size > RECENT_API_BODIES_LIMIT) {
            const entries = Array.from(map.entries());
            for (let i = 0; i < entries.length - RECENT_API_BODIES_LIMIT; i++) {
              map.delete(entries[i][0]);
            }
          }
          recentApiBodiesMap.set(tabId, map);

          const existingBodyTimer = bodyPersistTimers.get(tabId);
          if (existingBodyTimer) clearTimeout(existingBodyTimer);
          bodyPersistTimers.set(
            tabId,
            setTimeout(() => {
              bodyPersistTimers.delete(tabId);
              const persisted = Object.fromEntries(map.entries());
              const storageKey = recBodiesKey(tabId);
              chrome.storage.local.set({ [storageKey]: persisted });
            }, 500)
          );
        }
        callback();
      }
    );
  }

  const persistTimers = new Map<number, ReturnType<typeof setTimeout>>();
  const bodyPersistTimers = new Map<number, ReturnType<typeof setTimeout>>();

  function persistRecentApis(tabId: number, apis: Map<string, ApiEntry>): void {
    const existing = persistTimers.get(tabId);
    if (existing) clearTimeout(existing);
    persistTimers.set(
      tabId,
      setTimeout(() => {
        persistTimers.delete(tabId);
        const persisted = Object.fromEntries(apis.entries());
        const storageKey = recApisKey(tabId);
        chrome.storage.local.set({ [storageKey]: persisted });
      }, 500)
    );
  }

  function scheduleApiBroadcast(tabId: number, entry: ApiEntry): void {
    const ports = apiSubscriberPorts.get(tabId);
    if (!ports || ports.size === 0) return;

    let queue = apiBroadcastQueues.get(tabId);
    if (!queue) {
      queue = new Map();
      apiBroadcastQueues.set(tabId, queue);
    }
    queue.set(entry.url, entry);

    const existing = apiBroadcastTimers.get(tabId);
    if (existing) return;

    apiBroadcastTimers.set(
      tabId,
      setTimeout(() => {
        apiBroadcastTimers.delete(tabId);
        const queued = apiBroadcastQueues.get(tabId);
        apiBroadcastQueues.delete(tabId);
        if (!queued || queued.size === 0) return;

        const delta = Array.from(queued.values());
        const currentPorts = apiSubscriberPorts.get(tabId);
        if (!currentPorts || currentPorts.size === 0) return;

        currentPorts.forEach(port => {
          try {
            port.postMessage({ type: 'apisDelta', apis: delta });
          } catch {}
        });
      }, 150)
    );
  }

  function setRecentApi(tabId: number, entry: ApiEntry): void {
    let apis = recentApisMap.get(tabId);
    if (!apis) {
      apis = new Map<string, ApiEntry>();
    }

    const { url } = entry;
    if (apis.has(url)) {
      apis.delete(url);
    }
    apis.set(url, entry);
    if (apis.size > RECENT_APIS_LIMIT) {
      const entries = Array.from(apis.entries());
      for (let i = 0; i < entries.length - RECENT_APIS_LIMIT; i++) {
        apis.delete(entries[i][0]);
      }
    }

    recentApisMap.set(tabId, apis);
    persistRecentApis(tabId, apis);
    scheduleApiBroadcast(tabId, entry);
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
    | { type: 'clearApis'; tabId: number };

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

        if (tabUrl) {
          currentDomainMap.set(tabId, getOrigin(tabUrl));
        }

        overridesMap.set(tabId, { enabled, overrides });
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
        const apisMap = recentApisMap.get(tabId);
        if (apisMap && typeof sendResponse === 'function') {
          const apis = Array.from(apisMap.values());
          sendResponse({ type: 'apisResponse', apis });
          return true;
        }

        const storageKey = recApisKey(tabId);
        chrome.storage.local.get([storageKey], (data: any) => {
          const obj = data[storageKey] || {};
          const apis = Object.values(obj)
            .map((val: any) => {
              if (typeof val === 'string') {
                return null;
              }
              return val;
            })
            .filter(Boolean);

          const legacyApis = Object.entries(obj)
            .filter(([_, val]) => typeof val === 'string')
            .map(([url, type]) => ({ url, type: String(type) }));

          if (typeof sendResponse === 'function') {
            sendResponse({ type: 'apisResponse', apis: [...apis, ...legacyApis] });
          }
        });
        return true;
      }
      case 'clearApis': {
        const clearTabId = Number(msg.tabId);
        if (!Number.isNaN(clearTabId)) {
          recentApisMap.delete(clearTabId);
          recentApiBodiesMap.delete(clearTabId);
        }
        if (typeof sendResponse === 'function') {
          sendResponse({ type: 'clearApisResponse', success: true });
        }
        return;
      }
      case 'getApiData': {
        const tabId = Number(msg.tabId);
        const url = String(msg.url || '');
        if (Number.isNaN(tabId) || !url) return;

        const bodies = recentApiBodiesMap.get(tabId);
        if (bodies?.has(url)) {
          if (typeof sendResponse === 'function') {
            sendResponse({ type: 'apiDataResponse', url, body: bodies.get(url) || '' });
          }
          return true;
        }

        const storageKey = recBodiesKey(tabId);
        chrome.storage.local.get([storageKey], (data: any) => {
          const obj = data[storageKey] || {};
          const body = typeof obj[url] === 'string' ? obj[url] : '';
          if (typeof sendResponse === 'function') {
            sendResponse({ type: 'apiDataResponse', url, body });
          }
        });
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
      const ports = apiSubscriberPorts.get(subscribedTabId);
      if (ports) {
        ports.delete(port);
        if (ports.size === 0) {
          apiSubscriberPorts.delete(subscribedTabId);
        }
      }
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
      let set = apiSubscriberPorts.get(tabId);
      if (!set) {
        set = new Set();
        apiSubscriberPorts.set(tabId, set);
      }
      set.add(port);

      const apisMap = recentApisMap.get(tabId);
      const apis = apisMap ? Array.from(apisMap.values()) : [];
      try {
        port.postMessage({ type: 'apis', apis });
      } catch {}
    });
  });

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

  async function attachDebugger(tabId: number): Promise<void> {
    if (attachedTabs.has(tabId)) return;
    return new Promise((resolve, reject) => {
      try {
        chrome.debugger.attach({ tabId }, '1.3', async () => {
          if (chrome.runtime.lastError) {
            return reject(chrome.runtime.lastError);
          }

          attachedTabs.add(tabId);

          try {
            await sendDebugCommand(tabId, 'Network.enable', {});
            await sendDebugCommand(tabId, 'Fetch.enable', {
              patterns: [{ requestStage: 'Request' }, { requestStage: 'Response' }],
            });
            resolve();
          } catch (err) {
            console.error('Failed to enable debugger commands:', err);
            cleanupTabData(tabId);
            chrome.debugger.detach({ tabId }, () => {});
            reject(err);
          }
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  async function detachDebugger(tabId: number): Promise<void> {
    if (!attachedTabs.has(tabId)) return;

    return new Promise(resolve => {
      try {
        chrome.debugger.sendCommand({ tabId }, 'Fetch.disable', {}, () => {
          chrome.debugger.detach({ tabId }, () => {
            cleanupTabData(tabId);
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
    if (attachedTabs.has(tabId)) {
      detachDebugger(tabId).catch(console.error);
    }
    cleanupTabData(tabId);
  });

  chrome.debugger.onDetach.addListener(source => {
    const tabId = source.tabId;
    if (typeof tabId !== 'number') return;
    cleanupTabData(tabId);
  });

  chrome.debugger.onEvent.addListener((source, method, params: any) => {
    const tabId = source.tabId;
    if (typeof tabId !== 'number') return;

    if (method === 'Fetch.requestPaused') {
      handleRequestPaused(tabId, params);
      return;
    }

    if (!attachedTabs.has(tabId)) return;

    const requestUrl = params?.request?.url || params?.response?.url || '';
    const tabDomain = currentDomainMap.get(tabId) || '';
    if (requestUrl && !urlMatchesDomain(requestUrl, tabDomain)) return;

    if (method === 'Network.requestWillBeSent') {
      const requestUrlInner = params?.request?.url;
      const requestType = params?.type || 'other';
      if (typeof requestUrlInner === 'string') {
        setRecentApi(tabId, {
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
    const info = overridesMap.get(tabId);

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

    if (!attachedTabs.has(tabId) || !info?.enabled) {
      proceed();
      return;
    }

    if (isRequestStage) {
      const apis = recentApisMap.get(tabId);
      if (!apis?.has(url)) {
        setRecentApi(tabId, {
          url,
          type: params.resourceType || 'other',
          method: params.request?.method,
          headers: toFetchHeaders(params.request?.headers),
          postData: params.request?.postData,
        });
      }

      try {
        const match = findOverride(url, params.request?.method, info.overrides);
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
      setRecentApi(tabId, {
        url,
        type: params.resourceType || 'other',
        method: params.request?.method,
        headers: toFetchHeaders(params.request?.headers),
        postData: params.request?.postData,
        statusCode:
          typeof params.responseStatusCode === 'number' ? params.responseStatusCode : undefined,
      });

      const match = findOverride(url, params.request?.method, info.overrides);
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
}
