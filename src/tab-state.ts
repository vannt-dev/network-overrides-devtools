/*! SPDX-License-Identifier: MIT | Copyright (c) 2025 Van Nguyen | github.com/vannt-dev/network-overrides-devtools */
/// <reference types="chrome" />
/// <reference path="./shared.ts" />
/// <reference path="./utils.ts" />
/// <reference path="./rule-values.ts" />

// The pinned @types/chrome version predates the storage.session API;
// augment it locally rather than upgrading the whole type package.
declare namespace chrome.storage {
  export const session: StorageArea;
}

namespace NetworkOverridesTabState {
  type OverrideRule = NetworkOverridesShared.OverrideRule;
  type ApiEntry = NetworkOverridesShared.ApiEntry;
  type ThrottlePreset = NetworkOverridesShared.ThrottlePreset;
  type RuleHit = NetworkOverridesShared.RuleHit;

  export interface TabStateStats {
    totalOverridden: number;
    totalFailed: number;
  }

  export interface TabState {
    enabled: boolean;
    origin: string;
    overrides: OverrideRule[];
    // {{name}} values the rules are filled with: site variables over global ones.
    variables: NetworkOverridesUtils.Variables;
    attached: boolean;
    attachError?: string;
    recentApis: Map<string, ApiEntry>;
    recentApiBodies: Map<string, string>;
    stats: TabStateStats;
    // Times each rule was applied, by NetworkOverridesUtils.ruleHitKeys key.
    ruleHits: Map<string, RuleHit>;
    throttlePreset: ThrottlePreset;
  }

  // Runtime-only artifacts: never mirrored to storage.
  export interface TabRuntime {
    persistTimer: ReturnType<typeof setTimeout> | null;
    subscriberPorts: Set<chrome.runtime.Port>;
    broadcastQueue: Map<string, ApiEntry>;
    broadcastTimer: ReturnType<typeof setTimeout> | null;
    ruleHitsTimer: ReturnType<typeof setTimeout> | null;
    attachPromise: Promise<void> | null;
    wsScriptId: string | undefined; // current Page.addScriptToEvaluateOnNewDocument id
    wsBindingReady: boolean; // Runtime.addBinding done in this debugger session
    wsPageTouched: boolean; // a wrapper with rules may be live in the page, from any session
    wsSync: Promise<void>; // serialises WebSocket rule syncs
  }

  export const RECENT_APIS_LIMIT = 500;
  export const RECENT_API_BODIES_LIMIT = 100;
  export const PERSIST_DEBOUNCE_MS = 500;
  /** Open panels hear about new rule hits at most this often. */
  export const RULE_HITS_BROADCAST_MS = 250;
  export const RULE_HIT_URL_LIMIT = 300;
  /** Hits of rules that no longer exist are dropped once this many keys pile up. */
  export const RULE_HITS_LIMIT = 500;

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
        variables: {},
        attached: false,
        recentApis: new Map(),
        recentApiBodies: new Map(),
        stats: { totalOverridden: 0, totalFailed: 0 },
        ruleHits: new Map(),
        throttlePreset: 'none',
      };
      states.set(tabId, state);
    }
    return state;
  }

  export function recordOverrideStat(tabId: number, isFail = false, count = 1): void {
    const state = ensure(tabId);
    if (isFail) {
      state.stats.totalFailed += count;
    } else {
      state.stats.totalOverridden += count;
    }
    schedulePersist(tabId);
    runtime(tabId).subscriberPorts.forEach(port => {
      try {
        port.postMessage({ type: 'stats', stats: { ...state.stats } });
      } catch {}
    });
  }

  // Keys are worked out once per rules array, never per request: the array is
  // replaced as a whole whenever the rules change.
  const ruleHitKeyCache = new WeakMap<OverrideRule[], Map<OverrideRule, string>>();

  function ruleHitKeyMap(overrides: OverrideRule[]): Map<OverrideRule, string> {
    let keys = ruleHitKeyCache.get(overrides);
    if (!keys) {
      const list = NetworkOverridesUtils.ruleHitKeys(overrides);
      keys = new Map(overrides.map((rule, index) => [rule, list[index]]));
      ruleHitKeyCache.set(overrides, keys);
    }
    return keys;
  }

  /** The counting key of a rule that is in the tab's current rules. */
  export function ruleHitKey(tabId: number, rule: OverrideRule): string | undefined {
    const state = states.get(tabId);
    return state ? ruleHitKeyMap(state.overrides).get(rule) : undefined;
  }

  export function ruleHitsSnapshot(tabId: number): Record<string, RuleHit> {
    const state = states.get(tabId);
    return state ? Object.fromEntries(state.ruleHits.entries()) : {};
  }

  function broadcastRuleHits(tabId: number): void {
    const hits = ruleHitsSnapshot(tabId);
    runtime(tabId).subscriberPorts.forEach(port => {
      try {
        port.postMessage({ type: 'ruleHits', hits });
      } catch {}
    });
  }

  /**
   * Counts one application of a rule (or `count` of them). Called when the
   * rule changes a request for real, not when it merely matched.
   */
  export function recordRuleHit(
    tabId: number,
    key: string | undefined,
    url?: string,
    count = 1
  ): void {
    const state = states.get(tabId);
    if (!state || key === undefined) return;
    const hit = state.ruleHits.get(key);
    const lastUrl = typeof url === 'string' ? url.slice(0, RULE_HIT_URL_LIMIT) : undefined;
    if (hit) {
      hit.count += count;
      hit.lastAt = Date.now();
      hit.lastUrl = lastUrl;
    } else {
      state.ruleHits.set(key, { count, lastAt: Date.now(), lastUrl });
    }
    schedulePersist(tabId);
    const rt = runtime(tabId);
    if (rt.ruleHitsTimer || rt.subscriberPorts.size === 0) return;
    rt.ruleHitsTimer = setTimeout(() => {
      rt.ruleHitsTimer = null;
      broadcastRuleHits(tabId);
    }, RULE_HITS_BROADCAST_MS);
  }

  /** Sets every count of the tab back to zero and tells the open panels. */
  export function resetRuleHits(tabId: number): void {
    const state = states.get(tabId);
    if (!state) return;
    state.ruleHits.clear();
    schedulePersist(tabId);
    broadcastRuleHits(tabId);
  }

  /**
   * Warms the keys of new rules, off the request path. Every edit leaves the
   * old key behind, so past a limit the keys of rules that are gone go too.
   */
  export function rulesChanged(tabId: number): void {
    const state = states.get(tabId);
    if (!state) return;
    const keys = ruleHitKeyMap(state.overrides);
    if (state.ruleHits.size <= RULE_HITS_LIMIT) return;
    const live = new Set(keys.values());
    for (const key of Array.from(state.ruleHits.keys())) {
      if (!live.has(key)) state.ruleHits.delete(key);
    }
  }

  export function runtime(tabId: number): TabRuntime {
    let rt = runtimes.get(tabId);
    if (!rt) {
      rt = {
        persistTimer: null,
        subscriberPorts: new Set(),
        broadcastQueue: new Map(),
        broadcastTimer: null,
        ruleHitsTimer: null,
        attachPromise: null,
        wsScriptId: undefined,
        wsBindingReady: false,
        wsPageTouched: false,
        wsSync: Promise.resolve(),
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
      variables: state.variables,
      attached: state.attached,
      attachError: state.attachError,
      recentApis: Object.fromEntries(state.recentApis.entries()),
      recentApiBodies: Object.fromEntries(state.recentApiBodies.entries()),
      stats: state.stats,
      ruleHits: Object.fromEntries(state.ruleHits.entries()),
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
      if (rt.ruleHitsTimer) clearTimeout(rt.ruleHitsTimer);
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
      state.variables = NetworkOverridesUtils.variablesFrom(raw.variables);
      // Hit keys are worked out here, not while the first request waits.
      ruleHitKeyMap(state.overrides);
      // The debugger never survives a worker restart.
      state.attached = false;
      state.attachError = undefined;
      state.recentApis = new Map(Object.entries(raw.recentApis || {}));
      state.recentApiBodies = new Map(Object.entries(raw.recentApiBodies || {}));
      if (raw.stats && typeof raw.stats === 'object') {
        state.stats = {
          totalOverridden:
            typeof raw.stats.totalOverridden === 'number' ? raw.stats.totalOverridden : 0,
          totalFailed: typeof raw.stats.totalFailed === 'number' ? raw.stats.totalFailed : 0,
        };
      }
      if (raw.ruleHits && typeof raw.ruleHits === 'object') {
        for (const [key, hit] of Object.entries(raw.ruleHits as Record<string, any>)) {
          if (!hit || typeof hit.count !== 'number' || typeof hit.lastAt !== 'number') continue;
          state.ruleHits.set(key, {
            count: hit.count,
            lastAt: hit.lastAt,
            lastUrl: typeof hit.lastUrl === 'string' ? hit.lastUrl : undefined,
          });
        }
      }
      if (['none', 'fast3g', 'slow3g', 'offline'].includes(raw.throttlePreset)) {
        state.throttlePreset = raw.throttlePreset;
      }
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
