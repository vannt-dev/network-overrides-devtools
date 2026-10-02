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

  export type RulePlacement = 'before' | 'after';

  export function isSameRuleGroup(a: OverrideRule, b: OverrideRule): boolean {
    return (a.isGlobal === true) === (b.isGlobal === true);
  }

  /**
   * Moves the rule at `from` next to the rule at `target`.
   *
   * Domain rules and global rules are stored separately and load as "domain
   * rules first, then global rules", so an order that mixes the two would not
   * survive a reload. A move across that boundary is refused. Returns null
   * when the move is refused or would change nothing.
   */
  export function moveRule(
    rules: OverrideRule[],
    from: number,
    target: number,
    placement: RulePlacement
  ): OverrideRule[] | null {
    const isIndex = (value: number) =>
      Number.isInteger(value) && value >= 0 && value < rules.length;
    if (!isIndex(from) || !isIndex(target) || from === target) return null;
    if (!isSameRuleGroup(rules[from], rules[target])) return null;

    const moved = rules[from];
    const next = rules.filter((_, index) => index !== from);
    const anchor = next.indexOf(rules[target]);
    next.splice(placement === 'before' ? anchor : anchor + 1, 0, moved);
    return next.every((rule, index) => rule === rules[index]) ? null : next;
  }

  export function normalizeApiType(type: any): string {
    const rawType = typeof type === 'string' ? type : 'other';
    const normalized = rawType.toLowerCase();
    if (normalized === 'xmlhttprequest') return 'xhr';
    return normalized;
  }
}
