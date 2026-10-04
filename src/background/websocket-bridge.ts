/// <reference types="chrome" />
/// <reference path="../shared.ts" />
/// <reference path="../tab-state.ts" />

// Source text of the page-side wrapper, prepended to background.bundle.js by
// scripts/bundle.mjs (see src/injected/websocket-wrapper.ts).
declare const NETWORK_OVERRIDES_WS_WRAPPER: string;

namespace NetworkOverridesBackground {
  import TabState = NetworkOverridesTabState;
  type OverrideRule = NetworkOverridesShared.OverrideRule;

  export const WS_BINDING = '__nowsReport';

  function command<T = unknown>(tabId: number, method: string, params: object): Promise<T> {
    return new Promise((resolve, reject) => {
      chrome.debugger.sendCommand({ tabId }, method, params, (result?: unknown) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(result as T);
      });
    });
  }

  function activeWebSocketRules(rules: OverrideRule[]): OverrideRule[] {
    return rules.filter(rule => rule.kind === 'websocket' && rule.enabled !== false);
  }

  function wrapperScript(rules: OverrideRule[]): string {
    return `(${NETWORK_OVERRIDES_WS_WRAPPER})(${JSON.stringify(rules)});`;
  }

  /** Evaluated on a live page before a voluntary detach: frames pass untouched. */
  export function webSocketDetachScript(): string {
    return wrapperScript([]);
  }

  /** A new debugger session has no binding and none of our scripts. */
  export function resetWebSocketBridge(tabId: number): void {
    const rt = TabState.runtime(tabId);
    rt.wsScriptId = undefined;
    rt.wsBindingReady = false;
  }

  async function sync(tabId: number): Promise<void> {
    const state = TabState.get(tabId);
    if (!state) return;
    const rt = TabState.runtime(tabId);
    const rules = state.enabled ? activeWebSocketRules(state.overrides) : [];
    if (rules.length === 0 && rt.wsScriptId === undefined) return;

    if (!rt.wsBindingReady) {
      await command(tabId, 'Runtime.enable', {});
      await command(tabId, 'Runtime.addBinding', { name: WS_BINDING });
      rt.wsBindingReady = true;
    }
    if (rt.wsScriptId !== undefined) {
      const identifier = rt.wsScriptId;
      rt.wsScriptId = undefined;
      await command(tabId, 'Page.removeScriptToEvaluateOnNewDocument', { identifier }).catch(
        () => {}
      );
    }
    const source = wrapperScript(rules);
    const added = await command<{ identifier?: string }>(
      tabId,
      'Page.addScriptToEvaluateOnNewDocument',
      { source }
    );
    rt.wsScriptId = added?.identifier;
    await command(tabId, 'Runtime.evaluate', { expression: source });
  }

  /**
   * Puts the tab's enabled WebSocket rules into the page now and into every
   * document it loads next. Failures are logged, never thrown: HTTP
   * interception must keep working without the WebSocket part.
   */
  export function syncWebSocketRules(tabId: number): Promise<void> {
    const rt = TabState.runtime(tabId);
    rt.wsSync = rt.wsSync
      .then(() => sync(tabId))
      .catch(error => {
        console.error('[NetworkOverrides] WebSocket rules not applied for tab', tabId, error);
      });
    return rt.wsSync;
  }

  export function handleWebSocketBinding(tabId: number, params: any): void {
    if (params?.name !== WS_BINDING || typeof params.payload !== 'string') return;
    let report: any;
    try {
      report = JSON.parse(params.payload);
    } catch {
      return;
    }
    if (report?.event === 'applied') {
      TabState.recordOverrideStat(tabId);
    } else if (report?.event === 'error') {
      const message = {
        type: 'wsRuleError',
        tabId,
        pattern: String(report.pattern ?? ''),
        message: String(report.message ?? ''),
      };
      TabState.runtime(tabId).subscriberPorts.forEach(port => {
        try {
          port.postMessage(message);
        } catch {}
      });
    }
  }
}
