/*! SPDX-License-Identifier: MIT | Copyright (c) 2025 Van Nguyen | github.com/vannt-dev/network-overrides-devtools */
/// <reference types="chrome" />

namespace NetworkOverridesDevtools {
  chrome.devtools.panels.create('Overrides', '', 'panel.html', _panel => {
    // Optional: additional panel lifecycle hooks can be placed here.
  });
}
