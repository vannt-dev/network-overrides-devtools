/// <reference path="./types.ts" />

namespace NetworkOverridesUi {
  const HAR_MIME_BY_TYPE: Record<string, string> = {
    document: 'text/html',
    script: 'application/javascript',
    stylesheet: 'text/css',
  };

  function isJson(text: string): boolean {
    try {
      JSON.parse(text);
      return true;
    } catch {
      return false;
    }
  }

  function headerValue(headers: HeaderField[] | undefined, name: string): string {
    const found = headers?.find(header => header.name.toLowerCase() === name);
    return found ? found.value : '';
  }

  function harQueryString(url: string): Array<{ name: string; value: string }> {
    const pairs: Array<{ name: string; value: string }> = [];
    try {
      new URL(url).searchParams.forEach((value, name) => pairs.push({ name, value }));
    } catch {
      // Not an absolute URL (a hand-added pattern, for one): no query to list.
    }
    return pairs;
  }

  /**
   * Builds a HAR 1.2 log from the captured request list.
   *
   * The capture keeps the request line, request headers, request payload,
   * response status and (for the captured resource types) the response body.
   * It does not keep response headers or timings, so those are written as
   * empty or zero and the log says so in its comment; a HAR viewer will show
   * every request as starting at the moment of the export.
   */
  export function buildHar(
    apis: UiApi[],
    options: { creatorVersion: string; exportedAt: Date }
  ): Record<string, unknown> {
    const startedDateTime = options.exportedAt.toISOString();
    const entries = apis.map(api => {
      const requestHeaders = (api.headers || []).map(header => ({
        name: header.name,
        value: header.value,
      }));
      const hasBody = typeof api.body === 'string';
      const body = hasBody ? (api.body as string) : '';
      const type = normalizeApiType(api.type);
      const mimeType = !hasBody
        ? ''
        : HAR_MIME_BY_TYPE[type] || (isJson(body) ? 'application/json' : 'text/plain');
      const request: Record<string, unknown> = {
        method: (api.method || 'GET').toUpperCase(),
        url: api.url,
        httpVersion: '',
        cookies: [],
        headers: requestHeaders,
        queryString: harQueryString(api.url),
        headersSize: -1,
        bodySize: typeof api.postData === 'string' ? api.postData.length : 0,
      };
      if (typeof api.postData === 'string' && api.postData) {
        request.postData = {
          mimeType: headerValue(api.headers, 'content-type'),
          text: api.postData,
        };
      }
      return {
        startedDateTime,
        time: 0,
        request,
        response: {
          status: typeof api.statusCode === 'number' ? api.statusCode : 0,
          statusText: '',
          httpVersion: '',
          cookies: [],
          headers: [],
          content: hasBody
            ? { size: body.length, mimeType, text: body }
            : { size: 0, mimeType, comment: 'Response body was not captured.' },
          redirectURL: '',
          headersSize: -1,
          bodySize: -1,
        },
        cache: {},
        timings: { send: 0, wait: 0, receive: 0 },
        _resourceType: type,
      };
    });
    return {
      log: {
        version: '1.2',
        creator: { name: 'Network Overrides DevTools', version: options.creatorVersion },
        pages: [],
        entries,
        comment:
          'Exported from the captured request list. Response headers and timings are not recorded; ' +
          'startedDateTime is the time of the export.',
      },
    };
  }

  export function parseHarToRules(content: string): OverrideRule[] {
    const trimmed = content.trim();
    if (!trimmed) return [];

    let parsed: any;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return [];
    }

    if (!parsed || typeof parsed !== 'object') return [];
    const entries = parsed.log?.entries;
    if (!Array.isArray(entries)) return [];

    const rules: OverrideRule[] = [];

    for (const entry of entries) {
      if (!entry || typeof entry !== 'object') continue;
      const request = entry.request;
      const response = entry.response;
      if (!request || typeof request.url !== 'string') continue;

      const url = request.url;
      const method = typeof request.method === 'string' ? request.method.toUpperCase() : 'ANY';
      const statusCode = typeof response?.status === 'number' ? response.status : undefined;
      const text = response?.content?.text;
      const isBase64 = Boolean(response?.content?.encoding === 'base64');

      let body = '';
      if (typeof text === 'string') {
        if (isBase64) {
          try {
            body = atob(text);
          } catch {
            body = text;
          }
        } else {
          body = text;
        }
      }

      rules.push({
        pattern: url,
        method: method !== 'ANY' ? method : undefined,
        mode: 'text',
        body,
        statusCode: statusCode && statusCode >= 100 && statusCode <= 599 ? statusCode : undefined,
      });
    }

    return rules;
  }
}
