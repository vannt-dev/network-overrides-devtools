import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackgroundContext, createUiContext } from './test-harness.mjs';

test('UI pattern matching supports wildcard, substring, and regex', () => {
  const { NetworkOverridesUi } = createUiContext();

  assert.equal(NetworkOverridesUi.patternMatches('*', 'https://example.com/api/users'), true);
  assert.equal(NetworkOverridesUi.patternMatches('all', 'https://example.com/api/users'), true);
  assert.equal(
    NetworkOverridesUi.patternMatches('api/users', 'https://example.com/api/users'),
    true
  );
  assert.equal(
    NetworkOverridesUi.patternMatches('/users$/', 'https://example.com/api/users'),
    true
  );
  assert.equal(
    NetworkOverridesUi.patternMatches('/users(/', 'https://example.com/api/users'),
    false
  );
});

test('UI glob pattern matching with * wildcards', () => {
  const { NetworkOverridesUi } = createUiContext();

  assert.equal(
    NetworkOverridesUi.patternMatches(
      'https://old.com/api/*/users',
      'https://old.com/api/v1/users'
    ),
    true
  );
  assert.equal(
    NetworkOverridesUi.patternMatches(
      'https://old.com/api/*/users',
      'https://old.com/api/v2/users'
    ),
    true
  );
  assert.equal(
    NetworkOverridesUi.patternMatches(
      'https://old.com/api/*/users',
      'https://old.com/api/v1/admin'
    ),
    false
  );
  assert.equal(
    NetworkOverridesUi.patternMatches('*/api/users', 'https://example.com/api/users'),
    true
  );
  assert.equal(
    NetworkOverridesUi.patternMatches(
      'https://example.com/api/*',
      'https://example.com/api/users/123'
    ),
    true
  );
  assert.equal(
    NetworkOverridesUi.patternMatches('*://example.com/*', 'https://example.com/api/users'),
    true
  );
});

test('UI matchPattern captures wildcard segments', () => {
  const { NetworkOverridesUi } = createUiContext();

  assert.equal(NetworkOverridesUi.matchPattern('*', 'https://example.com/api/users')?.length, 0);
  assert.equal(NetworkOverridesUi.matchPattern('all', 'https://example.com/api/users')?.length, 0);
  assert.equal(
    NetworkOverridesUi.matchPattern('api/users', 'https://example.com/api/users')?.length,
    0
  );
  assert.equal(
    NetworkOverridesUi.matchPattern(
      'https://old.com/api/*/users',
      'https://old.com/api/v1/users'
    )?.[0],
    'v1'
  );
  assert.equal(
    NetworkOverridesUi.matchPattern('*://example.com/*', 'https://example.com/api/users')?.[1],
    'api/users'
  );
  assert.equal(
    NetworkOverridesUi.matchPattern('/users$/', 'https://example.com/api/users')?.length,
    0
  );
  assert.equal(
    NetworkOverridesUi.matchPattern('nonexistent', 'https://example.com/api/users'),
    null
  );
});

test('UI helpers format API labels and normalize request types', () => {
  const { NetworkOverridesUi } = createUiContext();

  assert.equal(
    NetworkOverridesUi.formatApiLabel('data:application/json;base64,eyJvayI6dHJ1ZX0='),
    '[data URL: application/json;base64]'
  );
  assert.equal(
    NetworkOverridesUi.formatApiLabel('https://example.com/api/users'),
    'https://example.com/api/users'
  );
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

  assert.equal(
    NetworkOverridesBackground.patternMatches('/users$/', 'https://example.com/api/users'),
    true
  );
  assert.equal(
    NetworkOverridesBackground.patternMatches('example.com/api', 'https://example.com/api/users'),
    true
  );
  assert.equal(
    NetworkOverridesBackground.patternMatches('/users(/', 'https://example.com/api/users'),
    false
  );
});

test('Background normalizes base64 response bodies and preserves bad input', () => {
  const { NetworkOverridesBackground } = createBackgroundContext();

  assert.equal(NetworkOverridesBackground.normalizeBody('aGVsbG8=', true), 'hello');
  assert.equal(NetworkOverridesBackground.normalizeBody('%%%', true), '');
  assert.equal(NetworkOverridesBackground.normalizeBody('plain-text', false), 'plain-text');
});

test('matchesMethod matches ANY/undefined and is case-insensitive', () => {
  const { NetworkOverridesUtils } = createUiContext();

  assert.equal(NetworkOverridesUtils.matchesMethod(undefined, 'GET'), true);
  assert.equal(NetworkOverridesUtils.matchesMethod('ANY', 'POST'), true);
  assert.equal(NetworkOverridesUtils.matchesMethod('get', 'GET'), true);
  assert.equal(NetworkOverridesUtils.matchesMethod('GET', 'get'), true);
  assert.equal(NetworkOverridesUtils.matchesMethod('POST', 'GET'), false);
  assert.equal(NetworkOverridesUtils.matchesMethod('POST', undefined), false);
});

test('substituteWildcards does not re-substitute * inside captured values', () => {
  const { NetworkOverridesUi } = createUiContext();
  const result = NetworkOverridesUi.substituteWildcards('https://new.test/*/x/*', [
    'a*b',
    'second',
  ]);
  assert.equal(result, 'https://new.test/a*b/x/second');
});

test('substituteWildcards keeps leftover * literal when captures run out', () => {
  const { NetworkOverridesUi } = createUiContext();
  const result = NetworkOverridesUi.substituteWildcards('https://new.test/*/x/*', ['only']);
  assert.equal(result, 'https://new.test/only/x/*');
});

test('glob * matches the empty string', () => {
  const { NetworkOverridesUi } = createUiContext();
  assert.equal(
    NetworkOverridesUi.matchPattern('https://a.test/api/*', 'https://a.test/api/')?.[0],
    ''
  );
  assert.equal(
    NetworkOverridesUi.patternMatches('https://a.test/api/*', 'https://a.test/api/'),
    true
  );
});
