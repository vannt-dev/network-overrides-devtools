/// <reference types="chrome" />
/// <reference path="./shared.ts" />
/// <reference path="./utils.ts" />
/// <reference path="./tab-state.ts" />
declare function importScripts(...urls: string[]): void;

// The service worker is a small bootstrap; each classic script owns one
// background responsibility and contributes to the shared namespace.
importScripts(
  'utils.js',
  'tab-state.js',
  'background/encoding.js',
  'background/api-capture.js',
  'background/interceptor.js',
  'background/debugger-controller.js',
  'background/message-router.js'
);
