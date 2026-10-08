/// <reference types="chrome" />
/// <reference path="../shared.ts" />
/// <reference path="../utils.ts" />

namespace NetworkOverridesBackground {
  type OverrideRule = NetworkOverridesShared.OverrideRule;
  type FetchHeader = NetworkOverridesShared.FetchHeader;

  /** How long a script may take before its request is answered with an error. */
  export const RESPONSE_SCRIPT_TIMEOUT_MS = 5000;

  export type ResponseScriptOutcome =
    | { ok: true; body: string; statusCode?: number; headers?: FetchHeader[] }
    | { ok: false; error: string };

  function describeException(details: any): string {
    const description = details?.exception?.description;
    if (typeof description === 'string' && description.trim()) {
      // The first line is "Error: message"; the rest is a stack through this extension's wrapper.
      return description.split('\n')[0].trim();
    }
    const value = details?.exception?.value;
    if (value !== undefined && value !== null) return String(value);
    return typeof details?.text === 'string' && details.text ? details.text : 'Script failed';
  }

  /**
   * Runs a rule's script and hands back the response it describes.
   *
   * The script runs in the inspected page, through the debugger session that
   * is already attached: an extension's own pages and worker may not evaluate
   * strings as code, and the page is where a mock author expects `fetch`,
   * `localStorage` and the page's own state to be. `done` is called exactly
   * once, with an error outcome when the script throws, returns something
   * unusable or does not settle in time.
   */
  export function runResponseScript(
    tabId: number,
    params: any,
    rule: OverrideRule,
    captures: string[],
    done: (outcome: ResponseScriptOutcome) => void
  ): void {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settle = (outcome: ResponseScriptOutcome) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      done(outcome);
    };

    const evaluate = (responseBody: string | null) => {
      const input = NetworkOverridesUtils.buildScriptRequest({
        url: params.request?.url || '',
        method: params.request?.method,
        headers: params.request?.headers,
        postData: params.request?.postData,
        captures,
        responseStatus: params.responseStatusCode,
        responseHeaders: params.responseHeaders,
        responseBody,
      });
      timer = setTimeout(() => {
        settle({
          ok: false,
          error: `The script did not return within ${RESPONSE_SCRIPT_TIMEOUT_MS / 1000} s.`,
        });
      }, RESPONSE_SCRIPT_TIMEOUT_MS);
      chrome.debugger.sendCommand(
        { tabId },
        'Runtime.evaluate',
        {
          expression: NetworkOverridesUtils.buildResponseScriptExpression(rule.body || '', input),
          awaitPromise: true,
          returnByValue: true,
          userGesture: false,
        },
        (response: any) => {
          if (chrome.runtime.lastError) {
            settle({
              ok: false,
              error: chrome.runtime.lastError.message || 'The script could not run.',
            });
            return;
          }
          if (response?.exceptionDetails) {
            settle({ ok: false, error: describeException(response.exceptionDetails) });
            return;
          }
          settle(
            NetworkOverridesUtils.normalizeScriptResult(
              NetworkOverridesUtils.parseScriptEnvelope(response?.result?.value)
            )
          );
        }
      );
    };

    // The original response is offered to the script so it can be edited
    // rather than replaced. A response without a readable body, such as a
    // redirect, reaches the script with `body: null`.
    chrome.debugger.sendCommand(
      { tabId },
      'Fetch.getResponseBody',
      { requestId: params.requestId },
      (response: { body?: string; base64Encoded?: boolean } | undefined) => {
        if (chrome.runtime.lastError || !response || typeof response.body !== 'string') {
          evaluate(null);
          return;
        }
        evaluate(
          NetworkOverridesNormalizeBodyLocal(response.body, response.base64Encoded ?? false)
        );
      }
    );
  }
}
