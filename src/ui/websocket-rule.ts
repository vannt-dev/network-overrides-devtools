/// <reference path="./types.ts" />

namespace NetworkOverridesUi {
  const WS_DIRECTIONS = ['send', 'receive', 'both'];
  const WS_ACTIONS = ['replace', 'substitute', 'block', 'delay'];

  export function isValidWsDirection(value: unknown): boolean {
    return typeof value === 'string' && WS_DIRECTIONS.includes(value);
  }

  export function isValidWsAction(value: unknown): boolean {
    return typeof value === 'string' && WS_ACTIONS.includes(value);
  }

  export function prefillWebSocketFields(elements: Elements, rule: OverrideRule | null): void {
    elements.modalWsDirection.value = rule?.wsDirection || 'receive';
    elements.modalWsMatch.value = rule?.wsMatch || '';
    elements.modalWsRegex.checked = rule?.wsMatchRegex === true;
    elements.modalWsAction.value = rule?.wsAction || 'replace';
  }

  /**
   * Builds a WebSocket rule from the modal, or says which field is wrong.
   * `delayMs` is the already-validated value of the shared Delay field.
   */
  export function readWebSocketRule(
    elements: Elements,
    pattern: string,
    delayMs: number | undefined
  ): { rule: OverrideRule } | { error: string; field: HTMLElement } {
    if (!NetworkOverridesUtils.isRegexPattern(pattern) && !/^(wss?:\/\/|\*)/i.test(pattern)) {
      return {
        error: 'A WebSocket pattern starts with ws://, wss:// or *.',
        field: elements.modalPattern,
      };
    }
    const action = elements.modalWsAction.value as NetworkOverridesShared.WsAction;
    const match = elements.modalWsMatch.value;
    const isRegex = elements.modalWsRegex.checked;
    if (isRegex && match) {
      try {
        new RegExp(match);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return {
          error: `Match is not a valid regular expression: ${reason}`,
          field: elements.modalWsMatch,
        };
      }
    }
    if (action === 'substitute' && !match) {
      return { error: 'Substitute needs a Match to replace.', field: elements.modalWsMatch };
    }
    if (action === 'delay' && !delayMs) {
      return { error: 'Delay frame needs a delay above 0 ms.', field: elements.modalDelay };
    }

    const usesBody = action === 'replace' || action === 'substitute';
    const rule: OverrideRule = {
      pattern,
      body: usesBody ? elements.modalBody.value : '',
      mode: 'text',
      kind: 'websocket',
      wsDirection: elements.modalWsDirection.value as NetworkOverridesShared.WsDirection,
    };
    if (match) rule.wsMatch = match;
    if (match && isRegex) rule.wsMatchRegex = true;
    rule.wsAction = action;
    if (action === 'delay') rule.delayMs = delayMs;
    if (usesBody && elements.modalProcessTemplates?.checked === false) {
      rule.processTemplates = false;
    }
    if (elements.modalGlobalRule?.checked) rule.isGlobal = true;
    return { rule };
  }

  export function describeWebSocketRule(rule: OverrideRule): string {
    const direction = rule.wsDirection || 'receive';
    const match = rule.wsMatch
      ? rule.wsMatchRegex
        ? `/${rule.wsMatch}/`
        : `contains "${rule.wsMatch}"`
      : 'any frame';
    const action = rule.wsAction || 'replace';
    const suffix = action === 'delay' ? ` ${rule.delayMs || 0}ms` : '';
    return `${direction} · ${match} → ${action}${suffix}`;
  }
}
