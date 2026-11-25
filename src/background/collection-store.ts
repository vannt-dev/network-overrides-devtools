/*! SPDX-License-Identifier: MIT | Copyright (c) 2025 Van Nguyen | github.com/vannt-dev/network-overrides-devtools */
/// <reference types="chrome" />
/// <reference path="../shared.ts" />
/// <reference path="../rule-values.ts" />
/// <reference path="../collection.ts" />
/// <reference path="../tab-state.ts" />

namespace NetworkOverridesBackground {
  import TabState = NetworkOverridesTabState;
  import Collection = NetworkOverridesCollection;

  type OverrideRule = NetworkOverridesShared.OverrideRule;

  /** The first collection rule of a tab with this pattern. */
  export function collectionRuleOf(tabId: number, pattern: string): OverrideRule | null {
    const rules = TabState.get(tabId)?.overrides || [];
    return rules.find(rule => rule.mode === 'collection' && rule.pattern === pattern) || null;
  }

  /**
   * The list a collection rule answers from: the one held for the tab, or a
   * new one from the rule's seed when there is none yet or the seed, id field
   * or id type changed. `{{...}}` placeholders in the seed are filled once,
   * when it is read.
   */
  export function collectionStore(
    tabId: number,
    rule: OverrideRule,
    url = '',
    fresh = false
  ): { store: Collection.Store } | { error: string } {
    const state = TabState.ensure(tabId);
    const seed = Collection.signature(rule);
    const held = state.collections.get(rule.pattern);
    if (held && held.seed === seed && !fresh) return { store: held };
    const text = NetworkOverridesUtils.fillBodyText(
      rule.body || '',
      state.variables,
      rule.processTemplates !== false,
      [],
      url
    );
    const parsed = Collection.parseItems(text);
    if ('error' in parsed) {
      return {
        error: `The seed data of this collection is not a JSON array of objects: ${parsed.error}`,
      };
    }
    const store = Collection.createStore(parsed.items, Collection.idFieldOf(rule), seed);
    state.collections.set(rule.pattern, store);
    TabState.schedulePersist(tabId);
    return { store };
  }

  /** Replaces the items of a collection by hand, as the rule editor does. */
  export function setCollectionItems(
    tabId: number,
    rule: OverrideRule,
    items: Collection.Item[]
  ): { store: Collection.Store } | { error: string } {
    const current = collectionStore(tabId, rule);
    if ('error' in current) return current;
    if (JSON.stringify(items).length > Collection.MAX_STORE_CHARS) {
      return { error: 'The data is too large for a collection' };
    }
    const store = Collection.replaceItems(current.store, items, Collection.idFieldOf(rule));
    TabState.ensure(tabId).collections.set(rule.pattern, store);
    TabState.schedulePersist(tabId);
    return { store };
  }

  /** The answer of a collection rule to a request, changing its list when the request does. */
  export function answerCollectionRequest(
    tabId: number,
    rule: OverrideRule,
    request: { method: string; url: string; body?: string },
    pattern: string
  ): Collection.Answer {
    const where = Collection.route(pattern, request.url);
    const current = collectionStore(tabId, rule, request.url);
    if ('error' in current) {
      return {
        status: 500,
        body: { error: current.error },
        headers: [{ name: 'Content-Type', value: 'application/json; charset=utf-8' }],
      };
    }
    const answer = Collection.handle(current.store, request, where || {}, {
      idField: Collection.idFieldOf(rule),
      idType: Collection.idTypeOf(rule),
      newUuid: () => crypto.randomUUID(),
    });
    if (answer.store) {
      TabState.ensure(tabId).collections.set(rule.pattern, answer.store);
      TabState.schedulePersist(tabId);
    }
    return answer;
  }
}
