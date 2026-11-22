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
   * The exact text that goes inside the injected `<script>` and `<style>`
   * elements ('' when there is none): the code cannot close its own tag
   * early, and line breaks are LF, as the HTML parser makes them, so a hash
   * of this text is the hash the browser checks against the page's CSP.
   */
  export function injectedCode(code: { script?: string; style?: string }): {
    script: string;
    style: string;
  } {
    const clean = (text: string | undefined, tag: string) =>
      text && text.trim()
        ? text.replace(/\r\n?/g, '\n').replace(new RegExp(`<\\/(${tag})`, 'gi'), '<\\/$1')
        : '';
    return { script: clean(code.script, 'script'), style: clean(code.style, 'style') };
  }

  /**
   * Adds a stylesheet at the end of `<head>` and a script at the end of
   * `<body>`. A page without those tags still gets both: the style before the
   * body (or after the doctype, so the page keeps its rendering mode) and the
   * script at the very end. The code cannot close its own tag early.
   */
  export function injectIntoHtml(html: string, code: { script?: string; style?: string }): string {
    let out = String(html);
    const { script, style } = injectedCode(code);
    if (style) {
      const tag = `<style data-network-overrides>${style}</style>`;
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
      const tag = `<script data-network-overrides>${script}</script>`;
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

  /** An attribute value with the character references a CSP can hold decoded. */
  function decodeAttribute(value: string): string {
    return value
      .replace(/&(#39|#x27|apos);/gi, "'")
      .replace(/&(quot|#34|#x22);/gi, '"')
      .replace(/&amp;/gi, '&');
  }

  /** The policies of the page's `<meta http-equiv="Content-Security-Policy">` tags. */
  export function cspMetaPolicies(html: string): string[] {
    return (String(html).match(META_TAG) || [])
      .filter(isCspMeta)
      .map(tag => decodeAttribute(attributeOf(tag, 'content') || ''));
  }

  /** The page without its `<meta http-equiv="Content-Security-Policy">` tags. */
  export function removeCspMeta(html: string): string {
    return String(html).replace(META_TAG, tag => (isCspMeta(tag) ? '' : tag));
  }

  type InlineKind = 'script' | 'style';

  /** A policy's directives by lower-case name; a repeated directive is ignored, as browsers do. */
  function directivesOf(policy: string): Map<string, string[]> {
    const directives = new Map<string, string[]>();
    for (const part of policy.split(';')) {
      const [name, ...sources] = part.trim().toLowerCase().split(/\s+/);
      if (name && !directives.has(name)) directives.set(name, sources);
    }
    return directives;
  }

  /**
   * The directive of one policy that stops an inline element of this kind, or
   * undefined when the policy lets it run. A nonce, a hash or 'strict-dynamic'
   * turns 'unsafe-inline' off, as browsers do.
   */
  function blockingDirective(policy: string, kind: InlineKind): string | undefined {
    const directives = directivesOf(policy);
    const name = [`${kind}-src-elem`, `${kind}-src`, 'default-src'].find(candidate =>
      directives.has(candidate)
    );
    if (!name) return undefined;
    const sources = directives.get(name) || [];
    const turnsInlineOff = sources.some(
      source =>
        source.startsWith("'nonce-") ||
        /^'sha(256|384|512)-/.test(source) ||
        source === "'strict-dynamic'"
    );
    return turnsInlineOff || !sources.includes("'unsafe-inline'") ? name : undefined;
  }

  /**
   * Whether any of these Content-Security-Policy values stops an inline
   * `<script>` or `<style>` element from running.
   */
  export function cspBlocksInline(policies: string[], kind: InlineKind): boolean {
    return policies
      .flatMap(value => String(value).split(','))
      .some(policy => blockingDirective(policy, kind) !== undefined);
  }

  /**
   * Whether a policy sandboxes the page without 'allow-scripts', which stops
   * every script, whatever its source lists say.
   */
  export function cspSandboxBlocksScripts(policies: string[]): boolean {
    return policies
      .flatMap(value => String(value).split(','))
      .some(policy => {
        const sandbox = directivesOf(policy).get('sandbox');
        return sandbox !== undefined && !sandbox.includes('allow-scripts');
      });
  }

  /** The SHA-256 of a text's UTF-8 bytes in base64, as a CSP hash source spells it. */
  export async function sha256Base64(text: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    let binary = '';
    for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
    return btoa(binary);
  }

  /**
   * A Content-Security-Policy value that lets exactly the injected code run:
   * where a policy stops inline scripts (or styles), the hash of the injected
   * script (or stylesheet) is added to the directive that decides, and a
   * 'none' there is dropped, since it may not stand beside a source.
   * Everything else in the policy stays as it was.
   */
  export function allowHashesInCsp(
    value: string,
    hashes: { script?: string; style?: string }
  ): string {
    return String(value)
      .split(',')
      .map(policy => {
        let out = policy;
        for (const kind of ['script', 'style'] as InlineKind[]) {
          const hash = hashes[kind];
          const name = hash ? blockingDirective(out, kind) : undefined;
          if (!hash || !name) continue;
          const parts = out.split(';');
          const index = parts.findIndex(part => part.trim().toLowerCase().split(/\s+/)[0] === name);
          const lead = /^\s*/.exec(parts[index])?.[0] ?? '';
          const tokens = parts[index]
            .trim()
            .split(/\s+/)
            .filter(token => token.toLowerCase() !== "'none'");
          parts[index] = `${lead}${[...tokens, `'sha256-${hash}'`].join(' ')}`;
          out = parts.join(';');
        }
        return out;
      })
      .join(',');
  }

  /** The page with the hashes added to its `<meta http-equiv="Content-Security-Policy">` tags. */
  export function allowHashesInCspMeta(
    html: string,
    hashes: { script?: string; style?: string }
  ): string {
    return String(html).replace(META_TAG, tag => {
      if (!isCspMeta(tag)) return tag;
      const policy = allowHashesInCsp(decodeAttribute(attributeOf(tag, 'content') || ''), hashes);
      const content = `content="${policy.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`;
      return tag.replace(/\scontent\s*=\s*("[^"]*"|'[^']*'|[^\s"'>]+)/i, ` ${content}`);
    });
  }
}
