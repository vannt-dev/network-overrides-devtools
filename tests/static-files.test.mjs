import test from 'node:test';
import assert from 'node:assert/strict';
import { createUiContext } from './test-harness.mjs';

const { NetworkOverridesUtils: u } = createUiContext();
const plain = value => JSON.parse(JSON.stringify(value));

test('guessContentType knows the usual static file extensions', () => {
  assert.equal(
    u.guessContentType('https://a.test/js/app.js?v=3'),
    'text/javascript; charset=utf-8'
  );
  assert.equal(u.guessContentType('/assets/app.mjs#x'), 'text/javascript; charset=utf-8');
  assert.equal(u.guessContentType('*/style.CSS'), 'text/css; charset=utf-8');
  assert.equal(u.guessContentType('https://a.test/index.html'), 'text/html; charset=utf-8');
  assert.equal(u.guessContentType('logo.png'), 'image/png');
  assert.equal(u.guessContentType('photo.jpeg'), 'image/jpeg');
  assert.equal(u.guessContentType('photo.jpg'), 'image/jpeg');
  assert.equal(u.guessContentType('icon.svg'), 'image/svg+xml');
  assert.equal(u.guessContentType('font.woff2'), 'font/woff2');
  assert.equal(u.guessContentType('data.json'), 'application/json; charset=utf-8');
  assert.equal(u.guessContentType('https://a.test/api/users'), undefined);
  assert.equal(u.guessContentType('https://a.test/'), undefined);
  assert.equal(u.guessContentType('/regex\\.js$/'), undefined);
});

test('isTextContentType tells text files from binary ones', () => {
  for (const type of [
    'text/javascript; charset=utf-8',
    'text/css',
    'application/json',
    'image/svg+xml',
    'application/xml',
  ]) {
    assert.equal(u.isTextContentType(type), true, type);
  }
  for (const type of ['image/png', 'font/woff2', 'application/octet-stream', '']) {
    assert.equal(u.isTextContentType(type), false, type);
  }
});

test('injectIntoHtml puts the style at the end of head and the script at the end of body', () => {
  const html = '<!doctype html><html><HEAD><title>x</title></HEAD><body><p>hi</p></BODY></html>';
  const out = u.injectIntoHtml(html, { style: 'p{color:red}', script: 'window.x=1' });
  assert.equal(
    out,
    '<!doctype html><html><HEAD><title>x</title>' +
      '<style data-network-overrides>p{color:red}</style></HEAD>' +
      '<body><p>hi</p><script data-network-overrides>window.x=1</script></BODY></html>'
  );
});

test('injectIntoHtml still injects into a page with no head or body tags', () => {
  assert.equal(
    u.injectIntoHtml('<p>hi</p>', { style: 'a{}', script: 'go()' }),
    '<style data-network-overrides>a{}</style><p>hi</p><script data-network-overrides>go()</script>'
  );
});

test('injectIntoHtml cannot be closed early by the injected code', () => {
  const out = u.injectIntoHtml('<head></head><body></body>', {
    script: 'x = "</script><b>"',
    style: 'a{content:"</STYLE>"}',
  });
  assert.doesNotMatch(out, /<\/script><b>/);
  assert.match(out, /x = "<\\\/script><b>"/);
  assert.match(out, /content:"<\\\/STYLE>"/);
});

test('injectIntoHtml leaves the page unchanged when there is nothing to inject', () => {
  assert.equal(u.injectIntoHtml('<p>x</p>', {}), '<p>x</p>');
  assert.equal(u.injectIntoHtml('<p>x</p>', { script: '  ', style: '' }), '<p>x</p>');
});

test('cspMetaPolicies and removeCspMeta find and drop CSP meta tags only', () => {
  const html =
    '<head><meta charset="utf-8">' +
    `<meta http-equiv="Content-Security-Policy" content="script-src 'self'">` +
    `<META HTTP-EQUIV='content-security-policy' CONTENT="style-src 'none'" />` +
    '<meta name="viewport" content="width=device-width"></head>';
  assert.deepEqual(plain(u.cspMetaPolicies(html)), ["script-src 'self'", "style-src 'none'"]);
  assert.equal(
    u.removeCspMeta(html),
    '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>'
  );
});

test('cspBlocksInline reads script-src, style-src and default-src', () => {
  assert.equal(u.cspBlocksInline([], 'script'), false);
  assert.equal(u.cspBlocksInline(["img-src 'self'"], 'script'), false);
  assert.equal(u.cspBlocksInline(["script-src 'self'"], 'script'), true);
  assert.equal(u.cspBlocksInline(["script-src 'self'"], 'style'), false);
  assert.equal(u.cspBlocksInline(["default-src 'self'"], 'style'), true);
  assert.equal(u.cspBlocksInline(["script-src 'self' 'unsafe-inline'"], 'script'), false);
  // A nonce or a hash turns 'unsafe-inline' off.
  assert.equal(u.cspBlocksInline(["script-src 'unsafe-inline' 'nonce-abc'"], 'script'), true);
  assert.equal(u.cspBlocksInline(["script-src 'unsafe-inline' 'strict-dynamic'"], 'script'), true);
  assert.equal(u.cspBlocksInline(["default-src 'self'; script-src *"], 'script'), true);
  // Every policy must allow it; one is enough to block.
  assert.equal(
    u.cspBlocksInline(["script-src 'unsafe-inline'", "default-src 'self'"], 'script'),
    true
  );
  // script-src-elem is what applies to <script> elements.
  assert.equal(
    u.cspBlocksInline(["script-src 'self'; script-src-elem 'unsafe-inline'"], 'script'),
    false
  );
});

test('injectIntoHtml keeps the doctype first, so the page keeps its rendering mode', () => {
  assert.equal(
    u.injectIntoHtml('﻿<!DOCTYPE html><p>hi</p>', { style: 'a{}' }),
    '﻿<!DOCTYPE html><style data-network-overrides>a{}</style><p>hi</p>'
  );
});
