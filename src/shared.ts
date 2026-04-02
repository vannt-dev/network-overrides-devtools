/// <reference types="chrome" />

namespace NetworkOverridesShared {
  export type OverrideMode = 'text' | 'file';

  export interface OverrideRule {
    pattern: string;
    body: string;
    mode: OverrideMode;
  }

  export interface OverrideState {
    enabled: boolean;
    overrides: OverrideRule[];
  }

  export interface ApiEntry {
    url: string;
    type: string;
    method?: string;
    headers?: FetchHeader[];
    postData?: string;
  }

  export interface FetchHeader {
    name: string;
    value: string;
  }
}
