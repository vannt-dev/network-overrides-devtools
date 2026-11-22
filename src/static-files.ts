/*! SPDX-License-Identifier: MIT | Copyright (c) 2025 Van Nguyen | github.com/vannt-dev/network-overrides-devtools */
/// <reference path="./utils.ts" />

// Helpers for rules that replace a static file a page loads, and for rules
// that inject a script or a stylesheet into a page. They work on text only and
// are shared by the background (which rewrites responses) and the editor.
namespace NetworkOverridesUtils {
  const CONTENT_TYPES: Record<string, string> = {
    js: 'text/javascript; charset=utf-8',
    mjs: 'text/javascript; charset=utf-8',
    cjs: 'text/javascript; charset=utf-8',
    css: 'text/css; charset=utf-8',
    html: 'text/html; charset=utf-8',
    htm: 'text/html; charset=utf-8',
    json: 'application/json; charset=utf-8',
    map: 'application/json; charset=utf-8',
    txt: 'text/plain; charset=utf-8',
    xml: 'application/xml; charset=utf-8',
    svg: 'image/svg+xml',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    avif: 'image/avif',
    ico: 'image/x-icon',
    bmp: 'image/bmp',
    woff: 'font/woff',
    woff2: 'font/woff2',
    ttf: 'font/ttf',
    otf: 'font/otf',
    wasm: 'application/wasm',
  };

  /**
   * The Content-Type a file is usually served with, from the extension of a
   * URL or URL pattern (`*\/app.js`, `https://a.test/logo.png?v=2`), or
   * undefined when the extension is unknown or there is none.
   */
  export function guessContentType(urlOrPattern: string): string | undefined {
    const text = String(urlOrPattern || '').trim();
    if (!text || isRegexPattern(text)) return undefined;
    const path = text.split(/[?#]/)[0];
    const name = path.slice(path.lastIndexOf('/') + 1);
    const dot = name.lastIndexOf('.');
    if (dot < 0) return undefined;
    const extension = name.slice(dot + 1).toLowerCase();
    return Object.prototype.hasOwnProperty.call(CONTENT_TYPES, extension)
      ? CONTENT_TYPES[extension]
      : undefined;
  }

  /** Whether a file of this type is text that can be edited in the editor. */
  export function isTextContentType(contentType: string | undefined): boolean {
    const type = String(contentType || '')
      .split(';')[0]
      .trim()
      .toLowerCase();
    if (!type) return false;
    return (
      type.startsWith('text/') ||
      type.endsWith('+json') ||
      type.endsWith('+xml') ||
      ['application/json', 'application/javascript', 'application/xml'].includes(type)
    );
  }

  /** Whether a rule injects a script or a stylesheet into pages. */
  export function isInjectRule(rule: { kind?: string } | null | undefined): boolean {
    return rule?.kind === 'inject';
  }

  /** The index of the last match of a global regular expression, or -1. */
  function lastMatchIndex(text: string, pattern: RegExp): number {
    let index = -1;
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      index = match.index;
      if (match[0] === '') pattern.lastIndex++;
    }
    return index;
  }

  function firstMatchEnd(text: string, pattern: RegExp): number {
    const match = pattern.exec(text);
    return match ? match.index + match[0].length : -1;
  }

  function insertAt(text: string, index: number, insert: string): string {
    return text.slice(0, index) + insert + text.slice(index);
  }

  /**
   * Adds a stylesheet at the end of `<head>` and a script at the end of
   * `<body>`. A page without those tags still gets both: the style before the
   * body (or after the doctype, so the page keeps its rendering mode) and the
   * script at the very end. The code cannot close its own tag early.
   */
  export function injectIntoHtml(html: string, code: { script?: string; style?: string }): string {
    let out = String(html);
    const style = code.style && code.style.trim() ? code.style : '';
    const script = code.script && code.script.trim() ? code.script : '';
    if (style) {
      const tag = `<style data-network-overrides>${style.replace(/<\/(style)/gi, '<\\/$1')}</style>`;
      let index = lastMatchIndex(out, /<\/head\s*>/gi);
      if (index < 0) {
        const body = /<body[\s>]/i.exec(out);
        if (body) index = body.index;
      }
      if (index < 0) index = Math.max(firstMatchEnd(out, /<html[^>]*>/i), 0);
      if (index === 0) index = Math.max(firstMatchEnd(out, /^\uFEFF?\s*<!doctype[^>]*>/i), 0);
      out = insertAt(out, index, tag);
    }
    if (script) {
      const tag = `<script data-network-overrides>${script.replace(/<\/(script)/gi, '<\\/$1')}</script>`;
      let index = lastMatchIndex(out, /<\/body\s*>/gi);
      if (index < 0) index = lastMatchIndex(out, /<\/html\s*>/gi);
      if (index < 0) index = out.length;
      out = insertAt(out, index, tag);
    }
    return out;
  }

  /** The value of one attribute of a tag, without its quotes. */
  function attributeOf(tag: string, name: string): string | undefined {
    const match = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i').exec(
      tag
    );
    if (!match) return undefined;
    return match[2] ?? match[3] ?? match[4] ?? '';
  }

  const META_TAG = /<meta\b[^>]*>/gi;

  function isCspMeta(tag: string): boolean {
    return (
      (attributeOf(tag, 'http-equiv') || '').trim().toLowerCase() === 'content-security-policy'
    );
  }

  /** The policies of the page's `<meta http-equiv="Content-Security-Policy">` tags. */
  export function cspMetaPolicies(html: string): string[] {
    return (String(html).match(META_TAG) || [])
      .filter(isCspMeta)
      .map(tag => attributeOf(tag, 'content') || '');
  }

  /** The page without its `<meta http-equiv="Content-Security-Policy">` tags. */
  export function removeCspMeta(html: string): string {
    return String(html).replace(META_TAG, tag => (isCspMeta(tag) ? '' : tag));
  }

  /**
   * Whether any of these Content-Security-Policy values stops an inline
   * `<script>` or `<style>` element from running. A nonce, a hash or
   * 'strict-dynamic' turns 'unsafe-inline' off, as browsers do.
   */
  export function cspBlocksInline(policies: string[], kind: 'script' | 'style'): boolean {
    const order = [`${kind}-src-elem`, `${kind}-src`, 'default-src'];
    return policies
      .flatMap(value => String(value).split(','))
      .some(policy => {
        const directives = new Map<string, string[]>();
        for (const part of policy.split(';')) {
          const [name, ...sources] = part.trim().toLowerCase().split(/\s+/);
          if (name && !directives.has(name)) directives.set(name, sources);
        }
        const name = order.find(candidate => directives.has(candidate));
        if (!name) return false;
        const sources = directives.get(name) || [];
        const turnsInlineOff = sources.some(
          source =>
            source.startsWith("'nonce-") ||
            /^'sha(256|384|512)-/.test(source) ||
            source === "'strict-dynamic'"
        );
        return turnsInlineOff || !sources.includes("'unsafe-inline'");
      });
  }
}
