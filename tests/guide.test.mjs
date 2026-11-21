import fs from 'node:fs';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createUiHarness, flushUi, closeAllUiHarnessWindows } from './test-harness.mjs';
import { TEST_DOMAIN } from './config.mjs';

after(() => {
  closeAllUiHarnessWindows();
});

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const en = readJson('_locales/en/messages.json');
const vi = readJson('_locales/vi/messages.json');
const lowerKeys = messages =>
  Object.fromEntries(Object.entries(messages).map(([key, value]) => [key.toLowerCase(), value]));

async function openGuide(options = {}, beforeClick = async () => {}) {
  const harness = createUiHarness({ tabUrl: `${TEST_DOMAIN}/`, ...options });
  await flushUi(harness.window);
  await beforeClick(harness);
  harness.document
    .getElementById('info-btn')
    .dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));
  return harness.openedTabs.map(tab => tab.url);
}

test('the guide link opens the English guide without a language', async () => {
  assert.deepEqual(await openGuide(), ['guide.html']);
});

test('the guide link opens the Vietnamese guide when Tiếng Việt is chosen', async () => {
  assert.deepEqual(await openGuide({ storageState: { uiLanguage: 'vi' } }), ['guide-vi.html']);
});

test('the guide link follows a Vietnamese browser in Auto', async () => {
  assert.deepEqual(await openGuide({ i18nMessages: lowerKeys(vi) }), ['guide-vi.html']);
});

test('English chosen on a Vietnamese browser opens the English guide', async () => {
  const urls = await openGuide({ i18nMessages: lowerKeys(vi), storageState: { uiLanguage: 'en' } });
  assert.deepEqual(urls, ['guide.html']);
});

test('the guide link follows a language picked after the page opened', async () => {
  const urls = await openGuide({ page: 'popup.html' }, async harness => {
    const select = harness.document.getElementById('ui-language');
    select.value = 'vi';
    select.dispatchEvent(new harness.window.Event('change', { bubbles: true }));
    await flushUi(harness.window);
  });
  assert.deepEqual(urls, ['guide-vi.html']);
});

const guides = {
  en: fs.readFileSync('guide.html', 'utf8'),
  vi: fs.readFileSync('guide-vi.html', 'utf8'),
};
const all = (html, pattern) => [...html.matchAll(pattern)].map(match => match[1]);

test('each guide file named by a locale exists and goes into the Store package', () => {
  const packageScript = fs.readFileSync('scripts/package-store.mjs', 'utf8');
  for (const messages of [en, vi]) {
    const file = messages.guide_page.message;
    assert.ok(fs.existsSync(file), `${file} exists`);
    assert.match(packageScript, new RegExp(`'${file.replace('.', '\\.')}'`), `${file} is packaged`);
  }
  assert.equal(en.guide_page.message, 'guide.html');
  assert.equal(vi.guide_page.message, 'guide-vi.html');
});

test('the Vietnamese guide keeps the English guide structure', () => {
  assert.match(guides.vi, /<html lang="vi">/);
  assert.match(guides.en, /<html lang="en">/);
  for (const pattern of [/\sid="([^"]+)"/g, /href="(#[^"]+)"/g, /<(h[1-3])\b/g]) {
    assert.deepEqual(all(guides.vi, pattern), all(guides.en, pattern), String(pattern));
  }
  // Code samples are the same in both languages.
  assert.deepEqual(
    all(guides.vi, /<pre>([\s\S]*?)<\/pre>/g),
    all(guides.en, /<pre>([\s\S]*?)<\/pre>/g)
  );
});

test('each guide links to the other language', () => {
  assert.match(guides.en, /<a href="guide-vi\.html"[^>]*>Tiếng Việt<\/a>/);
  assert.match(guides.vi, /<a href="guide\.html"[^>]*>English<\/a>/);
});
