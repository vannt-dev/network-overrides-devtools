/// <reference path="./types.ts" />

namespace NetworkOverridesUi {
  export function generateCurlCommand(api: {
    url: string;
    method?: string;
    headers?: HeaderField[];
    postData?: string;
  }): string {
    const method = (api.method || 'GET').toUpperCase();
    const parts = ['curl'];

    if (method !== 'GET') {
      parts.push(`-X ${method}`);
    }

    parts.push(`"${api.url.replace(/"/g, '\\"')}"`);

    if (Array.isArray(api.headers)) {
      for (const h of api.headers) {
        if (!h.name) continue;
        parts.push(`-H "${h.name}: ${h.value.replace(/"/g, '\\"')}"`);
      }
    }

    if (api.postData) {
      parts.push(`--data-raw '${api.postData.replace(/'/g, "'\\''")}'`);
    }

    return parts.join(' \\\n  ');
  }

  export function parseCurlToRule(curlStr: string): OverrideRule | null {
    const trimmed = curlStr.trim();
    if (!trimmed || !/^curl/i.test(trimmed)) return null;

    let method = 'ANY';
    let url = '';
    const requestHeaders: HeaderField[] = [];
    let body: string | undefined;

    // Simple shell tokenizer for quotes and args
    const tokens: string[] = [];
    let current = '';
    let inSingle = false;
    let inDouble = false;
    let escaped = false;

    for (let i = 0; i < trimmed.length; i++) {
      const char = trimmed[i];
      if (escaped) {
        current += char;
        escaped = false;
        continue;
      }
      if (char === '\\' && !inSingle) {
        escaped = true;
        continue;
      }
      if (char === "'" && !inDouble) {
        inSingle = !inSingle;
        continue;
      }
      if (char === '"' && !inSingle) {
        inDouble = !inDouble;
        continue;
      }
      if (/\s/.test(char) && !inSingle && !inDouble) {
        if (current) {
          tokens.push(current);
          current = '';
        }
        continue;
      }
      current += char;
    }
    if (current) tokens.push(current);

    for (let i = 1; i < tokens.length; i++) {
      const token = tokens[i];
      if (token === '-X' || token === '--request') {
        method = (tokens[i + 1] || 'ANY').toUpperCase();
        i++;
      } else if (token === '-H' || token === '--header') {
        const headerLine = tokens[i + 1] || '';
        const colonIdx = headerLine.indexOf(':');
        if (colonIdx > 0) {
          requestHeaders.push({
            name: headerLine.slice(0, colonIdx).trim(),
            value: headerLine.slice(colonIdx + 1).trim(),
          });
        }
        i++;
      } else if (
        token === '-d' ||
        token === '--data' ||
        token === '--data-raw' ||
        token === '--data-binary'
      ) {
        body = tokens[i + 1];
        if (method === 'ANY') method = 'POST';
        i++;
      } else if (token.startsWith('http://') || token.startsWith('https://')) {
        url = token;
      }
    }

    if (!url) return null;

    // Convert full URL to pattern (e.g. pathname)
    let pattern = url;
    try {
      const parsedUrl = new URL(url);
      pattern = parsedUrl.pathname + parsedUrl.search;
    } catch {}

    const rule: OverrideRule = {
      pattern,
      mode: 'text',
      body: body !== undefined ? body : '',
      method: method !== 'ANY' ? method : undefined,
    };

    if (requestHeaders.length > 0) rule.requestHeaders = requestHeaders;

    return rule;
  }
}
