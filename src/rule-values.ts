/*! SPDX-License-Identifier: MIT | Copyright (c) 2025 Van Nguyen | github.com/vannt-dev/network-overrides-devtools */
/// <reference path="./shared.ts" />
/// <reference path="./utils.ts" />

// Values a rule is filled with when it applies: user-defined variables, the
// response headers it removes and, for a rule with several answers, which one
// it gives. Shared by the background (which applies rules) and the editor.
namespace NetworkOverridesUtils {
  type FetchHeader = NetworkOverridesShared.FetchHeader;
  type OverrideRule = NetworkOverridesShared.OverrideRule;
  type RuleVariable = NetworkOverridesShared.RuleVariable;

  /** Variable values by name, site values over global ones. */
  export type Variables = Record<string, string>;

  /** Storage key of the variables every site shares. */
  export const GLOBAL_VARIABLES_KEY = 'variables_global';

  /** A letter or `_` first, then letters, digits, `_`, `.` or `-`. */
  const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_.-]*$/;
  const VARIABLE_TOKEN = /\{\{([A-Za-z_][A-Za-z0-9_.-]*)\}\}/g;

  /** Names the built-in placeholders use; a variable cannot take them. */
  export const RESERVED_VARIABLE_NAMES = ['now', 'timestamp', 'epoch', 'uuid'];

  /** Why a name cannot be a variable, or null when it can. */
  export function variableNameError(name: string): 'invalid' | 'reserved' | null {
    if (!VARIABLE_NAME.test(name)) return 'invalid';
    // The built-in placeholders ignore case, so `{{NOW}}` is taken as well.
    if (RESERVED_VARIABLE_NAMES.includes(name.toLowerCase())) return 'reserved';
    return null;
  }

  /** The valid `{ name, value }` entries of a stored list; anything else is dropped. */
  export function cleanVariables(list: unknown): RuleVariable[] {
    if (!Array.isArray(list)) return [];
    return list
      .filter(
        entry =>
          !!entry &&
          typeof entry.name === 'string' &&
          typeof entry.value === 'string' &&
          variableNameError(entry.name) === null
      )
      .map(entry => ({ name: entry.name, value: entry.value }));
  }

  /** One lookup table from both lists: a site variable wins over a global one of the same name. */
  export function mergeVariables(globalList: unknown, siteList: unknown): Variables {
    const entries: Array<[string, string]> = [];
    for (const entry of cleanVariables(globalList)) entries.push([entry.name, entry.value]);
    for (const entry of cleanVariables(siteList)) entries.push([entry.name, entry.value]);
    // fromEntries defines own properties, so a name such as __proto__ stays a plain key.
    return Object.fromEntries(entries);
  }

  /** The variables a message carries, keeping only string values under valid names. */
  export function variablesFrom(value: unknown): Variables {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).filter(
        ([name, entry]) => typeof entry === 'string' && variableNameError(name) === null
      )
    ) as Variables;
  }

  // `\{{` keeps `{{` as typed. It is held as a private-use character while the
  // variables and the built-in placeholders are filled in, then put back.
  const ESCAPED_BRACES = '';

  function protectEscapes(text: string): string {
    return text.replace(/\\\{\{/g, ESCAPED_BRACES);
  }

  function restoreEscapes(text: string): string {
    return text.replace(//g, '{{');
  }

  function fillNamed(text: string, variables: Variables): string {
    return text.replace(VARIABLE_TOKEN, (token, name: string) =>
      Object.prototype.hasOwnProperty.call(variables, name) ? variables[name] : token
    );
  }

  /**
   * Puts each `{{name}}` of a defined variable in its place; a name nobody
   * defined is left as written. Values go in as they are, once: a value that
   * holds `{{...}}` is not filled in again. `\{{name}}` gives `{{name}}`.
   */
  export function fillVariables(text: string, variables: Variables): string {
    if (typeof text !== 'string' || !text.includes('{{')) return text;
    return restoreEscapes(fillNamed(protectEscapes(text), variables));
  }

  /**
   * A response body with its variables, then the built-in placeholders
   * (`{{$uuid}}`, `{{param:1}}`, ...) filled in. With `templates` off the
   * body is sent exactly as written.
   */
  export function fillBodyText(
    body: string,
    variables: Variables,
    templates: boolean,
    captures: string[] = [],
    requestUrl = ''
  ): string {
    if (!templates || typeof body !== 'string' || !body.includes('{{')) return body;
    const named = fillNamed(protectEscapes(body), variables);
    return restoreEscapes(processResponseTemplate(named, captures, requestUrl));
  }

  /** Headers with their values' variables filled in. */
  export function fillHeaderValues(
    headers: FetchHeader[] | undefined,
    variables: Variables
  ): FetchHeader[] | undefined {
    if (!Array.isArray(headers)) return headers;
    return headers.map(header =>
      header && typeof header.value === 'string'
        ? { name: header.name, value: fillVariables(header.value, variables) }
        : header
    );
  }

  /** The pattern a rule matches with, after its variables are filled in. */
  export function rulePattern(rule: OverrideRule, variables: Variables): string {
    return fillVariables(rule.pattern, variables);
  }

  // ---- removed response headers ------------------------------------------------

  const HEADER_NAME = /^[!#$%&'+.^_`|~0-9A-Za-z-]+\*?$/;

  /**
   * The header names typed in the editor, one per line or separated by
   * commas, lower-cased and without repeats. A trailing `*` stands for any
   * ending (`x-debug-*`). Returns the first bad name when there is one.
   */
  export function parseHeaderNames(text: string): { names: string[] } | { error: string } {
    const names: string[] = [];
    for (const part of String(text || '').split(/[\n,]/)) {
      const name = part.trim().toLowerCase();
      if (!name) continue;
      if (!HEADER_NAME.test(name) || name === '*') return { error: part.trim() };
      if (!names.includes(name)) names.push(name);
    }
    return { names };
  }

  /** Whether a header name is one of `names` (a name ending in `*` matches by prefix). */
  export function headerNameListed(name: string, names: string[] | undefined): boolean {
    if (!Array.isArray(names) || names.length === 0) return false;
    const lower = String(name).toLowerCase().trim();
    return names.some(entry => {
      const wanted = String(entry).toLowerCase().trim();
      return wanted.endsWith('*') ? lower.startsWith(wanted.slice(0, -1)) : lower === wanted;
    });
  }

  /** The headers that are not named in `names`. */
  export function withoutHeaders(
    headers: FetchHeader[],
    names: string[] | undefined
  ): FetchHeader[] {
    if (!Array.isArray(names) || names.length === 0) return headers;
    return headers.filter(header => !headerNameListed(header.name, names));
  }

  // ---- weighted random responses ----------------------------------------------

  export const MAX_RESPONSE_WEIGHT = 1000;
  export const MAX_RANDOM_SEED = 0xffffffff;

  /** Whether a rule answers with one of several responses. */
  export function hasResponseVariants(rule: OverrideRule): boolean {
    return (
      Array.isArray(rule.responses) &&
      rule.responses.length > 0 &&
      (rule.mode === 'text' || rule.mode === 'file')
    );
  }

  /** The weight of each answer: the rule's own first, then its other responses. */
  export function responseWeights(rule: OverrideRule): number[] {
    const weightOf = (value: unknown, fallback: number) =>
      typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
    return [
      weightOf(rule.weight, 1),
      ...(rule.responses || []).map(variant => weightOf(variant?.weight, 0)),
    ];
  }

  /**
   * The index picked for a number in [0, 1): each index takes a share of the
   * range as large as its weight. With every weight 0 the first one is used.
   */
  export function pickWeighted(weights: number[], random: number): number {
    const total = weights.reduce((sum, weight) => sum + (weight > 0 ? weight : 0), 0);
    if (total <= 0) return 0;
    let target = Math.min(Math.max(random, 0), 0.999999999) * total;
    for (let index = 0; index < weights.length; index++) {
      const weight = weights[index] > 0 ? weights[index] : 0;
      if (target < weight) return index;
      target -= weight;
    }
    return weights.length - 1;
  }

  /**
   * The number in [0, 1) at position `index` (0, 1, 2, ...) of the order a
   * seed gives (mulberry32). Its state only moves by a constant, so any
   * position is worked out directly, without the ones before it.
   */
  export function seededNumber(seed: number, index: number): number {
    let value = ((seed >>> 0) + Math.imul(index + 1, 0x6d2b79f5)) >>> 0;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }

  /** The numbers of a seed in order: the same seed gives the same numbers in [0, 1). */
  export function seededRandom(seed: number): () => number {
    let index = 0;
    return () => seededNumber(seed, index++);
  }
}
