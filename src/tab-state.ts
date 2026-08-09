/// <reference types="chrome" />
/// <reference path="./shared.ts" />

// The pinned @types/chrome version predates the storage.session API;
// augment it locally rather than upgrading the whole type package.
declare namespace chrome.storage {
  export const session: StorageArea;
}

namespace NetworkOverridesTabState {
  type OverrideRule = NetworkOverridesShared.OverrideRule;
  type ApiEntry = NetworkOverridesShared.ApiEntry;

  export interface TabStateStats {
    totalOverridden: number;
    totalFailed: number;
  }

  export interface TabState {
    enabled: boolean;
    origin: string;
    overrides: OverrideRule[];
    attached: boolean;
    attachError?: string;
    recentApis: Map<string, ApiEntry>;
    recentApiBodies: Map<string, string>;
    stats: TabStateStats;
    throttlePreset?: 'none' | 'fast3g' | 'slow3g' | 'offline';
  }

  // Runtime-only artifacts: never mirrored to storage.
  export interface TabRuntime {
    persistTimer: ReturnType<typeof setTimeout> | null;
    subscriberPorts: Set<chrome.runtime.Port>;
    broadcastQueue: Map<string, ApiEntry>;
    broadcastTimer: ReturnType<typeof setTimeout> | null;
    attachPromise: Promise<void> | null;
  }

  export const RECENT_APIS_LIMIT = 500;
  export const RECENT_API_BODIES_LIMIT = 100;
  export const PERSIST_DEBOUNCE_MS = 500;

  const states = new Map<number, TabState>();
  const runtimes = new Map<number, TabRuntime>();

  export function stateKey(tabId: number): string {
    return `tabState_${tabId}`;
  }

  export function get(tabId: number): TabState | undefined {
    return states.get(tabId);
  }

  export function ensure(tabId: number): TabState {
    let state = states.get(tabId);
    if (!state) {
      state = {
        enabled: false,
        origin: '',
        overrides: [],
        attached: false,
        recentApis: new Map(),
        recentApiBodies: new Map(),
        stats: { totalOverridden: 0, totalFailed: 0 },
        throttlePreset: 'none',
      };
      states.set(tabId, state);
    }
    return state;
  }

  export function recordOverrideStat(tabId: number, isFail = false): void {
    const state = ensure(tabId);
    if (isFail) {
      state.stats.totalFailed++;
    } else {
      state.stats.totalOverridden++;
    }
    schedulePersist(tabId);
  }

  export function runtime(tabId: number): TabRuntime {
    let rt = runtimes.get(tabId);
    if (!rt) {
      rt = {
        persistTimer: null,
        subscriberPorts: new Set(),
        broadcastQueue: new Map(),
        broadcastTimer: null,
        attachPromise: null,
      };
      runtimes.set(tabId, rt);
    }
    return rt;
  }

  export function tabIds(): number[] {
    return Array.from(states.keys());
  }

  function trimToLimit(map: Map<string, unknown>, limit: number): void {
    while (map.size > limit) {
      const oldest = map.keys().next().value;
      if (oldest === undefined) break;
      map.delete(oldest);
    }
  }

  export function setRecentApi(tabId: number, entry: ApiEntry): void {
    const state = ensure(tabId);
    const existing = state.recentApis.get(entry.url);
    const merged: ApiEntry = existing
      ? {
          ...existing,
          ...entry,
          postData: entry.postData !== undefined ? entry.postData : existing.postData,
        }
      : entry;
    if (state.recentApis.has(entry.url)) {
      state.recentApis.delete(entry.url);
    }
    state.recentApis.set(entry.url, merged);
    trimToLimit(state.recentApis, RECENT_APIS_LIMIT);
    schedulePersist(tabId);
  }

  export function setRecentApiBody(tabId: number, url: string, body: string): void {
    const state = ensure(tabId);
    if (state.recentApiBodies.has(url)) {
      state.recentApiBodies.delete(url);
    }
    state.recentApiBodies.set(url, body);
    trimToLimit(state.recentApiBodies, RECENT_API_BODIES_LIMIT);
    schedulePersist(tabId);
  }

  function serialize(state: TabState): Record<string, unknown> {
    return {
      enabled: state.enabled,
      origin: state.origin,
      overrides: state.overrides,
      attached: state.attached,
      attachError: state.attachError,
      recentApis: Object.fromEntries(state.recentApis.entries()),
      recentApiBodies: Object.fromEntries(state.recentApiBodies.entries()),
      stats: state.stats,
      throttlePreset: state.throttlePreset,
    };
  }

  function persistNow(tabId: number): Promise<void> {
    const state = states.get(tabId);
    if (!state) return Promise.resolve();
    return Promise.resolve(
      chrome.storage.session.set({ [stateKey(tabId)]: serialize(state) })
    ).catch(() => {});
  }

  export function schedulePersist(tabId: number): void {
    const rt = runtime(tabId);
    if (rt.persistTimer) clearTimeout(rt.persistTimer);
    rt.persistTimer = setTimeout(() => {
      rt.persistTimer = null;
      void persistNow(tabId);
    }, PERSIST_DEBOUNCE_MS);
  }

  export function flushPersist(tabId: number): Promise<void> {
    const rt = runtime(tabId);
    if (rt.persistTimer) {
      clearTimeout(rt.persistTimer);
      rt.persistTimer = null;
    }
    return persistNow(tabId);
  }

  export function dispose(tabId: number): void {
    const rt = runtimes.get(tabId);
    if (rt) {
      if (rt.persistTimer) clearTimeout(rt.persistTimer);
      if (rt.broadcastTimer) clearTimeout(rt.broadcastTimer);
      rt.subscriberPorts.forEach(port => {
        try {
          port.disconnect();
        } catch {}
      });
      runtimes.delete(tabId);
    }
    states.delete(tabId);
    try {
      void Promise.resolve(chrome.storage.session.remove(stateKey(tabId))).catch(() => {});
    } catch {}
  }

  export async function rehydrate(): Promise<number[]> {
    let all: Record<string, any>;
    try {
      all = await chrome.storage.session.get(null);
    } catch {
      return [];
    }
    const toReattach: number[] = [];
    const deadKeys: string[] = [];
    for (const [key, raw] of Object.entries(all || {})) {
      if (!key.startsWith('tabState_')) continue;
      const tabId = Number(key.slice('tabState_'.length));
      if (Number.isNaN(tabId) || !raw || typeof raw !== 'object') {
        deadKeys.push(key);
        continue;
      }
      // Events may already have rebuilt fresher state before rehydrate ran;
      // never clobber in-memory state with the stored snapshot.
      if (states.has(tabId)) continue;
      let tabExists: boolean;
      try {
        const tab = await chrome.tabs.get(tabId);
        tabExists = !!tab;
      } catch {
        tabExists = false;
      }
      if (!tabExists) {
        deadKeys.push(key);
        continue;
      }
      const state = ensure(tabId);
      state.enabled = !!raw.enabled;
      state.origin = typeof raw.origin === 'string' ? raw.origin : '';
      state.overrides = Array.isArray(raw.overrides) ? raw.overrides : [];
      // The debugger never survives a worker restart.
      state.attached = false;
      state.attachError = undefined;
      state.recentApis = new Map(Object.entries(raw.recentApis || {}));
      state.recentApiBodies = new Map(Object.entries(raw.recentApiBodies || {}));
      if (state.enabled) toReattach.push(tabId);
    }
    if (deadKeys.length) {
      try {
        await chrome.storage.session.remove(deadKeys);
      } catch {}
    }
    return toReattach;
  }
}
