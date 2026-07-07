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
