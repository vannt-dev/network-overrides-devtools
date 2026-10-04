import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('the WebSocket badge style does not leak into other badge selectors', () => {
  const css = fs.readFileSync('styles/features.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const blocks = [...css.matchAll(/([^{}]+)\{[^}]*\}/g)].map(match =>
    match[1].split(',').map(selector => selector.trim())
  );
  for (const selectors of blocks) {
    if (selectors.includes('.ws-badge')) assert.deepEqual(selectors, ['.ws-badge']);
  }
  assert.ok(
    blocks.some(
      selectors =>
        selectors.includes('.override-status-badge') && selectors.includes('.override-delay-badge')
    ),
    'status, delay and fail badges share their base rule'
  );
});
