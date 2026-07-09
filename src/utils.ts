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
}
