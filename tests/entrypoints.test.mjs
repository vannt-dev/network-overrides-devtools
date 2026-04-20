import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { normalize, runDistFile } from './test-harness.mjs';

test('popup entrypoint initializes shared UI with popup options', () => {
  const initCalls = [];
  const context = {
    NetworkOverridesUi: {
      init(options) {
        initCalls.push(options);
      },
    },
  };

  vm.createContext(context);
  runDistFile('popup.js', context);

  assert.deepEqual(normalize(initCalls), [
    {
      autoFillOnOpen: true,
      showManualEditor: false,
    },
  ]);
});

test('panel entrypoint initializes shared UI with panel options', () => {
  const initCalls = [];
  const context = {
    NetworkOverridesUi: {
      init(options) {
        initCalls.push(options);
      },
    },
    chrome: {
      devtools: {
        network: {
          getHAR: () => {},
          onRequestFinished: { addListener: () => {} },
        },
      },
    },
  };

  vm.createContext(context);
  runDistFile('panel.js', context);

  assert.deepEqual(normalize(initCalls), [
    {
      autoFillOnOpen: true,
      showManualEditor: true,
    },
  ]);
});

test('devtools entrypoint registers the Overrides panel', () => {
  const panelCalls = [];
  const context = {
    chrome: {
      devtools: {
        panels: {
          create(title, iconPath, page, callback) {
            panelCalls.push({ title, iconPath, page });
            callback?.({});
          },
        },
      },
    },
  };

  vm.createContext(context);
  runDistFile('devtools.js', context);

  assert.deepEqual(panelCalls, [
    {
      title: 'Overrides',
      iconPath: '',
      page: 'panel.html',
    },
  ]);
});
