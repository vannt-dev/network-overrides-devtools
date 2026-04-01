import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackgroundContext, createUiContext } from './test-harness.mjs';

test('UI pattern matching supports wildcard, substring, and regex', () => {
  const { NetworkOverridesUi } = createUiContext();

  assert.equal(NetworkOverridesUi.patternMatches('*', 'https://example.com/api/users'), true);
  assert.equal(NetworkOverridesUi.patternMatches('all', 'https://example.com/api/users'), true);
  assert.equal(NetworkOverridesUi.patternMatches('api/users', 'https://example.com/api/users'), true);
  assert.equal(NetworkOverridesUi.patternMatches('/users$/', 'https://example.com/api/users'), true);
  assert.equal(NetworkOverridesUi.patternMatches('/users(/', 'https://example.com/api/users'), false);
});

test('UI helpers format API labels and normalize request types', () => {
  const { NetworkOverridesUi } = createUiContext();

  assert.equal(
    NetworkOverridesUi.formatApiLabel('data:application/json;base64,eyJvayI6dHJ1ZX0='),
    '[data URL: application/json;base64]',
  );
  assert.equal(NetworkOverridesUi.formatApiLabel('https://example.com/api/users'), 'https://example.com/api/users');
  assert.equal(NetworkOverridesUi.normalizeApiType('xmlhttprequest'), 'xhr');
  assert.equal(NetworkOverridesUi.normalizeApiType('fetch'), 'fetch');
});

test('UI helper pretty-prints valid JSON and preserves invalid JSON', () => {
  const { NetworkOverridesUi } = createUiContext();

  assert.equal(NetworkOverridesUi.formatJsonIfPossible('{"ok":true}'), '{\n  "ok": true\n}');
  assert.equal(NetworkOverridesUi.formatJsonIfPossible('{oops'), '{oops');
});

test('Background pattern matching supports regex and invalid regex safely', () => {
  const { NetworkOverridesBackground } = createBackgroundContext();

  assert.equal(NetworkOverridesBackground.patternMatches('/users$/', 'https://example.com/api/users'), true);
  assert.equal(NetworkOverridesBackground.patternMatches('example.com/api', 'https://example.com/api/users'), true);
  assert.equal(NetworkOverridesBackground.patternMatches('/users(/', 'https://example.com/api/users'), false);
});

test('Background normalizes base64 response bodies and preserves bad input', () => {
  const { NetworkOverridesBackground } = createBackgroundContext();

  assert.equal(NetworkOverridesBackground.normalizeBody('aGVsbG8=', true), 'hello');
  assert.equal(NetworkOverridesBackground.normalizeBody('%%%', true), '');
  assert.equal(NetworkOverridesBackground.normalizeBody('plain-text', false), 'plain-text');
});
