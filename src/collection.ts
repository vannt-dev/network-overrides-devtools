/*! SPDX-License-Identifier: MIT | Copyright (c) 2025 Van Nguyen | github.com/vannt-dev/network-overrides-devtools */
/// <reference path="./shared.ts" />
/// <reference path="./utils.ts" />

/**
 * A collection rule answers a small REST API from a list held for the
 * session: GET the list or one item, POST to add, PUT to replace, PATCH to
 * merge, DELETE to remove. Everything here is pure: the background keeps the
 * stores, these functions route a request and work out the answer.
 */
namespace NetworkOverridesCollection {
  type OverrideRule = NetworkOverridesShared.OverrideRule;
  type FetchHeader = NetworkOverridesShared.FetchHeader;
  export type IdType = NetworkOverridesShared.CollectionIdType;
  export type Item = Record<string, unknown>;

  export const DEFAULT_ID_FIELD = 'id';
  /** A store larger than this (as JSON text) refuses changes that would grow it. */
  export const MAX_STORE_CHARS = 1024 * 1024;

  /** The list a collection rule answers from, and where it came from. */
  export interface Store {
    seed: string; // signature() of the rule the store was seeded from
    items: Item[];
    nextId: number; // the next number id; never reused after a delete
  }

  /** Where a request goes in a collection: the list, or one item of it. */
  export interface Route {
    id?: string;
  }

  export interface Answer {
    status: number;
    body?: unknown; // JSON value; undefined = no body
    headers: FetchHeader[];
    store?: Store; // the store after the change; undefined = unchanged
  }

  export function idFieldOf(rule: OverrideRule): string {
    const field = typeof rule.collectionIdField === 'string' ? rule.collectionIdField.trim() : '';
    return field || DEFAULT_ID_FIELD;
  }

  export function idTypeOf(rule: OverrideRule): IdType {
    return rule.collectionIdType === 'uuid' ? 'uuid' : 'number';
  }

  /** What a store is built from: a change to any of it starts over from the seed. */
  export function signature(rule: OverrideRule): string {
    return JSON.stringify([
      rule.body || '',
      idFieldOf(rule),
      idTypeOf(rule),
      rule.processTemplates !== false,
    ]);
  }

  function isItem(value: unknown): value is Item {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  /** A JSON array of objects (blank is an empty list), or why the text is not one. */
  export function parseItems(text: string): { items: Item[] } | { error: string } {
    if (typeof text !== 'string' || !text.trim()) return { items: [] };
    let parsed: unknown;
    try {
      parsed = JSON.parse(text.replace(/^\uFEFF/, ''));
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
    if (!Array.isArray(parsed)) return { error: 'not a JSON array' };
    const bad = parsed.findIndex(item => !isItem(item));
    if (bad >= 0) return { error: `item ${bad + 1} is not a JSON object` };
    return { items: parsed as Item[] };
  }

  function numericId(value: unknown): number | null {
    const number = typeof value === 'number' ? value : typeof value === 'string' ? +value : NaN;
    return Number.isSafeInteger(number) && String(value).trim() !== '' ? number : null;
  }

  /** The number after the largest whole-number id in the items, and at least `floor`. */
  export function nextIdAfter(items: Item[], idField: string, floor = 1): number {
    let next = floor;
    for (const item of items) {
      const id = numericId(item[idField]);
      if (id !== null && id >= next) next = id + 1;
    }
    return next;
  }

  export function createStore(items: Item[], idField: string, seed: string): Store {
    return { seed, items, nextId: nextIdAfter(items, idField) };
  }

  /** The address without query, fragment or trailing slash. */
  function pathOf(url: string): string {
    return url.split(/[?#]/)[0].replace(/\/+$/, '');
  }

  /**
   * Routes a request to the collection at `pattern`: the list itself, or one
   * item below it (`/api/todos/5`). Anything deeper does not match. A plain
   * pattern is the collection's address or its end (`/api/todos`); a `*`
   * pattern or a /regex/ must match the list address.
   */
  export function route(pattern: string, url: string): Route | null {
    const trimmed = pattern.trim();
    const plain =
      !NetworkOverridesUtils.isRegexPattern(trimmed) &&
      !trimmed.includes('*') &&
      trimmed.toLowerCase() !== 'all';
    const base = pathOf(trimmed);
    if (plain && !base) return null;
    const matches = (candidate: string) =>
      plain
        ? candidate.endsWith(base)
        : NetworkOverridesUtils.matchPattern(trimmed, candidate) !== null;
    const path = pathOf(url);
    const slash = path.lastIndexOf('/');
    if (slash > 0 && path[slash - 1] !== '/') {
      const segment = path.slice(slash + 1);
      if (segment && matches(path.slice(0, slash))) {
        let id = segment;
        try {
          id = decodeURIComponent(segment);
        } catch {}
        return { id };
      }
    }
    return matches(path) ? {} : null;
  }

  /**
   * Whether a rule matches a request address, and the `*` captures: a
   * collection rule matches its list and items, any other rule its pattern.
   */
  export function matchRule(rule: OverrideRule, pattern: string, url: string): string[] | null {
    if (rule.mode === 'collection') return route(pattern, url) ? [] : null;
    return NetworkOverridesUtils.matchPattern(pattern, url);
  }

  function json(status: number, body: unknown, headers: FetchHeader[] = []): Answer {
    return {
      status,
      body,
      headers: [{ name: 'Content-Type', value: 'application/json; charset=utf-8' }, ...headers],
    };
  }

  function error(status: number, message: string, headers: FetchHeader[] = []): Answer {
    return json(status, { error: message }, headers);
  }

  function notAllowed(allow: string): Answer {
    return error(405, 'Method not allowed', [{ name: 'Allow', value: allow }]);
  }

  const LIST_METHODS = 'GET, HEAD, POST, OPTIONS';
  const ITEM_METHODS = 'GET, HEAD, PUT, PATCH, DELETE, OPTIONS';

  function readObject(body: string | undefined): Item | null {
    if (typeof body !== 'string' || !body.trim()) return null;
    try {
      const parsed = JSON.parse(body);
      return isItem(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  /** `?field=value` filters (all must hold), then `_page` and `_limit`. */
  function listItems(items: Item[], url: string): { items: Item[]; total: number } {
    let query: URLSearchParams;
    try {
      query = new URL(url).searchParams;
    } catch {
      query = new URLSearchParams(url.includes('?') ? url.split('?')[1].split('#')[0] : '');
    }
    let filtered = items;
    query.forEach((value, name) => {
      if (name.startsWith('_')) return;
      filtered = filtered.filter(item => name in item && String(item[name]) === value);
    });
    const total = filtered.length;
    const limit = Number(query.get('_limit'));
    if (Number.isInteger(limit) && limit > 0) {
      const page = Number(query.get('_page'));
      const start = (Number.isInteger(page) && page > 1 ? page - 1 : 0) * limit;
      filtered = filtered.slice(start, start + limit);
    }
    return { items: filtered, total };
  }

  function withChange(store: Store, items: Item[], nextId: number, answer: Answer): Answer {
    if (JSON.stringify(items).length > MAX_STORE_CHARS) {
      return error(413, 'The collection is full: remove items or reset it to its seed');
    }
    return { ...answer, store: { seed: store.seed, items, nextId } };
  }

  export interface Request {
    method: string;
    url: string;
    body?: string;
  }

  export interface Options {
    idField: string;
    idType: IdType;
    newUuid: () => string;
  }

  /** The answer to one request, and the store after it when the request changed it. */
  export function handle(store: Store, request: Request, where: Route, options: Options): Answer {
    const method = String(request.method || 'GET').toUpperCase();
    const { idField } = options;
    const allow = where.id === undefined ? LIST_METHODS : ITEM_METHODS;
    if (method === 'OPTIONS') return { status: 204, headers: [{ name: 'Allow', value: allow }] };
    const read = method === 'GET' || method === 'HEAD';

    if (where.id === undefined) {
      if (read) {
        const { items, total } = listItems(store.items, request.url);
        return json(200, method === 'HEAD' ? undefined : items, [
          { name: 'X-Total-Count', value: String(total) },
        ]);
      }
      if (method !== 'POST') return notAllowed(allow);
      const input = readObject(request.body);
      if (!input) return error(400, 'The request body must be a JSON object');
      const item: Item = { ...input };
      let nextId = store.nextId;
      const given = item[idField];
      if (given === undefined || given === null || given === '') {
        if (options.idType === 'uuid') {
          item[idField] = options.newUuid();
        } else {
          item[idField] = nextId;
          nextId += 1;
        }
      } else {
        if (store.items.some(existing => String(existing[idField]) === String(given))) {
          return error(409, `An item with ${idField} ${String(given)} already exists`);
        }
        nextId = nextIdAfter([item], idField, nextId);
      }
      return withChange(store, [...store.items, item], nextId, json(201, item));
    }

    const index = store.items.findIndex(item => String(item[idField]) === where.id);
    if (method === 'POST') return notAllowed(allow);
    if (!read && !['PUT', 'PATCH', 'DELETE'].includes(method)) return notAllowed(allow);
    if (index < 0) return error(404, 'Not found');
    const current = store.items[index];
    if (read) return json(200, method === 'HEAD' ? undefined : current);
    if (method === 'DELETE') {
      const items = store.items.filter((_, i) => i !== index);
      return withChange(store, items, store.nextId, { status: 204, headers: [] });
    }
    const input = readObject(request.body);
    if (!input) return error(400, 'The request body must be a JSON object');
    // The item keeps the id it is addressed by, whatever the body says.
    const next: Item =
      method === 'PUT'
        ? { ...input, [idField]: current[idField] }
        : { ...current, ...input, [idField]: current[idField] };
    const items = store.items.map((item, i) => (i === index ? next : item));
    return withChange(store, items, store.nextId, json(200, next));
  }

  /** The store after its items were replaced by hand: ids already given stay used. */
  export function replaceItems(store: Store, items: Item[], idField: string): Store {
    return { seed: store.seed, items, nextId: nextIdAfter(items, idField, store.nextId) };
  }
}
