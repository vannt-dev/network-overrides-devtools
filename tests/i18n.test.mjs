import fs from 'node:fs';
import path from 'node:path';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import {
  createUiContext,
  createUiHarness,
  flushUi,
  closeAllUiHarnessWindows,
} from './test-harness.mjs';
import { TEST_DOMAIN } from './config.mjs';

after(() => {
  closeAllUiHarnessWindows();
});

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const en = readJson('_locales/en/messages.json');
const vi = readJson('_locales/vi/messages.json');
const manifest = readJson('manifest.json');

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(file);
    return file.endsWith('.ts') ? [file] : [];
  });
}

/** Every message key the code and the pages name: `t('key'`, `data-i18n*="key"`, `__MSG_key__`. */
function usedKeys() {
  const keys = new Set();
  for (const file of sourceFiles('src')) {
    for (const match of fs.readFileSync(file, 'utf8').matchAll(/\bt\(\s*'([^']+)'/g)) {
      keys.add(match[1]);
    }
    for (const match of fs.readFileSync(file, 'utf8').matchAll(/dataset\.i18n = '([^']+)'/g)) {
      keys.add(match[1]);
    }
  }
  for (const page of ['panel.html', 'popup.html']) {
    const html = fs.readFileSync(page, 'utf8');
    for (const match of html.matchAll(
      /data-i18n(?:-html|-title|-placeholder|-aria-label)?="([^"]+)"/g
    )) {
      keys.add(match[1]);
    }
  }
  for (const match of JSON.stringify(manifest).matchAll(/__MSG_(\w+)__/g)) keys.add(match[1]);
  return keys;
}

const tokens = message => (message.match(/\$[1-9]/g) || []).sort().join(',');

test('English and Vietnamese messages have exactly the same keys', () => {
  assert.deepEqual(Object.keys(vi).sort(), Object.keys(en).sort());
});

test('every message key the code and the pages use exists, and every message is used', () => {
  const used = usedKeys();
  const missing = [...used].filter(key => !(key in en));
  assert.deepEqual(missing, [], `keys used but missing from _locales/en: ${missing.join(', ')}`);
  const unused = Object.keys(en).filter(key => !used.has(key));
  assert.deepEqual(unused, [], `messages nobody uses: ${unused.join(', ')}`);
});

test('messages are valid for chrome.i18n and both languages take the same values', () => {
  for (const [lang, messages] of Object.entries({ en, vi })) {
    for (const [key, entry] of Object.entries(messages)) {
      assert.match(key, /^[a-z0-9_]+$/, `${lang}: key ${key}`);
      assert.equal(typeof entry.message, 'string', `${lang}: ${key}`);
      assert.ok(entry.message.trim(), `${lang}: ${key} is empty`);
      // Only $1..$9 substitutions: a bare `$` or a `$name$` placeholder would be read by Chrome.
      assert.doesNotMatch(entry.message, /\$(?![1-9])/, `${lang}: ${key} has a bare $`);
    }
  }
  for (const key of Object.keys(en)) {
    assert.equal(tokens(vi[key].message), tokens(en[key].message), `substitutions of ${key}`);
  }
});

test('the manifest is localised and its texts fit the Chrome Web Store limits', () => {
  assert.equal(manifest.default_locale, 'en');
  assert.equal(manifest.name, '__MSG_ext_name__');
  assert.equal(manifest.description, '__MSG_ext_description__');
  assert.equal(manifest.action.default_title, '__MSG_action_title__');
  for (const messages of [en, vi]) {
    assert.ok(messages.ext_name.message.length <= 75);
    assert.ok(messages.ext_description.message.length <= 132);
  }
});

test('t() falls back to English when chrome.i18n has no such message or is missing', () => {
  const bare = createUiContext().NetworkOverridesUi;
  assert.equal(bare.t('toast_rule_deleted'), 'Rule deleted');
  assert.equal(bare.t('tab_rules', 3), 'Rules (3)');

  const context = createUiContext();
  context.chrome = { i18n: { getMessage: () => '' } };
  assert.equal(
    context.NetworkOverridesUi.t('toast_har_exported', 4, 2),
    en.toast_har_exported.message.replace('$1', '4').replace('$2', '2')
  );
});

test('a picked language reads the bundled messages, with no chrome.i18n at all', () => {
  const ui = createUiContext().NetworkOverridesUi;
  assert.equal(ui.setUiLanguage('vi'), 'vi');
  assert.equal(ui.t('toast_rule_deleted'), 'Đã xóa rule');
  assert.equal(ui.t('tab_rules', 2), 'Rule (2)');
  assert.equal(
    ui.summarizeRule({ pattern: '/api/orders', method: 'GET', statusCode: 500, delayMs: 3000 }),
    'GET /api/orders → 500 · chậm 3 s'
  );
  assert.equal(ui.setUiLanguage('fr'), 'auto');
  assert.equal(ui.t('toast_rule_deleted'), 'Rule deleted');
});

function viMessages() {
  return Object.fromEntries(Object.entries(vi).map(([key, entry]) => [key.toLowerCase(), entry]));
}

const RULES = [
  {
    pattern: '/api/orders',
    method: 'GET',
    statusCode: 500,
    body: '{}',
    mode: 'text',
    delayMs: 3000,
  },
];

test('the panel renders in Vietnamese when the browser language is Vietnamese', async () => {
  const harness = createUiHarness({
    page: 'panel.html',
    i18nMessages: viMessages(),
    tabUrl: `${TEST_DOMAIN}/`,
    storageState: { [`overrides_${TEST_DOMAIN}`]: RULES },
  });
  await flushUi(harness.window);
  const $ = selector => harness.document.querySelector(selector);

  assert.equal($('label[for="enable"]').textContent, 'Bật ghi đè');
  assert.equal($('[data-preset="empty-list"]').textContent.trim(), 'Danh sách rỗng');
  assert.equal($('[data-preset="slow"]').title, 'Chờ 3 giây rồi mới trả lời');
  assert.equal($('#modal-pattern-hint code').textContent, '*');
  assert.equal($('#api-search').placeholder, 'Tìm API...');
  assert.equal($('[data-tab="overrides"]').textContent, 'Rule (1)');
  assert.equal($('#list .rule-summary').textContent, 'GET /api/orders → 500 · chậm 3 s');
  assert.equal($('#list .edit-btn').textContent.trim(), 'Sửa');
  assert.equal($('#traffic-stats').textContent, 'Đã ghi đè 0 · Lỗi 0');

  $('#export-rules-btn').click();
  await flushUi(harness.window);
  const toast = $('.notification-toast__message');
  assert.equal(toast?.textContent, 'Đã xuất rule.');
});

test('the language switch shows Vietnamese at once and remembers the choice', async () => {
  const harness = createUiHarness({
    page: 'popup.html',
    tabUrl: `${TEST_DOMAIN}/`,
    storageState: { [`overrides_${TEST_DOMAIN}`]: RULES },
  });
  await flushUi(harness.window);
  const $ = selector => harness.document.querySelector(selector);
  const select = $('#ui-language');
  assert.equal(select.value, 'auto');
  assert.equal($('label[for="enable"]').textContent, 'Enable Overrides');

  select.value = 'vi';
  select.dispatchEvent(new harness.window.Event('change', { bubbles: true }));
  await flushUi(harness.window);
  assert.equal($('label[for="enable"]').textContent, 'Bật ghi đè');
  assert.equal($('#list .rule-summary').textContent, 'GET /api/orders → 500 · chậm 3 s');
  assert.equal($('[data-tab="overrides"]').textContent, 'Rule (1)');
  assert.equal(harness.document.documentElement.lang, 'vi');
  assert.equal(harness.localState.uiLanguage, 'vi');

  select.value = 'en';
  select.dispatchEvent(new harness.window.Event('change', { bubbles: true }));
  await flushUi(harness.window);
  assert.equal($('label[for="enable"]').textContent, 'Enable Overrides');
  assert.equal($('#list .rule-summary').textContent, 'GET /api/orders → 500 · slow 3 s');
  assert.equal(harness.localState.uiLanguage, 'en');
});

test('a stored language choice wins over the browser language when the popup opens', async () => {
  const harness = createUiHarness({
    page: 'popup.html',
    i18nMessages: Object.fromEntries(Object.entries(en).map(([k, v]) => [k.toLowerCase(), v])),
    tabUrl: `${TEST_DOMAIN}/`,
    storageState: { uiLanguage: 'vi', [`overrides_${TEST_DOMAIN}`]: RULES },
  });
  await flushUi(harness.window);
  const $ = selector => harness.document.querySelector(selector);
  assert.equal($('#ui-language').value, 'vi');
  assert.equal($('label[for="enable"]').textContent, 'Bật ghi đè');
  assert.equal($('#list .rule-summary').textContent, 'GET /api/orders → 500 · chậm 3 s');
});
