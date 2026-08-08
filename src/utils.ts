/// <reference types="chrome" />

namespace NetworkOverridesUtils {
  export function isRegexPattern(pattern: string): boolean {
    return pattern.startsWith('/') && pattern.lastIndexOf('/') > 0;
  }

  export function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  export function matchPattern(pattern: string, url: string): string[] | null {
    const trimmed = pattern.trim();
    if (trimmed === '*' || trimmed.toLowerCase() === 'all') {
      return [];
    }
    if (isRegexPattern(trimmed)) {
      const lastSlash = trimmed.lastIndexOf('/');
      const source = trimmed.slice(1, lastSlash);
      const flags = trimmed.slice(lastSlash + 1);
      try {
        const regex = new RegExp(source, flags);
        return regex.test(url) ? [] : null;
      } catch {
        return null;
      }
    }
    if (trimmed.includes('*')) {
      const parts = trimmed.split('*').map(escapeRegex);
      try {
        const regex = new RegExp('^' + parts.join('(.*)') + '$');
        const match = url.match(regex);
        return match ? match.slice(1) : null;
      } catch {
        return null;
      }
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

  export function processResponseTemplate(body: string, captures: string[] = []): string {
    if (!body || !body.includes('{{')) return body;
    let result = body;
    result = result.replace(/\{\{(timestamp|now)\}\}/gi, () => new Date().toISOString());
    result = result.replace(/\{\{epoch\}\}/gi, () => String(Date.now()));
    result = result.replace(/\{\{uuid\}\}/gi, () => {
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      });
    });
    result = result.replace(/\{\{randomInt:(\d+):(\d+)\}\}/gi, (_, minStr, maxStr) => {
      const min = parseInt(minStr, 10);
      const max = parseInt(maxStr, 10);
      return String(Math.floor(Math.random() * (max - min + 1)) + min);
    });
    result = result.replace(/\{\{param:(\d+)\}\}/gi, (_, indexStr) => {
      const idx = parseInt(indexStr, 10) - 1;
      return idx >= 0 && idx < captures.length ? captures[idx] : '';
    });
    return result;
  }
}
