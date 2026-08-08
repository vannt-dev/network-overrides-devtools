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

test('panel entrypoint seeds captured APIs from the HAR log', () => {
  const added = [];
  let harCallback;
  const context = {
    NetworkOverridesUi: { init: () => ({ addApis: apis => added.push(...apis) }) },
    chrome: {
      devtools: {
        network: {
          getHAR: callback => {
            harCallback = callback;
          },
          onRequestFinished: { addListener: () => {} },
        },
      },
    },
  };

  vm.createContext(context);
  runDistFile('panel.js', context);

  harCallback({
    entries: [
      {
        request: {
          url: 'https://a.test/api/users',
          method: 'GET',
          headers: [{ name: 'Accept', value: '*/*' }],
          postData: { text: '{"q":1}' },
        },
        response: { status: 200, content: { text: '{"ok":true}' } },
        _resourceType: 'xhr',
      },
      // entry without a URL must be filtered out
      { request: {}, response: {} },
    ],
  });

  assert.deepEqual(normalize(added), [
    {
      url: 'https://a.test/api/users',
      type: 'xhr',
      method: 'GET',
      headers: [{ name: 'Accept', value: '*/*' }],
      postData: '{"q":1}',
      body: '{"ok":true}',
      statusCode: 200,
    },
  ]);
});

test('panel entrypoint streams finished devtools requests into the UI', () => {
  const added = [];
  let finishedListener;
  const context = {
    NetworkOverridesUi: { init: () => ({ addApis: apis => added.push(...apis) }) },
    chrome: {
      devtools: {
        network: {
          getHAR: () => {},
          onRequestFinished: {
            addListener: listener => {
              finishedListener = listener;
            },
          },
        },
      },
    },
  };

  vm.createContext(context);
  runDistFile('panel.js', context);

  finishedListener({
    request: {
      url: 'https://a.test/api/orders',
      method: 'POST',
      headers: [],
      postData: { text: '{"id":2}' },
    },
    response: { status: 201 },
    _resourceType: 'fetch',
    getContent: callback => callback('{"created":true}', ''),
  });
  // request without a URL must be ignored
  finishedListener({ request: {} });

  assert.deepEqual(normalize(added), [
    {
      url: 'https://a.test/api/orders',
      type: 'fetch',
      method: 'POST',
      headers: [],
      postData: '{"id":2}',
      body: '{"created":true}',
      statusCode: 201,
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
