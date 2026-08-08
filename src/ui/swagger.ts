/// <reference path="./types.ts" />

namespace NetworkOverridesUi {
  export function parseSwaggerToRules(content: string): OverrideRule[] {
    const trimmed = content.trim();
    if (!trimmed) return [];

    let parsed: any;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      // Simple fallback JSON/YAML keys check
      return [];
    }

    if (!parsed || typeof parsed !== 'object') return [];
    if (!parsed.paths || typeof parsed.paths !== 'object') return [];

    const rules: OverrideRule[] = [];
    const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head'];

    for (const [path, pathObj] of Object.entries(parsed.paths)) {
      if (!pathObj || typeof pathObj !== 'object') continue;

      for (const [method, opObj] of Object.entries(pathObj as Record<string, any>)) {
        if (!HTTP_METHODS.includes(method.toLowerCase())) continue;
        if (!opObj || typeof opObj !== 'object') continue;

        let mockBody: string | undefined;

        // Try extracting response example from OpenAPI 3 or Swagger 2
        const responses = opObj.responses;
        if (responses && typeof responses === 'object') {
          const successResp = responses['200'] || responses['201'] || responses['default'];
          if (successResp) {
            // OpenAPI 3.0 content schema
            if (successResp.content && typeof successResp.content === 'object') {
              const jsonContent =
                successResp.content['application/json'] || Object.values(successResp.content)[0];
              if (jsonContent?.example) {
                mockBody =
                  typeof jsonContent.example === 'string'
                    ? jsonContent.example
                    : JSON.stringify(jsonContent.example, null, 2);
              } else if (jsonContent?.examples) {
                const ex = Object.values(jsonContent.examples)[0] as any;
                if (ex?.value) {
                  mockBody =
                    typeof ex.value === 'string' ? ex.value : JSON.stringify(ex.value, null, 2);
                }
              }
            }
            // Swagger 2.0 examples
            else if (successResp.examples && typeof successResp.examples === 'object') {
              const jsonEx = successResp.examples['application/json'];
              if (jsonEx) {
                mockBody = typeof jsonEx === 'string' ? jsonEx : JSON.stringify(jsonEx, null, 2);
              }
            }
          }
        }

        if (!mockBody) {
          mockBody = JSON.stringify(
            { message: `Mocked response for ${method.toUpperCase()} ${path}` },
            null,
            2
          );
        }

        // Convert path template parameters e.g. /users/{id} -> /users/*
        const globPattern = path.replace(/\{[^}]+\}/g, '*');

        rules.push({
          pattern: globPattern,
          method: method.toUpperCase(),
          mode: 'text',
          body: mockBody,
        });
      }
    }

    return rules;
  }
}
