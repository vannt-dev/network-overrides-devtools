/// <reference types="chrome" />
/// <reference path="../shared.ts" />
/// <reference path="../utils.ts" />
/// <reference path="../tab-state.ts" />
namespace NetworkOverridesBackground {
  import TabState = NetworkOverridesTabState;

  type FetchHeader = NetworkOverridesShared.FetchHeader;
  type ApiEntry = NetworkOverridesShared.ApiEntry;

  export function toFetchHeaders(headers: Record<string, unknown> | undefined): FetchHeader[] {
    if (!headers) return [];
    return Object.entries(headers).map(([name, value]) => ({ name, value: String(value) }));
  }

  let capturedBodyTypes: string[] = ['xhr', 'fetch'];
  try {
    chrome.storage.local.get(['capturedBodyTypes'], (data: any) => {
      if (Array.isArray(data?.capturedBodyTypes) && data.capturedBodyTypes.length > 0) {
        capturedBodyTypes = data.capturedBodyTypes.map((t: any) => String(t).toLowerCase());
      }
    });
  } catch {}

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
    return NetworkOverridesNormalizeBodyLocal(body, isBase64);
  }

  export function recordApi(tabId: number, entry: ApiEntry): void {
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

  export function storeResponseBody(
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
        port.postMessage({
          type: 'apis',
          apis,
          stats: state?.stats || { totalOverridden: 0, totalFailed: 0 },
          throttlePreset: state?.throttlePreset || 'none',
        });
      } catch {}
    });
  });

  export function setCapturedBodyTypes(types: unknown[]): void {
    capturedBodyTypes = types.map(type => String(type).toLowerCase());
  }

  export function shouldCaptureBody(resourceType: string): boolean {
    return capturedBodyTypes.includes(resourceType.toLowerCase());
  }
}
