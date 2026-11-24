/*! SPDX-License-Identifier: MIT | Copyright (c) 2025 Van Nguyen | github.com/vannt-dev/network-overrides-devtools */
/// <reference types="chrome" />
/// <reference path="../shared.ts" />
/// <reference path="../utils.ts" />
/// <reference path="../rule-values.ts" />
/// <reference path="../tab-state.ts" />
/// <reference path="./response-script.ts" />

namespace NetworkOverridesBackground {
  import TabState = NetworkOverridesTabState;

  type OverrideRule = NetworkOverridesShared.OverrideRule;
  type FetchHeader = NetworkOverridesShared.FetchHeader;
  type Variables = NetworkOverridesUtils.Variables;
  const Values = NetworkOverridesUtils;

  /** A rule that edits the real response, so it waits for it and never answers early. */
  function needsRealResponse(rule: OverrideRule): boolean {
    return rule.mode === 'patch' || rule.mode === 'passthrough';
  }

  /** The {{name}} values of a tab's rules. */
  function variablesOf(tabId: number): Variables {
    return TabState.get(tabId)?.variables || {};
  }

  /**
   * Which answer a rule with several responses gives now: 0 is the rule's own.
   * With a seed, the pick is the seed's number at the rule's hit count, so
   * the order goes on when the panel sends the same rules again or the
   * worker restarts, and starts over when the rule is edited or the counts
   * are reset.
   */
  function chooseResponse(tabId: number, rule: OverrideRule, hitKey: string | undefined): number {
    if (!Values.hasResponseVariants(rule)) return 0;
    let random = Math.random();
    if (typeof rule.randomSeed === 'number' && Number.isInteger(rule.randomSeed)) {
      const hits = hitKey === undefined ? 0 : TabState.get(tabId)?.ruleHits.get(hitKey)?.count;
      random = Values.seededNumber(rule.randomSeed, hits || 0);
    }
    return Values.pickWeighted(Values.responseWeights(rule), random);
  }

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
    postData?: string,
    resourceType?: string,
    variables: Variables = {}
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
      // An inject rule only rewrites the page itself, once its response is in.
      if (test.kind === 'inject' && resourceType !== 'Document') continue;
      if (!NetworkOverridesUtils.matchesMethod(test.method, method)) continue;
      if (!NetworkOverridesUtils.matchesGraphQLOperation(test.graphqlOperation, postData)) continue;
      if (!NetworkOverridesUtils.matchesRequestConditions(test, conditionRequest)) continue;
      const captures = matchPattern(Values.rulePattern(test, variables), url);
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
    overrides: OverrideRule[],
    variables: Variables
  ): OverrideRule | null {
    for (const rule of overrides) {
      if (rule.kind === 'websocket' || rule.kind === 'inject' || rule.enabled === false) continue;
      if (!NetworkOverridesUtils.matchesMethod(rule.method, method)) continue;
      if (!NetworkOverridesUtils.matchesQuery(rule.matchQuery, url)) continue;
      if (matchPattern(Values.rulePattern(rule, variables), url) !== null) return rule;
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

  /** How long a patch rule stays quiet after telling the panel it skipped something. */
  const PATCH_NOTICE_INTERVAL_MS = 10000;
  const lastPatchNotice = new Map<string, number>();

  /** Tells the open panels why a patch rule left a response (partly) unchanged. */
  function notifyPatchSkipped(tabId: number, pattern: string, url: string, reason: string): void {
    notifyRule(tabId, pattern, url, reason, 'patchRuleSkipped');
  }

  /** Tells the open panels something about a rule, at most once per interval. */
  function notifyRule(
    tabId: number,
    pattern: string,
    url: string,
    reason: string,
    type: 'patchRuleSkipped' | 'injectRuleNotice' | 'headersRuleSkipped',
    code?: 'csp' | 'charset'
  ): void {
    console.warn('[NetworkOverrides] Rule', pattern, 'on', url, '—', reason);
    // A rule on a busy endpoint would repeat the same notice for every request.
    const key = `${tabId} ${type} ${pattern}`;
    const now = Date.now();
    const last = lastPatchNotice.get(key);
    if (last !== undefined && now - last < PATCH_NOTICE_INTERVAL_MS) return;
    lastPatchNotice.set(key, now);
    const message = { type, tabId, pattern, url, message: reason, code };
    TabState.runtime(tabId).subscriberPorts.forEach(port => {
      try {
        port.postMessage(message);
      } catch {}
    });
  }

  /** The real response body as text, or null when Chrome has none to give. */
  function readResponseText(
    tabId: number,
    requestId: string,
    done: (text: string | null) => void
  ): void {
    chrome.debugger.sendCommand(
      { tabId },
      'Fetch.getResponseBody',
      { requestId },
      (response: { body?: string; base64Encoded?: boolean } | undefined) => {
        if (chrome.runtime.lastError || !response || typeof response.body !== 'string') {
          done(null);
          return;
        }
        done(NetworkOverridesNormalizeBodyLocal(response.body, response.base64Encoded ?? false));
      }
    );
  }

  /** The real response body as base64, as Chrome has it, or null when there is none to give. */
  function readResponseBase64(
    tabId: number,
    requestId: string,
    done: (base64: string | null) => void
  ): void {
    chrome.debugger.sendCommand(
      { tabId },
      'Fetch.getResponseBody',
      { requestId },
      (response: { body?: string; base64Encoded?: boolean } | undefined) => {
        if (chrome.runtime.lastError || !response || typeof response.body !== 'string') {
          done(null);
          return;
        }
        done(
          response.base64Encoded
            ? response.body
            : NetworkOverridesStringToBase64Local(response.body)
        );
      }
    );
  }

  /** Applies a patch rule's operations to a response body, when it is JSON. */
  function patchResponseText(
    text: string | null,
    operations: NetworkOverridesShared.PatchOperation[]
  ): { ok: true; body: string; skipped: string[] } | { ok: false; reason: string } {
    if (text === null || !text.trim()) {
      return { ok: false, reason: 'the response has no body, so it was passed through unchanged' };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text.replace(/^\uFEFF/, ''));
    } catch {
      return { ok: false, reason: 'the response is not JSON, so it was passed through unchanged' };
    }
    const result = NetworkOverridesUtils.applyJsonPatch(parsed, operations);
    return { ok: true, body: JSON.stringify(result.value), skipped: result.skipped };
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
    // Looked up now: the rules may be replaced while a delay, a patch or a
    // script holds the answer back.
    const hitKey = TabState.ruleHitKey(tabId, ov);
    const variables = variablesOf(tabId);
    const templates = ov.processTemplates !== false;
    // A rule with several responses gives one of them, picked by weight.
    const choice = chooseResponse(tabId, ov, hitKey);
    const variant = choice > 0 ? ov.responses?.[choice - 1] || null : null;

    function bodyToValidBase64(): string {
      if (variant) {
        const text = typeof variant.body === 'string' ? variant.body : '';
        return NetworkOverridesStringToBase64Local(
          Values.fillBodyText(text, variables, templates, captures, url)
        );
      }
      const rawBody = ov.body || '';
      const processedBody =
        ov.mode !== 'file'
          ? Values.fillBodyText(rawBody, variables, templates, captures, url)
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
        'x-network-overrides-response',
      ]);
      // Headers the rule removes go first, so the rule can still set its own value.
      const headers = Values.withoutHeaders(
        ((params.responseHeaders as FetchHeader[]) || []).filter(
          header => !bodyDependentHeaders.has(header.name.toLowerCase().trim())
        ),
        ov.removeResponseHeaders
      );
      const mergeHeaders = (extras: FetchHeader[] | undefined) => {
        if (!Array.isArray(extras)) return;
        for (const extra of extras) {
          if (!extra || typeof extra.name !== 'string' || !extra.name.trim()) continue;
          // Skip rule headers that conflict with marker headers; markers always win.
          const trimmedLowerName = extra.name.toLowerCase().trim();
          if (
            trimmedLowerName === 'x-network-overrides' ||
            trimmedLowerName === 'x-network-overrides-pattern' ||
            trimmedLowerName === 'x-network-overrides-response'
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
      mergeHeaders(Values.fillHeaderValues(ov.responseHeaders, variables));
      // The picked response's own headers are more specific than the rule's.
      if (variant) mergeHeaders(Values.fillHeaderValues(variant.responseHeaders, variables));
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
        // A replaced script, stylesheet or image needs its own type, or the
        // browser refuses it; anything else keeps the JSON default.
        headers.push({
          name: 'Content-Type',
          value: NetworkOverridesUtils.guessContentType(url) || 'application/json; charset=utf-8',
        });
      }

      // The markers always win and cannot be removed by rule headers.
      headers.push({ name: 'x-network-overrides', value: 'true' });
      headers.push({ name: 'x-network-overrides-pattern', value: ov.pattern });
      // Which answer a rule with several responses gave: 1 is the rule's own.
      if (Values.hasResponseVariants(ov)) {
        headers.push({ name: 'x-network-overrides-response', value: String(choice + 1) });
      }

      // A file loaded from disk replaces the server's file, whatever the
      // server answered (a 404 would stop the browser from using it).
      const fallbackCode = ov.fileName
        ? 200
        : typeof params.responseStatusCode === 'number' &&
            params.responseStatusCode >= 100 &&
            params.responseStatusCode <= 599
          ? params.responseStatusCode
          : 200;
      const wantedCode =
        variant && typeof variant.statusCode === 'number' ? variant.statusCode : ov.statusCode;
      const ruleCode =
        typeof wantedCode === 'number' && wantedCode >= 100 && wantedCode <= 599
          ? wantedCode
          : fallbackCode;
      const responseCode =
        typeof scripted?.statusCode === 'number' ? scripted.statusCode : ruleCode;

      TabState.recordOverrideStat(tabId, false);
      TabState.recordRuleHit(tabId, hitKey, url);
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

    // A pass-through rule keeps the real body and changes only the status
    // and headers, so it waits for the body to hand it back as it came.
    if (ov.mode === 'passthrough') {
      readResponseBase64(tabId, params.requestId, body => {
        try {
          if (body === null) {
            notifyRule(
              tabId,
              ov.pattern,
              url,
              'the real response body could not be read, so the response was passed through unchanged',
              'headersRuleSkipped'
            );
            proceed();
            return;
          }
          fulfill(body);
        } catch (error) {
          console.error(error);
          proceed();
        }
      });
      return;
    }
    // A patch rule edits the real response, so it waits for its body.
    if (ov.mode === 'patch') {
      readResponseText(tabId, params.requestId, text => {
        try {
          const outcome = patchResponseText(text, ov.patch || []);
          if (!outcome.ok) {
            // Passed through untouched: the rule had nothing it could change.
            notifyPatchSkipped(tabId, ov.pattern, url, outcome.reason);
            proceed();
            return;
          }
          if (outcome.skipped.length > 0) {
            notifyPatchSkipped(tabId, ov.pattern, url, outcome.skipped.join('; '));
          }
          fulfill(NetworkOverridesStringToBase64Local(outcome.body));
        } catch (error) {
          console.error(error);
          proceed();
        }
      });
      return;
    }
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

  /** The CSP headers an inject rule adds its hashes to, or removes when it relaxes the policy. */
  const CSP_HEADERS = new Set(['content-security-policy', 'content-security-policy-report-only']);

  /** Headers that describe the bytes of the server's body, which a rewrite changes. */
  const REWRITE_DROPPED_HEADERS = new Set([
    'content-encoding',
    'content-length',
    'content-md5',
    'content-range',
    'digest',
    'transfer-encoding',
    'trailer',
    'x-network-overrides',
    'x-network-overrides-pattern',
    'x-network-overrides-response',
  ]);

  /** The real response body decoded as UTF-8, or null when it is missing or not UTF-8. */
  function readUtf8Body(tabId: number, requestId: string, done: (text: string | null) => void) {
    chrome.debugger.sendCommand(
      { tabId },
      'Fetch.getResponseBody',
      { requestId },
      (response: { body?: string; base64Encoded?: boolean } | undefined) => {
        if (chrome.runtime.lastError || !response || typeof response.body !== 'string') {
          done(null);
          return;
        }
        if (!response.base64Encoded) {
          done(response.body);
          return;
        }
        try {
          const bytes = Uint8Array.from(atob(response.body), char => char.charCodeAt(0));
          // ignoreBOM keeps a byte order mark, which may be how the page says it is UTF-8.
          done(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes));
        } catch {
          done(null);
        }
      }
    );
  }

  /**
   * Adds an inject rule's script and stylesheet to an HTML page: the real
   * response is read, rewritten and handed to the page with the server's
   * status and headers. Anything that is not a successful HTML page in UTF-8
   * passes through untouched. The page's Content-Security-Policy is kept,
   * with the hashes of the injected code added where it would stop inline
   * code, so only that code is let through. A rule set to relax the policy
   * removes it instead. The panel is told when a sandbox still stops scripts.
   */
  function answerWithInjection(
    tabId: number,
    params: any,
    rule: OverrideRule,
    proceed: () => void
  ): void {
    const url = params.request?.url || '';
    const status = params.responseStatusCode;
    const serverHeaders: FetchHeader[] = Array.isArray(params.responseHeaders)
      ? params.responseHeaders
      : [];
    const headerOf = (name: string) =>
      serverHeaders.find(header => String(header.name).toLowerCase() === name)?.value;
    const contentType = String(headerOf('content-type') || '');
    if (typeof status !== 'number' || status < 200 || status > 299 || !/html/i.test(contentType)) {
      proceed();
      return;
    }
    const notUtf8 = 'the page is not UTF-8, so nothing was injected';
    const charset = /charset\s*=\s*"?([^";\s]+)/i.exec(contentType)?.[1]?.toLowerCase();
    if (charset && charset !== 'utf-8' && charset !== 'utf8') {
      notifyRule(tabId, rule.pattern, url, notUtf8, 'injectRuleNotice', 'charset');
      proceed();
      return;
    }
    const hitKey = TabState.ruleHitKey(tabId, rule);
    readUtf8Body(tabId, params.requestId, text => {
      void fulfillInjected(text);
    });

    async function fulfillInjected(text: string | null): Promise<void> {
      try {
        if (text === null) {
          notifyRule(tabId, rule.pattern, url, notUtf8, 'injectRuleNotice', 'charset');
          proceed();
          return;
        }
        const relax = rule.relaxCsp === true;
        const code = NetworkOverridesUtils.injectedCode({
          script: rule.injectScript,
          style: rule.injectStyle,
        });
        const policies = serverHeaders
          .filter(header => String(header.name).toLowerCase().trim() === 'content-security-policy')
          .map(header => String(header.value))
          .concat(NetworkOverridesUtils.cspMetaPolicies(text));
        const hasCsp =
          policies.length > 0 ||
          serverHeaders.some(header => CSP_HEADERS.has(String(header.name).toLowerCase().trim()));
        const hashes =
          !relax && hasCsp
            ? {
                script: code.script ? await NetworkOverridesUtils.sha256Base64(code.script) : '',
                style: code.style ? await NetworkOverridesUtils.sha256Base64(code.style) : '',
              }
            : {};
        const page = relax
          ? NetworkOverridesUtils.removeCspMeta(text)
          : hasCsp
            ? NetworkOverridesUtils.allowHashesInCspMeta(text, hashes)
            : text;
        const html = NetworkOverridesUtils.injectIntoHtml(page, {
          script: rule.injectScript,
          style: rule.injectStyle,
        });
        const headers = serverHeaders
          .filter(header => {
            const name = String(header.name).toLowerCase().trim();
            return !REWRITE_DROPPED_HEADERS.has(name) && !(relax && CSP_HEADERS.has(name));
          })
          .map(header => {
            const name = String(header.name).toLowerCase().trim();
            const value = String(header.value);
            return {
              name: header.name,
              value: CSP_HEADERS.has(name)
                ? NetworkOverridesUtils.allowHashesInCsp(value, hashes)
                : value,
            };
          });
        headers.push({ name: 'x-network-overrides', value: 'true' });
        headers.push({ name: 'x-network-overrides-pattern', value: rule.pattern });
        const headerPolicies = serverHeaders
          .filter(header => String(header.name).toLowerCase().trim() === 'content-security-policy')
          .map(header => String(header.value));
        if (
          !relax &&
          code.script &&
          NetworkOverridesUtils.cspSandboxBlocksScripts(headerPolicies)
        ) {
          notifyRule(
            tabId,
            rule.pattern,
            url,
            "the page's Content-Security-Policy sandbox stops all scripts, so the injected script will not run",
            'injectRuleNotice',
            'csp'
          );
        }
        TabState.recordOverrideStat(tabId, false);
        TabState.recordRuleHit(tabId, hitKey, url);
        chrome.debugger.sendCommand(
          { tabId },
          'Fetch.fulfillRequest',
          {
            requestId: params.requestId,
            responseCode: status,
            responseHeaders: headers,
            body: NetworkOverridesStringToBase64Local(html),
          },
          () => {
            if (chrome.runtime.lastError) {
              console.error('fulfillRequest (inject) failed:', chrome.runtime.lastError.message);
              proceed();
            }
          }
        );
      } catch (error) {
        console.error(error);
        proceed();
      }
    }
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
        const match = findOverride(
          params.request,
          state.overrides,
          postData,
          undefined,
          state.variables
        );
        // The preflight of a request that will be answered without the server
        // is answered too, unless a rule is written for OPTIONS itself.
        const askedMethod = preflightMethod(params.request);
        const optionsRule = match?.override.method?.toUpperCase() === 'OPTIONS';
        if (askedMethod && !optionsRule) {
          const target = findPreflightTarget(url, askedMethod, state.overrides, state.variables);
          if (
            target?.respondAtRequest &&
            !needsRealResponse(target) &&
            !target.failReason &&
            !target.redirectUrl
          ) {
            answerPreflight(tabId, params, askedMethod, proceed);
            return;
          }
        }
        if (match && match.override.failReason) {
          TabState.recordOverrideStat(tabId, true);
          TabState.recordRuleHit(tabId, TabState.ruleHitKey(tabId, match.override), url);
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
          const newUrl = substituteWildcards(
            Values.fillVariables(match.override.redirectUrl, state.variables),
            match.captures
          );
          if (newUrl.includes('*')) {
            console.error('[NetworkOverrides] Unsubstituted * in redirect URL:', newUrl);
            proceed();
            return;
          }
          console.log('[NetworkOverrides] Redirect:', url, '→', newUrl);
          TabState.recordRuleHit(tabId, TabState.ruleHitKey(tabId, match.override), url);
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
        // now, so the request never leaves the browser. A patch or
        // pass-through rule needs the real response, so it never answers here.
        if (
          match &&
          match.override.respondAtRequest &&
          !needsRealResponse(match.override) &&
          (!askedMethod || optionsRule)
        ) {
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
                reqHeaderMap.set(
                  h.name.trim().toLowerCase(),
                  Values.fillVariables(h.value, state.variables)
                );
              }
            }
            continueParams.headers = Array.from(reqHeaderMap.entries()).map(([name, value]) => ({
              name,
              value,
            }));
          }
          if (hasReqBody && match.override.requestBody) {
            continueParams.postData = NetworkOverridesStringToBase64Local(
              Values.fillVariables(match.override.requestBody, state.variables)
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
      const match = findOverride(
        params.request,
        state.overrides,
        postData,
        params.resourceType,
        state.variables
      );
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

      if (match.override.kind === 'inject') {
        answerWithInjection(tabId, params, match.override, proceed);
        return;
      }

      answerWithBody(tabId, params, match, proceed);
    } catch (error) {
      console.error(error);
      proceed();
    }
  }
}
