/// <reference path="./types.ts" />

namespace NetworkOverridesUi {
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
