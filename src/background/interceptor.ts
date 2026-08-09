/// <reference types="chrome" />
/// <reference path="../shared.ts" />
/// <reference path="../utils.ts" />
/// <reference path="../tab-state.ts" />

namespace NetworkOverridesBackground {
  import TabState = NetworkOverridesTabState;

  type OverrideRule = NetworkOverridesShared.OverrideRule;
  type FetchHeader = NetworkOverridesShared.FetchHeader;

  function findOverride(
    url: string,
    method: string | undefined,
    overrides: OverrideRule[],
    postData?: string
  ): { override: OverrideRule; captures: string[] } | null {
    for (const test of overrides) {
      if (test.enabled === false) continue;
      if (!NetworkOverridesUtils.matchesMethod(test.method, method)) continue;
      if (!NetworkOverridesUtils.matchesGraphQLOperation(test.graphqlOperation, postData)) continue;
      const captures = matchPattern(test.pattern, url);
      if (captures !== null) {
        return { override: test, captures };
      }
    }
    return null;
  }

  export function handleRequestPaused(tabId: number, params: any): void {
    const isRequestStage = typeof params.responseStatusCode !== 'number';
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
        const match = findOverride(url, params.request?.method, state.overrides, postData);
        if (match && match.override.failReason) {
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
        if (
          match &&
          Array.isArray(match.override.requestHeaders) &&
          match.override.requestHeaders.length > 0
        ) {
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
          const updatedHeaders = Array.from(reqHeaderMap.entries()).map(([name, value]) => ({
            name,
            value,
          }));
          const doContinue = () => {
            chrome.debugger.sendCommand(
              { tabId },
              'Fetch.continueRequest',
              { requestId: params.requestId, headers: updatedHeaders },
              () => {
                if (chrome.runtime.lastError) {
                  proceed();
                }
              }
            );
          };
          const delayMs = typeof match.override.delayMs === 'number' ? match.override.delayMs : 0;
          if (delayMs > 0) {
            setTimeout(doContinue, delayMs);
          } else {
            doContinue();
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
      const match = findOverride(url, params.request?.method, state.overrides, postData);
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

      console.log('[NetworkOverrides] Fulfill body:', match.override.pattern, '→', url);

      const ov = match.override;
      const captures = match.captures;

      function bodyToValidBase64(): string {
        const rawBody = ov.body || '';
        const processedBody =
          ov.mode !== 'file'
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

      const responseBodyBase64 = bodyToValidBase64();

      const headers = [...((params.responseHeaders as FetchHeader[]) || [])];
      if (Array.isArray(ov.responseHeaders)) {
        for (const extra of ov.responseHeaders) {
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
      const responseCode =
        typeof ov.statusCode === 'number' && ov.statusCode >= 100 && ov.statusCode <= 599
          ? ov.statusCode
          : fallbackCode;

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
    } catch (error) {
      console.error(error);
      proceed();
    }
  }
}
