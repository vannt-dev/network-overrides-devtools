/*! SPDX-License-Identifier: MIT | Copyright (c) 2025 Van Nguyen | github.com/vannt-dev/network-overrides-devtools */
/// <reference path="./types.ts" />

namespace NetworkOverridesUi {
  /** A delay as people read it: `250 ms`, `1.5 s`, `3 s`. */
  export function formatDelay(ms: number): string {
    if (ms < 1000) return `${ms} ms`;
    return `${Math.round(ms / 100) / 10} s`;
  }

  /** What a rule matches: method, pattern, GraphQL operation and conditions. */
  function describeMatch(rule: OverrideRule): string {
    if (rule.kind === 'websocket') {
      const details: string[] = [];
      if (rule.wsDirection && rule.wsDirection !== 'receive') details.push(rule.wsDirection);
      if (rule.wsMatch) {
        details.push(
          rule.wsMatchRegex ? `/${rule.wsMatch}/` : t('summary_ws_contains', rule.wsMatch)
        );
      }
      return `ws ${rule.pattern}${details.length ? ` (${details.join(', ')})` : ''}`;
    }
    // An inject rule matches pages by their address only.
    if (rule.kind === 'inject') return rule.pattern;
    const parts: string[] = [];
    if (rule.method && rule.method.toUpperCase() !== 'ANY') parts.push(rule.method.toUpperCase());
    parts.push(rule.pattern);
    if (rule.graphqlOperation) parts.push(t('summary_graphql_op', rule.graphqlOperation));
    if (rule.matchQuery?.length) {
      parts.push(t('summary_query', NetworkOverridesUtils.formatQueryConditions(rule.matchQuery)));
    }
    if (rule.matchHeaders?.length) {
      const headers = NetworkOverridesUtils.formatHeaderConditions(rule.matchHeaders);
      parts.push(t('summary_header', headers.split('\n').join(', ')));
    }
    if (rule.matchBody) parts.push(t('summary_body_has', rule.matchBody));
    return parts.join(' ');
  }

  function wsActionText(action: string): string {
    if (action === 'replace') return t('summary_ws_replace');
    if (action === 'substitute') return t('summary_ws_substitute');
    if (action === 'block') return t('summary_ws_block');
    if (action === 'delay') return t('summary_ws_delay');
    return action;
  }

  /** What a rule does to the request or its response. */
  function describeOutcome(rule: OverrideRule): string[] {
    if (rule.kind === 'websocket') {
      const action = rule.wsAction || 'replace';
      const text = wsActionText(action);
      const delay =
        action === 'delay' && typeof rule.delayMs === 'number' && rule.delayMs > 0
          ? ` ${formatDelay(rule.delayMs)}`
          : '';
      const parts = [`${text}${delay}`];
      if (rule.processTemplates === false && (action === 'replace' || action === 'substitute')) {
        parts.push(t('summary_templates_off'));
      }
      return parts;
    }

    if (rule.kind === 'inject') {
      const js = !!rule.injectScript?.trim();
      const css = !!rule.injectStyle?.trim();
      const parts = [
        js && css
          ? t('summary_inject_both')
          : js
            ? t('summary_inject_js')
            : t('summary_inject_css'),
      ];
      if (rule.relaxCsp) parts.push(t('summary_csp_relaxed'));
      return parts;
    }

    const parts: string[] = [];
    const status = typeof rule.statusCode === 'number' ? String(rule.statusCode) : null;
    if (rule.failReason) {
      parts.push(
        rule.failReason === 'Failed'
          ? t('summary_network_error')
          : t('summary_network_error_reason', rule.failReason)
      );
    } else if (rule.redirectUrl) {
      parts.push(t('summary_redirect', rule.redirectUrl));
    } else {
      if (status) parts.push(status);
      if (rule.mode === 'patch') {
        const fields = rule.patch?.length || 0;
        parts.push(fields === 1 ? t('summary_patch_one') : t('summary_patch_other', fields));
      } else if (rule.mode === 'script') parts.push(t('summary_script'));
      else if (rule.mode === 'passthrough') parts.push(t('summary_real_response'));
      else if (rule.fileName) parts.push(t('summary_local_file', rule.fileName));
      else if (rule.mode === 'file') parts.push(t('summary_base64'));
      else if (!status) parts.push(t('summary_mock_body'));
      if (NetworkOverridesUtils.hasResponseVariants(rule)) {
        parts.push(t('summary_random', String((rule.responses?.length || 0) + 1)));
      }
      if (rule.respondAtRequest && rule.mode !== 'patch' && rule.mode !== 'passthrough') {
        parts.push(t('summary_no_server'));
      }
      if (rule.processTemplates === false && (rule.mode === 'text' || rule.mode === 'file')) {
        parts.push(t('summary_templates_off'));
      }
    }
    if (typeof rule.delayMs === 'number' && rule.delayMs > 0) {
      parts.push(t('summary_slow', formatDelay(rule.delayMs)));
    }
    if (!rule.failReason && !rule.redirectUrl && rule.responseHeaders?.length) {
      const count = rule.responseHeaders.length;
      parts.push(
        count === 1 ? t('summary_response_headers_one') : t('summary_response_headers_other', count)
      );
    }
    if (!rule.failReason && !rule.redirectUrl && rule.removeResponseHeaders?.length) {
      const count = rule.removeResponseHeaders.length;
      parts.push(
        count === 1
          ? t('summary_removed_headers_one', rule.removeResponseHeaders[0])
          : t('summary_removed_headers_other', count)
      );
    }
    if (rule.requestBody) parts.push(t('summary_request_body'));
    if (rule.requestHeaders?.length) {
      const count = rule.requestHeaders.length;
      parts.push(
        count === 1 ? t('summary_request_headers_one') : t('summary_request_headers_other', count)
      );
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
