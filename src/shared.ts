/// <reference types="chrome" />

declare namespace NetworkOverridesShared {
  type OverrideMode = 'text' | 'file';
  interface OverrideRule {
    pattern: string;
    body: string;
    mode: OverrideMode;
    redirectUrl?: string;
    enabled?: boolean; // undefined/true = enabled, false = disabled
    method?: string; // undefined/'ANY' = any method, or 'GET'|'POST'|'PUT'|'PATCH'|'DELETE'
    statusCode?: number; // integer 100–599; body rules only
    responseHeaders?: FetchHeader[]; // extra/override response headers; body rules only
    requestHeaders?: FetchHeader[]; // extra/override request headers; applied at request stage
    graphqlOperation?: string; // optional GraphQL operationName to match against request payload
    processTemplates?: boolean; // whether to process dynamic template tokens {{now}}, {{uuid}}, etc.
    delayMs?: number; // 0–120000 ms; body and fail rules
    failReason?: string; // presence makes this a fail rule (CDP Network.ErrorReason)
    isGlobal?: boolean; // applies across all domains if true
    requestBody?: string; // override outgoing request payload
  }
  interface RuleProfile {
    id: string;
    name: string;
    createdAt: number;
    rules: OverrideRule[];
  }
  interface OverrideState {
    enabled: boolean;
    overrides: OverrideRule[];
  }
  interface ApiEntry {
    url: string;
    type: string;
    method?: string;
    headers?: FetchHeader[];
    postData?: string;
    body?: string;
    statusCode?: number;
  }
  interface FetchHeader {
    name: string;
    value: string;
  }
}
