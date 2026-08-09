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
