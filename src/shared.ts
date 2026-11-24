/*! SPDX-License-Identifier: MIT | Copyright (c) 2025 Van Nguyen | github.com/vannt-dev/network-overrides-devtools */
/// <reference types="chrome" />

declare namespace NetworkOverridesShared {
  // 'passthrough' keeps the real body (and status, unless the rule sets one): only headers change.
  type OverrideMode = 'text' | 'file' | 'script' | 'patch' | 'passthrough';
  type ThrottlePreset = 'none' | 'fast3g' | 'slow3g' | 'offline';
  type WsDirection = 'send' | 'receive' | 'both';
  type WsAction = 'replace' | 'substitute' | 'block' | 'delay';
  interface OverrideRule {
    pattern: string;
    body: string; // the response body; for mode 'script', the source of the function that returns it
    mode: OverrideMode; // 'patch' edits the real JSON response with `patch`; body stays ''
    patch?: PatchOperation[]; // mode 'patch': applied in order to the parsed real response
    redirectUrl?: string;
    enabled?: boolean; // undefined/true = enabled, false = disabled
    method?: string; // undefined/'ANY' = any method, or 'GET'|'POST'|'PUT'|'PATCH'|'DELETE'
    statusCode?: number; // integer 100–599; body rules only
    responseHeaders?: FetchHeader[]; // extra/override response headers; body rules only
    removeResponseHeaders?: string[]; // body rules: server headers to drop; a trailing * is a prefix
    responses?: ResponseVariant[]; // text/file body rules: other answers, one picked by weight
    weight?: number; // with `responses`: the weight of the rule's own answer; undefined = 1
    randomSeed?: number; // with `responses`: picks follow a repeatable order from this seed
    requestHeaders?: FetchHeader[]; // extra/override request headers; applied at request stage
    graphqlOperation?: string; // optional GraphQL operationName to match against request payload
    matchQuery?: MatchCondition[]; // every query parameter must be present (and equal, with a value)
    matchHeaders?: MatchCondition[]; // every request header must be present (and equal); names ignore case
    matchBody?: string; // the request body must contain this text; no body sent = no match
    processTemplates?: boolean; // whether to process dynamic template tokens {{now}}, {{uuid}}, etc.
    delayMs?: number; // 0–120000 ms; body and fail rules
    failReason?: string; // presence makes this a fail rule (CDP Network.ErrorReason)
    isGlobal?: boolean; // applies across all domains if true
    requestBody?: string; // override outgoing request payload
    respondAtRequest?: boolean; // body rules: answer at the request stage, the server is never called
    kind?: 'http' | 'websocket' | 'inject'; // undefined = 'http'
    fileName?: string; // body rules: the name of the local file the body was loaded from
    injectScript?: string; // inject rules: JavaScript added at the end of <body>
    injectStyle?: string; // inject rules: CSS added at the end of <head>
    relaxCsp?: boolean; // inject rules: drop the page's Content-Security-Policy; default off
    wsDirection?: WsDirection; // websocket rules; undefined = 'receive'
    wsMatch?: string; // websocket rules; empty/undefined = every text frame
    wsMatchRegex?: boolean; // wsMatch is a regular expression
    wsAction?: WsAction; // websocket rules
  }
  /** One more answer of a rule with weighted random responses; unset fields come from the rule. */
  interface ResponseVariant {
    weight: number; // integer 0–1000; 0 = never picked
    statusCode?: number;
    body: string; // text, with {{...}} filled in like the rule's own body
    responseHeaders?: FetchHeader[]; // merged over the rule's own response headers
  }
  /** A user-defined value written as {{name}} in rules. */
  interface RuleVariable {
    name: string;
    value: string;
  }
  interface RuleProfile {
    id: string;
    name: string;
    createdAt: number;
    rules: OverrideRule[];
  }
  /** How often a rule was applied in this session; never stored with the rule. */
  interface RuleHit {
    count: number;
    lastAt: number; // epoch ms of the last time the rule was applied
    lastUrl?: string; // the request it was last applied to; absent for WebSocket rules
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
  /** One change to the real JSON response; `path` is dot/bracket (`a.b[0]`) or a JSON Pointer. */
  interface PatchOperation {
    op: 'set' | 'remove';
    path: string;
    value?: unknown; // 'set' only: any JSON value
  }
  /** A request condition: a name alone asks for presence, a value asks for equality. */
  interface MatchCondition {
    name: string;
    value?: string;
  }
}
