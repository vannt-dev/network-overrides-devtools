/// <reference types="chrome" />

namespace NetworkOverridesDevtools {
  chrome.devtools.panels.create('Overrides', '', 'panel.html', panel => {
    // Optional: additional panel lifecycle hooks can be placed here.
  });
}
