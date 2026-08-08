/// <reference path="./types.ts" />
/// <reference path="../utils.ts" />

namespace NetworkOverridesUi {
  export function formatApiLabel(url: string): string {
    if (!url.startsWith('data:')) return url;
    const commaIndex = url.indexOf(',');
    const prefix = commaIndex === -1 ? url : url.slice(0, commaIndex);
    const mediaType = prefix.slice(5) || 'unknown';
    return `[data URL: ${mediaType}]`;
  }

  export function highlightApiLabel(url: string, rawSearchTerm: string): string {
    const label = formatApiLabel(url);
    const searchTerm = rawSearchTerm.trim().toLowerCase();
    if (!searchTerm) return escapeHtml(label);
    const lowerLabel = label.toLowerCase();
    const matchIndex = lowerLabel.indexOf(searchTerm);
    if (matchIndex === -1) return escapeHtml(label);
    const before = escapeHtml(label.slice(0, matchIndex));
    const match = escapeHtml(label.slice(matchIndex, matchIndex + searchTerm.length));
    const after = escapeHtml(label.slice(matchIndex + searchTerm.length));
    return `${before}<mark class="api-match">${match}</mark>${after}`;
  }

  export function formatJsonIfPossible(value: string): string {
    try {
      const parsed = JSON.parse(value);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return value;
    }
  }

  export function normalizeApiType(type: any): string {
    const rawType = typeof type === 'string' ? type : 'other';
    const normalized = rawType.toLowerCase();
    if (normalized === 'xmlhttprequest') return 'xhr';
    return normalized;
  }
}
