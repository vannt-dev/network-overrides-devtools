/// <reference types="chrome" />
/// <reference path="./shared.ts" />
// Runtime types are provided via ambient NetworkOverridesShared declarations
// Local helper utilities to avoid external module imports for test harness compatibility
declare var Buffer: any;
function recApisKey(tabId: number): string {
  return `recentApis_${tabId}`;
}

// Compatibility bridge: expose runtime helpers on a global object to support existing tests
(() => {
  try {
    const g: any =
      typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : {};
    if (!g.NetworkOverridesBackground) {
      g.NetworkOverridesBackground = {};
    }
    // If namespace-based helpers exist, bridge them to the global surface
    const nh = (NetworkOverridesBackground as any) ?? undefined;
    if (nh) {
      if (typeof nh.patternMatches === 'function') {
        g.NetworkOverridesBackground.patternMatches = nh.patternMatches;
      }
      if (typeof nh.normalizeBody === 'function') {
        g.NetworkOverridesBackground.normalizeBody = nh.normalizeBody;
      }
    }
  } catch {
    // ignore bridge errors in test harness
  }
})();
function recBodiesKey(tabId: number): string {
  return `recentApiBodies_${tabId}`;
}
function stringToBase64Local(str: string): string {
  // Use Browser/Node compatible base64 encoding
  if (typeof Buffer !== 'undefined') {
    try {
      return Buffer.from(str, 'utf8').toString('base64');
    } catch {
      // fall through to fallback
    }
  }
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  bytes.forEach(b => (binary += String.fromCharCode(b)));
  // Fallback to btoa if available
  if (typeof (globalThis as any).btoa === 'function') {
    return (globalThis as any).btoa(binary);
  }
  // Last resort: minimal polyfill (not perfect for all environments)
  return Buffer.from(binary, 'latin1').toString('base64');
}
function normalizeBodyLocal(body: string, isBase64: boolean): string {
  try {
    if (isBase64) {
      // Decode base64 to UTF-8 in a cross-platform way
      if (typeof Buffer !== 'undefined') {
        return Buffer.from(body, 'base64').toString('utf8');
      }
      const decoded = atob(body);
      // Decode UTF-8 sequence to string
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
  const attachedTabs = new Set<number>();
  const overridesMap = new Map<number, OverrideState>();
  const recentApisMap = new Map<number, Map<string, ApiEntry>>();
  const recentApiBodiesMap = new Map<number, Map<string, string>>();
  const RECENT_APIS_LIMIT = 500;
  const RECENT_API_BODIES_LIMIT = 100;
  let currentDomain = '';

  function isRegexPattern(pattern: string): boolean {
    return pattern.startsWith('/') && pattern.lastIndexOf('/') > 0;
  }

  function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  export function matchPattern(pattern: string, url: string): string[] | null {
    const trimmed = pattern.trim();
    if (trimmed === '*' || trimmed.toLowerCase() === 'all') {
      return [];
    }
    if (isRegexPattern(trimmed)) {
      const lastSlash = trimmed.lastIndexOf('/');
      const source = trimmed.slice(1, lastSlash);
      const flags = trimmed.slice(lastSlash + 1);
      try {
        const regex = new RegExp(source, flags);
        return regex.test(url) ? [] : null;
      } catch {
        return null;
      }
    }
    if (trimmed.includes('*')) {
      const parts = trimmed.split('*').map(escapeRegex);
      try {
        const regex = new RegExp('^' + parts.join('(.+)') + '$');
        const match = url.match(regex);
        return match ? match.slice(1) : null;
      } catch {
        return null;
      }
    }
    return url.includes(trimmed) ? [] : null;
  }

  export function patternMatches(pattern: string, url: string): boolean {
    return matchPattern(pattern, url) !== null;
  }

  export function substituteWildcards(template: string, captures: string[]): string {
    let result = template;
    let captureIndex = 0;
    while (result.includes('*') && captureIndex < captures.length) {
      result = result.replace('*', captures[captureIndex]);
      captureIndex++;
    }
    return result;
  }

  // Expose normalizeBody for tests and internal usage
  export function normalizeBody(body: string, isBase64: boolean): string {
    return normalizeBodyLocal(body, isBase64);
  }

  // normalizeBody and stringToBase64 are now centralized in src/utils.ts

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

          const persisted = Object.fromEntries(map.entries());
          const storageKey = recBodiesKey(tabId);
          chrome.storage.local.set({ [storageKey]: persisted });
        }
        callback();
      }
    );
  }

  function persistRecentApis(tabId: number, apis: Map<string, ApiEntry>): void {
    const persisted = Object.fromEntries(apis.entries());
    const storageKey = recApisKey(tabId);
    chrome.storage.local.set({ [storageKey]: persisted });
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

  function hasLastError(): boolean {
    return typeof chrome.runtime.lastError === 'string';
  }

  function getLastError(): string | undefined {
    const err = chrome.runtime.lastError;
    return typeof err === 'string' ? err : undefined;
  }

  chrome.runtime.onMessage.addListener((msg: Msg, sender, sendResponse) => {
    if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') {
      return;
    }
    switch (msg.type) {
      case 'update': {
        const tabId = Number((msg as any).tabId);
        if (Number.isNaN(tabId)) return;

        const enabled = Boolean((msg as any).enabled);
        const overrides = Array.isArray((msg as any).overrides)
          ? ((msg as any).overrides as OverrideRule[])
          : [];
        const tabUrl = typeof (msg as any).tabUrl === 'string' ? (msg as any).tabUrl : '';

        if (tabUrl) {
          currentDomain = getOrigin(tabUrl);
        }

        const tabMatchesDomain = tabUrl && urlMatchesDomain(tabUrl, currentDomain);

        overridesMap.set(tabId, { enabled, overrides });
        if (enabled && tabMatchesDomain) {
          attachDebugger(tabId).catch(console.error);
        } else {
          detachDebugger(tabId).catch(console.error);
        }
        break;
      }
      case 'getApis': {
        const tabId = Number((msg as any).tabId);
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
        const clearTabId = Number((msg as any).tabId);
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
        const tabId = Number((msg as any).tabId);
        const url = String((msg as any).url || '');
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

  async function attachDebugger(tabId: number): Promise<void> {
    if (attachedTabs.has(tabId)) return;
    return new Promise((resolve, reject) => {
      try {
        chrome.debugger.attach({ tabId }, '1.3', () => {
          if (chrome.runtime.lastError) {
            return reject(chrome.runtime.lastError);
          }

          attachedTabs.add(tabId);

          chrome.debugger.sendCommand({ tabId }, 'Network.enable', {}, () => {
            if (chrome.runtime.lastError) {
              console.error('Network.enable failed', chrome.runtime.lastError);
            }
          });

          chrome.debugger.sendCommand(
            { tabId },
            'Fetch.enable',
            { patterns: [{ requestStage: 'Request' }, { requestStage: 'Response' }] },
            () => {
              if (chrome.runtime.lastError) {
                console.error('Fetch.enable failed', chrome.runtime.lastError);
              }
            }
          );

          resolve();
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
            attachedTabs.delete(tabId);
            overridesMap.delete(tabId);
            recentApisMap.delete(tabId);
            recentApiBodiesMap.delete(tabId);
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
  });

  chrome.debugger.onDetach.addListener(source => {
    const tabId = source.tabId;
    if (typeof tabId !== 'number') return;
    attachedTabs.delete(tabId);
    overridesMap.delete(tabId);
    recentApisMap.delete(tabId);
    recentApiBodiesMap.delete(tabId);
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
    if (requestUrl && !urlMatchesDomain(requestUrl, currentDomain)) return;

    if (method === 'Network.requestWillBeSent') {
      const requestUrlInner = params?.request?.url;
      const requestType = params?.type || 'other';
      if (typeof requestUrlInner === 'string') {
        setRecentApi(tabId, {
          url: requestUrlInner,
          type: requestType,
          method: params.request.method,
          headers: params.request.headers
            ? Object.entries(params.request.headers).map(([name, value]) => ({
                name,
                value: String(value),
              }))
            : [],
          postData: params.request.postData,
        });
      }
      return;
    }
  });

  function findOverride(
    url: string,
    overrides: OverrideRule[]
  ): { override: OverrideRule; captures: string[] } | null {
    for (const test of overrides) {
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
      chrome.debugger.sendCommand({ tabId }, 'Fetch.continueRequest', {
        requestId: params.requestId,
      });
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
          headers: params.request?.headers
            ? Object.entries(params.request.headers).map(([name, value]) => ({
                name,
                value: String(value),
              }))
            : [],
          postData: params.request?.postData,
        });
      }

      try {
        const match = findOverride(url, info.overrides);
        if (match && match.override.redirectUrl) {
          let newUrl = substituteWildcards(match.override.redirectUrl, match.captures);
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
      const apis = recentApisMap.get(tabId);
      if (!apis?.has(url)) {
        setRecentApi(tabId, {
          url,
          type: params.resourceType || 'other',
          method: params.request?.method,
          headers: params.request?.headers
            ? Object.entries(params.request.headers).map(([name, value]) => ({
                name,
                value: String(value),
              }))
            : [],
          postData: params.request?.postData,
        });
      }

      const match = findOverride(url, info.overrides);
      if (!match) {
        const resourceType = (params.resourceType || '').toLowerCase();
        if (resourceType === 'xhr' || resourceType === 'fetch') {
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
      const responseBodyBase64 = ov.mode === 'file' ? ov.body : stringToBase64Local(ov.body || '');

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
