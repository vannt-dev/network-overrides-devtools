/*! SPDX-License-Identifier: MIT | Copyright (c) 2025 Van Nguyen | github.com/vannt-dev/network-overrides-devtools */
/// <reference types="chrome" />

namespace NetworkOverridesUtils {
  export function isRegexPattern(pattern: string): boolean {
    if (!pattern.startsWith('/')) return false;
    const lastSlash = pattern.lastIndexOf('/');
    if (lastSlash <= 0) return false;
    return /^[dgimsuvy]*$/.test(pattern.slice(lastSlash + 1));
  }

  export function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  const regexCache = new Map<string, RegExp | null>();
  const MAX_REGEX_CACHE_SIZE = 500;

  function getCompiledRegex(key: string, compile: () => RegExp | null): RegExp | null {
    if (regexCache.has(key)) {
      return regexCache.get(key)!;
    }
    if (regexCache.size >= MAX_REGEX_CACHE_SIZE) {
      const keysToDelete = Array.from(regexCache.keys()).slice(0, 250);
      for (const k of keysToDelete) {
        regexCache.delete(k);
      }
    }
    const compiled = compile();
    regexCache.set(key, compiled);
    return compiled;
  }

  export function clearRegexCache(): void {
    regexCache.clear();
  }

  export function matchPattern(pattern: string, url: string): string[] | null {
    const trimmed = pattern.trim();
    if (trimmed === '*' || trimmed.toLowerCase() === 'all') {
      return [];
    }
    if (isRegexPattern(trimmed)) {
      const regex = getCompiledRegex('reg:' + trimmed, () => {
        const lastSlash = trimmed.lastIndexOf('/');
        const source = trimmed.slice(1, lastSlash);
        const flags = trimmed.slice(lastSlash + 1);
        try {
          return new RegExp(source, flags);
        } catch {
          return null;
        }
      });
      if (!regex) return null;
      regex.lastIndex = 0;
      return regex.test(url) ? [] : null;
    }
    if (trimmed.includes('*')) {
      const regex = getCompiledRegex('glob:' + trimmed, () => {
        const parts = trimmed.split('*').map(escapeRegex);
        try {
          return new RegExp('^' + parts.join('(.*)') + '$');
        } catch {
          return null;
        }
      });
      if (!regex) return null;
      regex.lastIndex = 0;
      const match = url.match(regex);
      return match ? match.slice(1) : null;
    }
    return url.includes(trimmed) ? [] : null;
  }

  export function patternMatches(pattern: string, url: string): boolean {
    return matchPattern(pattern, url) !== null;
  }

  export function substituteWildcards(template: string, captures: string[]): string {
    const parts = template.split('*');
    if (parts.length === 1) return template;
    let result = parts[0];
    for (let i = 1; i < parts.length; i++) {
      result += (i - 1 < captures.length ? captures[i - 1] : '*') + parts[i];
    }
    return result;
  }

  export function getOrigin(url: string): string {
    try {
      return new URL(url).origin;
    } catch {
      return '';
    }
  }

  export function matchesMethod(
    ruleMethod: string | undefined,
    requestMethod: string | undefined
  ): boolean {
    if (!ruleMethod || ruleMethod.toUpperCase() === 'ANY') return true;
    if (!requestMethod) return false;
    return ruleMethod.toUpperCase() === requestMethod.toUpperCase();
  }

  export function matchesGraphQLOperation(ruleOp?: string, postData?: string): boolean {
    if (!ruleOp || !ruleOp.trim()) return true;
    if (!postData || !postData.trim()) return false;
    const target = ruleOp.trim().toLowerCase();
    try {
      const parsed = JSON.parse(postData);
      if (
        typeof parsed.operationName === 'string' &&
        parsed.operationName.toLowerCase() === target
      ) {
        return true;
      }
      if (typeof parsed.query === 'string' && parsed.query.toLowerCase().includes(target)) {
        return true;
      }
    } catch {}
    return postData.toLowerCase().includes(target);
  }

  type MatchCondition = NetworkOverridesShared.MatchCondition;

  /** Decodes a query-string part the way URLSearchParams does (`+` is a space). */
  function decodeQueryPart(part: string): string {
    const spaced = part.replace(/\+/g, ' ');
    try {
      return decodeURIComponent(spaced);
    } catch {
      return spaced;
    }
  }

  /**
   * True when every query condition holds for the URL: a name alone needs the
   * parameter to be present, a name with a value needs one of its values to
   * equal it. Names are case-sensitive, as servers read them.
   */
  export function matchesQuery(conditions: MatchCondition[] | undefined, url: string): boolean {
    if (!Array.isArray(conditions) || conditions.length === 0) return true;
    let params: URLSearchParams;
    try {
      params = new URL(url).searchParams;
    } catch {
      return false;
    }
    return conditions.every(condition =>
      typeof condition.value === 'string'
        ? params.getAll(condition.name).includes(condition.value)
        : params.has(condition.name)
    );
  }

  /** Reads the request headers as a case-insensitive map from both shapes the extension sees. */
  function headerMap(headers: unknown): Map<string, string> {
    const map = new Map<string, string>();
    if (Array.isArray(headers)) {
      for (const header of headers) {
        if (header && typeof header.name === 'string') {
          map.set(header.name.toLowerCase(), String(header.value ?? ''));
        }
      }
    } else if (headers && typeof headers === 'object') {
      for (const [name, value] of Object.entries(headers as Record<string, unknown>)) {
        map.set(name.toLowerCase(), String(value ?? ''));
      }
    }
    return map;
  }

  /**
   * True when every header condition holds: names ignore case, a value must
   * equal the header's value exactly.
   */
  export function matchesHeaders(
    conditions: MatchCondition[] | undefined,
    headers: unknown
  ): boolean {
    if (!Array.isArray(conditions) || conditions.length === 0) return true;
    const map = headerMap(headers);
    return conditions.every(condition => {
      const actual = map.get(condition.name.trim().toLowerCase());
      if (actual === undefined) return false;
      return typeof condition.value === 'string' ? actual.trim() === condition.value.trim() : true;
    });
  }

  /** True when the request body contains the text; a request without a body never does. */
  export function matchesBody(contains: string | undefined, body: string | undefined): boolean {
    if (!contains) return true;
    if (typeof body !== 'string' || !body) return false;
    return body.includes(contains);
  }

  /** The query, header and body conditions of a rule, all of which must hold. */
  export function matchesRequestConditions(
    rule: NetworkOverridesShared.OverrideRule,
    request: { url: string; headers?: unknown; body?: string }
  ): boolean {
    return (
      matchesQuery(rule.matchQuery, request.url) &&
      matchesHeaders(rule.matchHeaders, request.headers) &&
      matchesBody(rule.matchBody, request.body)
    );
  }

  /** Reads `page=2&debug` into conditions; a part without `=` asks only for presence. */
  export function parseQueryConditions(text: string): MatchCondition[] {
    const conditions: MatchCondition[] = [];
    for (const raw of text.trim().replace(/^\?/, '').split('&')) {
      const part = raw.trim();
      if (!part) continue;
      const eq = part.indexOf('=');
      const name = decodeQueryPart(eq < 0 ? part : part.slice(0, eq)).trim();
      if (!name) continue;
      conditions.push(eq < 0 ? { name } : { name, value: decodeQueryPart(part.slice(eq + 1)) });
    }
    return conditions;
  }

  /** Writes conditions back as text that parseQueryConditions reads the same way. */
  export function formatQueryConditions(conditions: MatchCondition[] | undefined): string {
    const encode = (part: string) => part.replace(/[%&+#=]/g, c => encodeURIComponent(c));
    return (conditions || [])
      .map(c =>
        typeof c.value === 'string' ? `${encode(c.name)}=${encode(c.value)}` : encode(c.name)
      )
      .join('&');
  }

  /** Reads one `Name: value` or bare `Name` per line into header conditions. */
  export function parseHeaderConditions(text: string): MatchCondition[] {
    const conditions: MatchCondition[] = [];
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      const colon = line.indexOf(':');
      const name = (colon < 0 ? line : line.slice(0, colon)).trim();
      if (!name) continue;
      conditions.push(colon < 0 ? { name } : { name, value: line.slice(colon + 1).trim() });
    }
    return conditions;
  }

  export function formatHeaderConditions(conditions: MatchCondition[] | undefined): string {
    return (conditions || [])
      .map(c => (typeof c.value === 'string' ? `${c.name}: ${c.value}` : c.name))
      .join('\n');
  }

  type FetchHeader = { name: string; value: string };

  /** What a response script receives as `request`. */
  export interface ScriptRequest {
    url: string;
    method: string;
    headers: Record<string, string>;
    query: Record<string, string>;
    params: string[];
    body: string | null;
    response: { status: number | null; headers: Record<string, string>; body: string | null };
  }

  function headersToRecord(headers: unknown): Record<string, string> {
    const record: Record<string, string> = {};
    if (Array.isArray(headers)) {
      for (const header of headers) {
        if (header && typeof header.name === 'string') {
          record[header.name.toLowerCase()] = String(header.value ?? '');
        }
      }
    } else if (headers && typeof headers === 'object') {
      for (const [name, value] of Object.entries(headers as Record<string, unknown>)) {
        record[name.toLowerCase()] = String(value ?? '');
      }
    }
    return record;
  }

  export function buildScriptRequest(source: {
    url: string;
    method?: string;
    headers?: unknown;
    postData?: string;
    captures?: string[];
    responseStatus?: number;
    responseHeaders?: unknown;
    responseBody?: string | null;
  }): ScriptRequest {
    const query: Record<string, string> = {};
    try {
      new URL(source.url).searchParams.forEach((value, key) => {
        if (!(key in query)) query[key] = value;
      });
    } catch {}
    return {
      url: source.url,
      method: (source.method || 'GET').toUpperCase(),
      headers: headersToRecord(source.headers),
      query,
      params: Array.isArray(source.captures) ? [...source.captures] : [],
      body: typeof source.postData === 'string' ? source.postData : null,
      response: {
        status: typeof source.responseStatus === 'number' ? source.responseStatus : null,
        headers: headersToRecord(source.responseHeaders),
        body: typeof source.responseBody === 'string' ? source.responseBody : null,
      },
    };
  }

  /**
   * Wraps a rule's script as the body of an async function called with the
   * request. The newlines keep a trailing `//` comment in the script from
   * swallowing the closing brace.
   *
   * The result comes back as JSON text made in the page, read again by
   * `parseScriptEnvelope`: handed over as a value, the debugger protocol
   * returns an object's keys in alphabetical order, and a mocked body should
   * keep the order its author wrote.
   */
  export function buildResponseScriptExpression(script: string, request: ScriptRequest): string {
    return (
      `(async (request) => {\n${script}\n})(${JSON.stringify(request)})` +
      `.then((value) => JSON.stringify({ value }))`
    );
  }

  /** The value a script returned, or undefined when it returned nothing usable. */
  export function parseScriptEnvelope(raw: unknown): unknown {
    if (typeof raw !== 'string') return undefined;
    try {
      return (JSON.parse(raw) as { value?: unknown }).value;
    } catch {
      return undefined;
    }
  }

  function scriptHeaders(value: unknown): FetchHeader[] | null {
    if (value === undefined || value === null) return [];
    const headers: FetchHeader[] = [];
    const add = (name: unknown, headerValue: unknown): boolean => {
      if (typeof name !== 'string' || !name.trim()) return false;
      if (headerValue === undefined || headerValue === null || typeof headerValue === 'object') {
        return false;
      }
      headers.push({ name: name.trim(), value: String(headerValue) });
      return true;
    };
    if (Array.isArray(value)) {
      for (const header of value) {
        if (!header || typeof header !== 'object' || !add(header.name, header.value)) return null;
      }
      return headers;
    }
    if (typeof value !== 'object') return null;
    for (const [name, headerValue] of Object.entries(value as Record<string, unknown>)) {
      if (!add(name, headerValue)) return null;
    }
    return headers;
  }

  /**
   * Turns what a response script returned into a response.
   *
   * A string is the body. An object with a `body` key is a description of the
   * response: `{ status, headers, body }`, where a non-string body is sent as
   * JSON. Any other value is itself sent as JSON, so `return { ok: true }`
   * does what it looks like.
   */
  export function normalizeScriptResult(
    value: unknown
  ):
    | { ok: true; body: string; statusCode?: number; headers?: FetchHeader[] }
    | { ok: false; error: string } {
    if (value === undefined || value === null) {
      return {
        ok: false,
        error: 'The script returned nothing. Return a string or { status, headers, body }.',
      };
    }
    if (typeof value === 'string') return { ok: true, body: value };
    if (typeof value !== 'object' || Array.isArray(value)) {
      return { ok: true, body: JSON.stringify(value) };
    }

    const described = value as Record<string, unknown>;
    if (!Object.prototype.hasOwnProperty.call(described, 'body')) {
      return { ok: true, body: JSON.stringify(value) };
    }

    const result: { ok: true; body: string; statusCode?: number; headers?: FetchHeader[] } = {
      ok: true,
      body:
        typeof described.body === 'string'
          ? described.body
          : described.body === undefined || described.body === null
            ? ''
            : JSON.stringify(described.body),
    };
    if (described.status !== undefined && described.status !== null) {
      const status = described.status;
      if (typeof status !== 'number' || !Number.isInteger(status) || status < 100 || status > 599) {
        return { ok: false, error: 'The script returned a status that is not 100–599.' };
      }
      result.statusCode = status;
    }
    const headers = scriptHeaders(described.headers);
    if (headers === null) {
      return {
        ok: false,
        error: 'The script returned headers that are not a { name: value } object.',
      };
    }
    if (headers.length > 0) result.headers = headers;
    return result;
  }

  export function processResponseTemplate(
    body: string,
    captures: string[] = [],
    requestUrl: string = ''
  ): string {
    if (!body || !body.includes('{{')) return body;
    let result = body;
    result = result.replace(/\{\{(timestamp|now|\$timestamp|\$isoDate)\}\}/gi, () =>
      new Date().toISOString()
    );
    result = result.replace(/\{\{(epoch|\$epoch)\}\}/gi, () => String(Date.now()));
    result = result.replace(/\{\{(uuid|\$uuid|\$randomUUID)\}\}/gi, () => {
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      });
    });
    result = result.replace(/\{\{\$(randomEmail)\}\}/gi, () => {
      const rand = Math.floor(Math.random() * 100000);
      return `user_${rand}@example.com`;
    });
    result = result.replace(/\{\{\$(randomName)\}\}/gi, () => {
      const names = ['Alice', 'Bob', 'Charlie', 'David', 'Eva', 'Frank', 'Grace', 'Hannah'];
      const rand = names[Math.floor(Math.random() * names.length)];
      const num = Math.floor(Math.random() * 1000);
      return `${rand}_${num}`;
    });
    result = result.replace(
      /\{\{(?:randomInt:(\d+):(\d+)|\$randomInt\((\d+),\s*(\d+)\))\}\}/gi,
      (_, min1, max1, min2, max2) => {
        const min = parseInt(min1 || min2, 10);
        const max = parseInt(max1 || max2, 10);
        return String(Math.floor(Math.random() * (max - min + 1)) + min);
      }
    );
    result = result.replace(/\{\{\$(?:query|queryParam)\(([^)]+)\)\}\}/gi, (_, paramName) => {
      if (!requestUrl) return '';
      try {
        const urlObj = new URL(requestUrl);
        return urlObj.searchParams.get(paramName) || '';
      } catch {
        return '';
      }
    });
    result = result.replace(/\{\{param:(\d+)\}\}/gi, (_, indexStr) => {
      const idx = parseInt(indexStr, 10) - 1;
      return idx >= 0 && idx < captures.length ? captures[idx] : '';
    });
    return result;
  }
}
