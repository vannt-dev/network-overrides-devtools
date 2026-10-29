/*! SPDX-License-Identifier: MIT | Copyright (c) 2025 Van Nguyen | github.com/vannt-dev/network-overrides-devtools */
/// <reference types="chrome" />
/// <reference path="../shared.ts" />
/// <reference path="../utils.ts" />
/// <reference path="../tab-state.ts" />
/// <reference path="./response-script.ts" />

namespace NetworkOverridesBackground {
  import TabState = NetworkOverridesTabState;

  type OverrideRule = NetworkOverridesShared.OverrideRule;
  type FetchHeader = NetworkOverridesShared.FetchHeader;

  /**
   * The request body as text: `postData`, failing that the bytes of
   * `postDataEntries`. Chrome leaves both out for some large or binary
   * bodies; a body condition then does not match.
   */
  function requestBodyText(request: any): string | undefined {
    if (typeof request?.postData === 'string') return request.postData;
    const entries = request?.postDataEntries;
    if (!Array.isArray(entries) || entries.length === 0) return undefined;
    try {
      // Decoded together, so a character split across two entries survives.
      const binary = entries
        .map(entry => (typeof entry?.bytes === 'string' ? atob(entry.bytes) : ''))
        .join('');
      const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
      return new TextDecoder().decode(bytes);
    } catch {
      return undefined;
    }
  }

  function findOverride(
    request: any,
    overrides: OverrideRule[],
    postData?: string
  ): { override: OverrideRule; captures: string[] } | null {
    const url = request?.url || '';
    const method = request?.method;
    const conditionRequest = {
      url,
      headers: request?.headers,
      body: requestBodyText(request),
    };
    for (const test of overrides) {
      if (test.kind === 'websocket') continue;
      if (test.enabled === false) continue;
      if (!NetworkOverridesUtils.matchesMethod(test.method, method)) continue;
      if (!NetworkOverridesUtils.matchesGraphQLOperation(test.graphqlOperation, postData)) continue;
      if (!NetworkOverridesUtils.matchesRequestConditions(test, conditionRequest)) continue;
      const captures = matchPattern(test.pattern, url);
      if (captures !== null) {
        return { override: test, captures };
      }
    }
    return null;
  }

  /** Reads a request header whatever the case of its name. */
  function headerValue(headers: any, name: string): string | undefined {
    if (!headers || typeof headers !== 'object') return undefined;
    const wanted = name.toLowerCase();
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === wanted) return String(headers[key]);
    }
    return undefined;
  }

  /** The method a CORS preflight asks about, or null when the request is not one. */
  function preflightMethod(request: any): string | null {
    if (String(request?.method || '').toUpperCase() !== 'OPTIONS') return null;
    const asked = headerValue(request?.headers, 'access-control-request-method');
    return asked && asked.trim() ? asked.trim().toUpperCase() : null;
  }

  /**
   * The rule the request behind a preflight will meet first. A preflight
   * carries neither the body nor the headers of that request, so only the
   * query conditions are checked here, not GraphQL, header or body ones.
   */
  function findPreflightTarget(
    url: string,
    method: string,
    overrides: OverrideRule[]
  ): OverrideRule | null {
    for (const rule of overrides) {
      if (rule.kind === 'websocket' || rule.enabled === false) continue;
      if (!NetworkOverridesUtils.matchesMethod(rule.method, method)) continue;
      if (!NetworkOverridesUtils.matchesQuery(rule.matchQuery, url)) continue;
      if (matchPattern(rule.pattern, url) !== null) return rule;
    }
    return null;
  }

  /**
   * Answers the CORS preflight of a request that will itself be answered
   * without the server, allowing exactly what the page asks for.
   */
  function answerPreflight(tabId: number, params: any, method: string, proceed: () => void): void {
    const requestHeaders = params.request?.headers;
    const origin = headerValue(requestHeaders, 'origin');
    const askedHeaders = headerValue(requestHeaders, 'access-control-request-headers');
    const headers: FetchHeader[] = [
      { name: 'Access-Control-Allow-Origin', value: origin || '*' },
      { name: 'Access-Control-Allow-Methods', value: method },
    ];
    if (askedHeaders) headers.push({ name: 'Access-Control-Allow-Headers', value: askedHeaders });
    if (origin) {
      headers.push({ name: 'Access-Control-Allow-Credentials', value: 'true' });
      headers.push({ name: 'Vary', value: 'Origin' });
    }
    headers.push({ name: 'Access-Control-Max-Age', value: '60' });
    headers.push({ name: 'x-network-overrides', value: 'true' });
    chrome.debugger.sendCommand(
      { tabId },
      'Fetch.fulfillRequest',
      { requestId: params.requestId, responseCode: 204, responseHeaders: headers, body: '' },
      () => {
        if (chrome.runtime.lastError) {
          console.error('fulfillRequest (preflight) failed:', chrome.runtime.lastError.message);
          proceed();
        }
      }
    );
  }

  /**
   * Answers a request with a body rule: the rule's body (text, base64 or the
   * result of its script), status, headers and delay. At the response stage
   * the server's headers and status are the starting point; at the request
   * stage (`respondAtRequest`) there are none and the server is never called.
   */
  function answerWithBody(
    tabId: number,
    params: any,
    match: { override: OverrideRule; captures: string[] },
    proceed: () => void,
    atRequestStage = false
  ): void {
    const url = params.request?.url || '';
    console.log('[NetworkOverrides] Fulfill body:', match.override.pattern, '→', url);

    const ov = match.override;
    const captures = match.captures;

    function bodyToValidBase64(): string {
      const rawBody = ov.body || '';
      const processedBody =
        ov.mode !== 'file' && ov.processTemplates !== false
          ? NetworkOverridesUtils.processResponseTemplate(rawBody, captures, url)
          : rawBody;
      if (ov.mode !== 'file') return NetworkOverridesStringToBase64Local(processedBody);
      try {
        atob(ov.body);
        return ov.body;
      } catch {
        console.warn(
          '[NetworkOverrides] Invalid base64 in file mode for',
          ov.pattern,
          '— encoding as text instead'
        );
        return NetworkOverridesStringToBase64Local(processedBody);
      }
    }

    const fulfill = (
      responseBodyBase64: string,
      scripted?: { statusCode?: number; headers?: FetchHeader[] }
    ): void => {
      // A fulfilled body is decoded bytes supplied by this extension. Reusing
      // representation-specific headers from the origin can make Chromium try
      // to decompress the new body or enforce the old byte length/checksum.
      // Rule-provided headers are merged afterwards, so advanced users can
      // still opt into one of these headers explicitly.
      const bodyDependentHeaders = new Set([
        'content-encoding',
        'content-length',
        'content-md5',
        'content-range',
        'digest',
        'transfer-encoding',
        'trailer',
        'x-network-overrides',
        'x-network-overrides-pattern',
      ]);
      const headers = ((params.responseHeaders as FetchHeader[]) || []).filter(
        header => !bodyDependentHeaders.has(header.name.toLowerCase().trim())
      );
      const mergeHeaders = (extras: FetchHeader[] | undefined) => {
        if (!Array.isArray(extras)) return;
        for (const extra of extras) {
          if (!extra || typeof extra.name !== 'string' || !extra.name.trim()) continue;
          // Skip rule headers that conflict with marker headers; markers always win.
          const trimmedLowerName = extra.name.toLowerCase().trim();
          if (
            trimmedLowerName === 'x-network-overrides' ||
            trimmedLowerName === 'x-network-overrides-pattern'
          ) {
            continue;
          }
          const existingIndex = headers.findIndex(
            header => header.name.toLowerCase() === extra.name.toLowerCase()
          );
          if (existingIndex >= 0) {
            headers[existingIndex] = {
              name: headers[existingIndex].name,
              value: String(extra.value),
            };
          } else {
            headers.push({ name: extra.name, value: String(extra.value) });
          }
        }
      };
      mergeHeaders(ov.responseHeaders);
      // What a script returns is the most specific word on the response, so
      // it is applied over the rule's own headers and status.
      mergeHeaders(scripted?.headers);
      // An early answer has no server headers, so a cross-origin page could
      // not read it: allow the page's origin unless the rule says otherwise.
      const origin = atRequestStage ? headerValue(params.request?.headers, 'origin') : undefined;
      const hasHeader = (name: string) =>
        headers.some(header => header.name.toLowerCase() === name);
      if (origin && !hasHeader('access-control-allow-origin')) {
        headers.push({ name: 'Access-Control-Allow-Origin', value: origin });
        if (!hasHeader('access-control-allow-credentials')) {
          headers.push({ name: 'Access-Control-Allow-Credentials', value: 'true' });
        }
      }
      if (!headers.find(h => h.name.toLowerCase() === 'content-type')) {
        headers.push({ name: 'Content-Type', value: 'application/json; charset=utf-8' });
      }

      // The markers always win and cannot be removed by rule headers.
      headers.push({ name: 'x-network-overrides', value: 'true' });
      headers.push({ name: 'x-network-overrides-pattern', value: ov.pattern });

      const fallbackCode =
        typeof params.responseStatusCode === 'number' &&
        params.responseStatusCode >= 100 &&
        params.responseStatusCode <= 599
          ? params.responseStatusCode
          : 200;
      const ruleCode =
        typeof ov.statusCode === 'number' && ov.statusCode >= 100 && ov.statusCode <= 599
          ? ov.statusCode
          : fallbackCode;
      const responseCode =
        typeof scripted?.statusCode === 'number' ? scripted.statusCode : ruleCode;

      TabState.recordOverrideStat(tabId, false);
      const doFulfill = () => {
        chrome.debugger.sendCommand(
          { tabId },
          'Fetch.fulfillRequest',
          {
            requestId: params.requestId,
            responseCode,
            responseHeaders: headers,
            body: responseBodyBase64,
          },
          () => {
            if (chrome.runtime.lastError) {
              console.error('fulfillRequest failed:', chrome.runtime.lastError.message);
              proceed();
            }
          }
        );
      };
      const delayMs = typeof ov.delayMs === 'number' ? ov.delayMs : 0;
      if (delayMs > 0) {
        setTimeout(doFulfill, delayMs);
      } else {
        doFulfill();
      }
    };

    // A script rule works the response out in the page, so it is answered
    // later; every other rule is answered here and now.
    if (ov.mode === 'script') {
      runResponseScript(tabId, params, ov, captures, outcome => {
        try {
          if (outcome.ok) {
            fulfill(NetworkOverridesStringToBase64Local(outcome.body), outcome);
            return;
          }
          console.warn('[NetworkOverrides] Script failed for', ov.pattern, '—', outcome.error);
          // Answered rather than passed through: a mock that silently falls
          // back to the real response looks like a mock that works.
          fulfill(
            NetworkOverridesStringToBase64Local(
              `Network Overrides: the script of rule "${ov.pattern}" failed.\n${outcome.error}`
            ),
            {
              statusCode: 500,
              headers: [
                { name: 'Content-Type', value: 'text/plain; charset=utf-8' },
                { name: 'x-network-overrides-error', value: 'script' },
              ],
            }
          );
        } catch (error) {
          console.error(error);
          proceed();
        }
      });
      return;
    }
    fulfill(bodyToValidBase64());
  }

  export function handleRequestPaused(tabId: number, params: any): void {
    // The response stage carries a status code, or an error reason when the
    // request failed at the network level (DNS, refused connection, ...).
    const isRequestStage =
      typeof params.responseStatusCode !== 'number' &&
      typeof params.responseErrorReason !== 'string';
    const url = params.request?.url || '';
    const state = TabState.get(tabId);

    const proceed = () => {
      chrome.debugger.sendCommand(
        { tabId },
        'Fetch.continueRequest',
        { requestId: params.requestId },
        () => {
          if (chrome.runtime.lastError) {
            // InterceptionId may already be invalid if request completed; ignore
          }
        }
      );
    };

    if (!state || !state.attached || !state.enabled) {
      proceed();
      return;
    }

    if (isRequestStage) {
      recordApi(tabId, {
        url,
        type: params.resourceType || 'other',
        method: params.request?.method,
        headers: toFetchHeaders(params.request?.headers),
        postData: params.request?.postData,
      });

      try {
        const postData = params.request?.postData || state.recentApis.get(url)?.postData;
        const match = findOverride(params.request, state.overrides, postData);
        // The preflight of a request that will be answered without the server
        // is answered too, unless a rule is written for OPTIONS itself.
        const askedMethod = preflightMethod(params.request);
        const optionsRule = match?.override.method?.toUpperCase() === 'OPTIONS';
        if (askedMethod && !optionsRule) {
          const target = findPreflightTarget(url, askedMethod, state.overrides);
          if (target?.respondAtRequest && !target.failReason && !target.redirectUrl) {
            answerPreflight(tabId, params, askedMethod, proceed);
            return;
          }
        }
        if (match && match.override.failReason) {
          TabState.recordOverrideStat(tabId, true);
          const errorReason = match.override.failReason;
          const fail = () => {
            chrome.debugger.sendCommand(
              { tabId },
              'Fetch.failRequest',
              { requestId: params.requestId, errorReason },
              () => {
                if (chrome.runtime.lastError) {
                  // The request may already be gone; nothing to recover.
                }
              }
            );
          };
          const delayMs = typeof match.override.delayMs === 'number' ? match.override.delayMs : 0;
          if (delayMs > 0) {
            setTimeout(fail, delayMs);
          } else {
            fail();
          }
          return;
        }
        if (match && match.override.redirectUrl) {
          const newUrl = substituteWildcards(match.override.redirectUrl, match.captures);
          if (newUrl.includes('*')) {
            console.error('[NetworkOverrides] Unsubstituted * in redirect URL:', newUrl);
            proceed();
            return;
          }
          console.log('[NetworkOverrides] Redirect:', url, '→', newUrl);
          chrome.debugger.sendCommand(
            { tabId },
            'Fetch.continueRequest',
            { requestId: params.requestId, url: newUrl },
            () => {
              if (chrome.runtime.lastError) {
                console.error('continueRequest redirect failed:', chrome.runtime.lastError.message);
                proceed();
              }
            }
          );
          return;
        }
        // A body rule set to answer without calling the server is answered
        // now, so the request never leaves the browser.
        if (match && match.override.respondAtRequest && (!askedMethod || optionsRule)) {
          answerWithBody(tabId, params, match, proceed, true);
          return;
        }
        const hasReqHeaders =
          Boolean(match) &&
          Array.isArray(match!.override.requestHeaders) &&
          match!.override.requestHeaders.length > 0;
        const hasReqBody =
          Boolean(match) &&
          typeof match!.override.requestBody === 'string' &&
          match!.override.requestBody.trim().length > 0;

        if (match && (hasReqHeaders || hasReqBody)) {
          const continueParams: any = { requestId: params.requestId };
          if (hasReqHeaders && match.override.requestHeaders) {
            const originalHeaders = toFetchHeaders(params.request?.headers);
            const reqHeaderMap = new Map<string, string>();
            for (const h of originalHeaders) {
              reqHeaderMap.set(h.name.toLowerCase(), h.value);
            }
            for (const h of match.override.requestHeaders) {
              if (h.name && h.name.trim()) {
                reqHeaderMap.set(h.name.trim().toLowerCase(), h.value);
              }
            }
            continueParams.headers = Array.from(reqHeaderMap.entries()).map(([name, value]) => ({
              name,
              value,
            }));
          }
          if (hasReqBody && match.override.requestBody) {
            continueParams.postData = NetworkOverridesStringToBase64Local(
              match.override.requestBody
            );
          }
          const doContinueReq = () => {
            chrome.debugger.sendCommand({ tabId }, 'Fetch.continueRequest', continueParams, () => {
              if (chrome.runtime.lastError) {
                proceed();
              }
            });
          };
          const delayMs = typeof match.override.delayMs === 'number' ? match.override.delayMs : 0;
          if (delayMs > 0) {
            setTimeout(doContinueReq, delayMs);
          } else {
            doContinueReq();
          }
          return;
        }
      } catch (error) {
        console.error(error);
      }

      proceed();
      return;
    }

    // Response stage
    console.log('[NetworkOverrides] Response:', url);

    try {
      recordApi(tabId, {
        url,
        type: params.resourceType || 'other',
        method: params.request?.method,
        headers: toFetchHeaders(params.request?.headers),
        postData: params.request?.postData,
        statusCode:
          typeof params.responseStatusCode === 'number' ? params.responseStatusCode : undefined,
      });

      const postData = params.request?.postData || state.recentApis.get(url)?.postData;
      const match = findOverride(params.request, state.overrides, postData);
      if (!match) {
        const resourceType = (params.resourceType || '').toLowerCase();
        if (shouldCaptureBody(resourceType)) {
          storeResponseBody(tabId, url, params.requestId, proceed);
        } else {
          proceed();
        }
        return;
      }

      // If the override has a failReason or redirectUrl, skip body fulfillment at response stage.
      // The redirect was already handled at request stage; the server's response
      // for the redirected URL should pass through without alteration.
      // Fail rules are consumed at the request stage; seeing one here means a stale pause.
      if (match.override.failReason || match.override.redirectUrl) {
        proceed();
        return;
      }

      answerWithBody(tabId, params, match, proceed);
    } catch (error) {
      console.error(error);
      proceed();
    }
  }
}
