import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

function cssBlocks() {
  const css = fs.readFileSync('styles/features.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  return [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].map(match => ({
    selectors: match[1].split(',').map(selector => selector.trim()),
    body: match[2],
  }));
}

test('elements the UI hides with the hidden attribute stay hidden despite their display rule', () => {
  const blocks = cssBlocks();
  for (const name of ['.modal-group-count', '.import-menu-list']) {
    const shown = blocks.some(
      block => block.selectors.includes(name) && /display:\s*(inline-block|flex)/.test(block.body)
    );
    assert.ok(shown, `${name} has a display rule`);
    assert.ok(
      blocks.some(
        block => block.selectors.includes(`${name}[hidden]`) && /display:\s*none/.test(block.body)
      ),
      `${name}[hidden] sets display: none`
    );
  }
});
