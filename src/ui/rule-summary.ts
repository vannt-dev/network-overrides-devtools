/*! SPDX-License-Identifier: MIT | Copyright (c) 2025 Van Nguyen | github.com/vannt-dev/network-overrides-devtools */
/// <reference path="./types.ts" />

namespace NetworkOverridesUi {
  /** A delay as people read it: `250 ms`, `1.5 s`, `3 s`. */
  export function formatDelay(ms: number): string {
    if (ms < 1000) return `${ms} ms`;
    return `${Math.round(ms / 100) / 10} s`;
  }

  function plural(count: number, word: string): string {
    return `${count} ${word}${count === 1 ? '' : 's'}`;
  }

  /** What a rule matches: method, pattern, GraphQL operation and conditions. */
  function describeMatch(rule: OverrideRule): string {
    if (rule.kind === 'websocket') {
      const details: string[] = [];
      if (rule.wsDirection && rule.wsDirection !== 'receive') details.push(rule.wsDirection);
      if (rule.wsMatch) {
        details.push(rule.wsMatchRegex ? `/${rule.wsMatch}/` : `contains "${rule.wsMatch}"`);
      }
      return `ws ${rule.pattern}${details.length ? ` (${details.join(', ')})` : ''}`;
    }
    const parts: string[] = [];
    if (rule.method && rule.method.toUpperCase() !== 'ANY') parts.push(rule.method.toUpperCase());
    parts.push(rule.pattern);
    if (rule.graphqlOperation) parts.push(`(op: ${rule.graphqlOperation})`);
    if (rule.matchQuery?.length) {
      parts.push(`+ query ${NetworkOverridesUtils.formatQueryConditions(rule.matchQuery)}`);
    }
    if (rule.matchHeaders?.length) {
      const headers = NetworkOverridesUtils.formatHeaderConditions(rule.matchHeaders);
      parts.push(`+ header ${headers.split('\n').join(', ')}`);
    }
    if (rule.matchBody) parts.push(`+ body has ${rule.matchBody}`);
    return parts.join(' ');
  }

  const WS_ACTION_TEXT: Record<string, string> = {
    replace: 'replace frames',
    substitute: 'substitute text in frames',
    block: 'block frames',
    delay: 'delay frames',
  };

  /** What a rule does to the request or its response. */
  function describeOutcome(rule: OverrideRule): string[] {
    if (rule.kind === 'websocket') {
      const action = rule.wsAction || 'replace';
      const text = WS_ACTION_TEXT[action] || action;
      const delay =
        action === 'delay' && typeof rule.delayMs === 'number' && rule.delayMs > 0
          ? ` ${formatDelay(rule.delayMs)}`
          : '';
      const parts = [`${text}${delay}`];
      if (rule.processTemplates === false && (action === 'replace' || action === 'substitute')) {
        parts.push('templates off');
      }
      return parts;
    }

    const parts: string[] = [];
    const status = typeof rule.statusCode === 'number' ? String(rule.statusCode) : null;
    if (rule.failReason) {
      parts.push(
        rule.failReason === 'Failed' ? 'network error' : `network error (${rule.failReason})`
      );
    } else if (rule.redirectUrl) {
      parts.push(`redirect to ${rule.redirectUrl}`);
    } else {
      if (status) parts.push(status);
      if (rule.mode === 'patch') parts.push(`patch ${plural(rule.patch?.length || 0, 'field')}`);
      else if (rule.mode === 'script') parts.push('script');
      else if (rule.mode === 'file') parts.push('base64 body');
      else if (!status) parts.push('mock body');
      if (rule.respondAtRequest && rule.mode !== 'patch') parts.push('no server');
      if (rule.processTemplates === false && (rule.mode === 'text' || rule.mode === 'file')) {
        parts.push('templates off');
      }
    }
    if (typeof rule.delayMs === 'number' && rule.delayMs > 0) {
      parts.push(`slow ${formatDelay(rule.delayMs)}`);
    }
    if (!rule.failReason && !rule.redirectUrl && rule.responseHeaders?.length) {
      parts.push(`+${plural(rule.responseHeaders.length, 'response header')}`);
    }
    if (rule.requestBody) parts.push('new request body');
    if (rule.requestHeaders?.length) {
      parts.push(`+${plural(rule.requestHeaders.length, 'request header')}`);
    }
    return parts;
  }

  /**
   * One line that says what a rule matches and what it does, such as
   * `GET /api/orders → 500 · slow 3 s`. The editor holds the full details.
   */
  export function summarizeRule(rule: OverrideRule): string {
    return `${describeMatch(rule)} → ${describeOutcome(rule).join(' · ')}`;
  }
}
