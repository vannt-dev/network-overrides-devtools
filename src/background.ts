/// <reference types="chrome" />

namespace NetworkOverridesBackground {
  type OverrideRule = NetworkOverridesShared.OverrideRule;
  type OverrideState = NetworkOverridesShared.OverrideState;
  type FetchHeader = NetworkOverridesShared.FetchHeader;

  const attachedTabs = new Set<number>();
  const overridesMap = new Map<number, OverrideState>();
  const recentApisMap = new Map<number, Map<string, string>>();
  const recentApiBodiesMap = new Map<number, Map<string, string>>();
  const RECENT_APIS_LIMIT = 500;
  const RECENT_API_BODIES_LIMIT = 100;

  export function isRegexPattern(pattern: string): boolean {
    return pattern.startsWith('/') && pattern.lastIndexOf('/') > 0;
  }

  export function normalizeBody(body: string, isBase64: boolean): string {
    try {
      if (isBase64) {
        const decoded = atob(body);
        // Convert binary string to UTF-8 text
        return decodeURIComponent(escape(decoded));
      }
      return body;
    } catch {
      return body;
    }
  }

  function storeResponseBody(tabId: number, url: string, requestId: string, callback: () => void): void {
    chrome.debugger.sendCommand({ tabId }, 'Fetch.getResponseBody', { requestId }, (response: any) => {
      if (!chrome.runtime.lastError && response && typeof response.body === 'string') {
        const rawBody = normalizeBody(response.body, response.base64Encoded);
        let map = recentApiBodiesMap.get(tabId);
        if (!map) {
          map = new Map<string, string>();
        }
        if (map.has(url)) {
          map.delete(url);
        }
        map.set(url, rawBody);
        if (map.size > RECENT_API_BODIES_LIMIT) {
          const arr = Array.from(map.entries()).slice(-RECENT_API_BODIES_LIMIT);
          map = new Map(arr);
        }
        recentApiBodiesMap.set(tabId, map);

        const persisted = Object.fromEntries(map.entries());
        const storageKey = `recentApiBodies_${tabId}`;
        chrome.storage.local.set({ [storageKey]: persisted });
      }
      callback();
    });
  }

  function persistRecentApis(tabId: number, apis: Map<string, string>): void {
    const persisted = Object.fromEntries(apis.entries());
    const storageKey = `recentApis_${tabId}`;
    chrome.storage.local.set({ [storageKey]: persisted });
  }

  function setRecentApi(tabId: number, url: string, type: string): void {
    let apis = recentApisMap.get(tabId);
    if (!apis) {
      apis = new Map<string, string>();
    }

    if (apis.has(url)) {
      apis.delete(url);
    }
    apis.set(url, type);
    if (apis.size > RECENT_APIS_LIMIT) {
      const arr = Array.from(apis.entries()).slice(-RECENT_APIS_LIMIT);
      apis = new Map(arr);
    }

    recentApisMap.set(tabId, apis);
    persistRecentApis(tabId, apis);
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

chrome.runtime.onMessage.addListener((msg: any, sender, sendResponse) => {
  if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') {
    return;
  }

  if (msg.type === 'update') {
    const tabId = Number(msg.tabId);
    if (Number.isNaN(tabId)) return;

    const enabled = Boolean(msg.enabled);
    const overrides = Array.isArray(msg.overrides) ? msg.overrides as OverrideRule[] : [];

    overridesMap.set(tabId, { enabled, overrides });
    if (enabled) {
      attachDebugger(tabId).catch(console.error);
    } else {
      detachDebugger(tabId).catch(console.error);
    }
  } else if (msg.type === 'getApis') {
    const tabId = Number(msg.tabId);
    if (Number.isNaN(tabId)) return;
    const apisMap = recentApisMap.get(tabId);
    if (apisMap && typeof sendResponse === 'function') {
      const apis = Array.from(apisMap.entries()).map(([url, type]) => ({ url, type }));
      sendResponse({ type: 'apisResponse', apis });
      return true;
    }

    const storageKey = `recentApis_${tabId}`;
    chrome.storage.local.get([storageKey], (data: any) => {
      const obj = data[storageKey] || {};
      const apis = Object.entries(obj)
        .filter(([url, type]) => typeof url === 'string' && typeof type === 'string')
        .map(([url, type]) => ({ url, type: String(type) }));

      if (typeof sendResponse === 'function') {
        sendResponse({ type: 'apisResponse', apis });
      }
    });
    return true; // keep message channel open for async response
  } else if (msg.type === 'getApiData') {
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

    const storageKey = `recentApiBodies_${tabId}`;
    chrome.storage.local.get([storageKey], (data: any) => {
      const obj = data[storageKey] || {};
      const body = typeof obj[url] === 'string' ? obj[url] : '';
      if (typeof sendResponse === 'function') {
        sendResponse({ type: 'apiDataResponse', url, body });
      }
    });
    return true;
  }

  if (typeof sendResponse === 'function') {
    sendResponse({ success: true });
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

        chrome.debugger.sendCommand({ tabId }, 'Fetch.enable', { patterns: [{ requestStage: 'Response' }] }, () => {
          if (chrome.runtime.lastError) {
            console.error('Fetch.enable failed', chrome.runtime.lastError);
          }
        });

        resolve();
      });
    } catch (error) {
      reject(error);
    }
  });
}

async function detachDebugger(tabId: number): Promise<void> {
  if (!attachedTabs.has(tabId)) return;

  return new Promise((resolve) => {
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

chrome.tabs.onRemoved.addListener((tabId) => {
  if (attachedTabs.has(tabId)) {
    detachDebugger(tabId).catch(console.error);
  }
});

chrome.debugger.onEvent.addListener((source, method, params: any) => {
  const tabId = source.tabId;
  if (typeof tabId !== 'number') return;

  if (method === 'Network.requestWillBeSent') {
    const requestUrl = params?.request?.url;
    const requestType = params?.type || 'other';
    if (typeof requestUrl === 'string') {
      setRecentApi(tabId, requestUrl, requestType);
    }
    return;
  }

  if (method !== 'Fetch.requestPaused') {
    return;
  }

  const info = overridesMap.get(tabId);
  const url = params.request?.url || '';

  // Ensure type is stored for this URL if not already
  const apis = recentApisMap.get(tabId);
  if (!apis?.has(url)) {
    const requestType = params.resourceType || 'other';
    setRecentApi(tabId, url, requestType);
  }

  const proceedWithoutOverride = () => {
    chrome.debugger.sendCommand({ tabId }, 'Fetch.continueRequest', { requestId: params.requestId });
  };

  if (!info || !info.enabled) {
    storeResponseBody(tabId, url, params.requestId, proceedWithoutOverride);
    return;
  }

  try {
    const ov = info.overrides.find((test) => patternMatches(test.pattern, url));

    if (!ov) {
      storeResponseBody(tabId, url, params.requestId, proceedWithoutOverride);
      return;
    }

    const responseBodyBase64 = ov.mode === 'file'
      ? ov.body
      : btoa(unescape(encodeURIComponent(ov.body || '')));

    const headers = [ ...(((params.responseHeaders as FetchHeader[]) || [])) ];
    if (!headers.find((h) => h.name.toLowerCase() === 'content-type')) {
      headers.push({ name: 'Content-Type', value: 'application/json; charset=utf-8' });
    }

    headers.push({ name: 'x-network-overrides', value: 'true' });
    headers.push({ name: 'x-network-overrides-pattern', value: ov.pattern });

    const responseCode = typeof params.responseStatusCode === 'number' ? params.responseStatusCode : 200;
    const responsePhrase = typeof params.responseStatusText === 'string' ? params.responseStatusText : undefined;

    chrome.debugger.sendCommand({ tabId }, 'Fetch.fulfillRequest', {
      requestId: params.requestId,
      responseCode,
      responsePhrase,
      responseHeaders: headers,
      body: responseBodyBase64,
    }, () => {
      if (chrome.runtime.lastError) {
        console.error('fulfillRequest failed', chrome.runtime.lastError);
      }
    });
  } catch (error) {
    console.error(error);
    chrome.debugger.sendCommand({ tabId }, 'Fetch.continueRequest', { requestId: params.requestId });
  }
});

}
