import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

function sharedBodyMarkup(filename) {
  const dom = new JSDOM(fs.readFileSync(filename, 'utf8'));
  const { body } = dom.window.document;
  body.removeAttribute('class');
  body.querySelector('script[src="dist/popup.js"], script[src="dist/panel.js"]')?.remove();
  return body.innerHTML.trim();
}

test('Popup and DevTools panel keep the same shared controls and labels', () => {
  assert.equal(sharedBodyMarkup('popup.html'), sharedBodyMarkup('panel.html'));
});
