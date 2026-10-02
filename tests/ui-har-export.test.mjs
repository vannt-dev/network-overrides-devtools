import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createUiHarness, flushUi, closeAllUiHarnessWindows } from './test-harness.mjs';
import { TEST_DOMAIN } from './config.mjs';

after(() => {
  closeAllUiHarnessWindows();
});

const exportedAt = new Date('2026-10-02T10:20:30.000Z');

function click(harness, id) {
  harness.document
    .getElementById(id)
    .dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));
}

test('buildHar writes a HAR 1.2 log from what the capture keeps', async () => {
  const harness = createUiHarness({ storageState: { overrides: [] } });
  await flushUi(harness.window);
  const { buildHar } = harness.window.NetworkOverridesUi;

  const built = buildHar(
    [
      {
        url: `${TEST_DOMAIN}/api/users?page=2&tag=a&tag=b`,
        type: 'xmlhttprequest',
        method: 'post',
        headers: [
          { name: 'Content-Type', value: 'application/json' },
          { name: 'Authorization', value: 'Bearer t' },
        ],
        postData: '{"name":"Ada"}',
        statusCode: 201,
        body: '{"id":1}',
      },
      { url: `${TEST_DOMAIN}/app.js`, type: 'script', body: 'console.log(1)' },
      { url: `${TEST_DOMAIN}/plain`, type: 'fetch', statusCode: 200, body: 'hello' },
      { url: `${TEST_DOMAIN}/no-body`, type: 'fetch' },
      { url: 'not a url', type: 'other', body: '' },
    ],
    { creatorVersion: '9.9.9', exportedAt }
  );
  // Objects built inside the jsdom window carry that realm's prototypes.
  const har = JSON.parse(JSON.stringify(built));

  assert.equal(har.log.version, '1.2');
  assert.deepEqual(har.log.creator, { name: 'Network Overrides DevTools', version: '9.9.9' });
  assert.match(har.log.comment, /not recorded/);
  assert.equal(har.log.entries.length, 5);

  const [post, script, plain, noBody, odd] = har.log.entries;
  assert.equal(post.startedDateTime, '2026-10-02T10:20:30.000Z');
  assert.deepEqual(post.timings, { send: 0, wait: 0, receive: 0 });
  assert.equal(post.request.method, 'POST');
  assert.deepEqual(post.request.queryString, [
    { name: 'page', value: '2' },
    { name: 'tag', value: 'a' },
    { name: 'tag', value: 'b' },
  ]);
  assert.equal(post.request.headers.length, 2);
  assert.deepEqual(post.request.postData, { mimeType: 'application/json', text: '{"name":"Ada"}' });
  assert.equal(post.request.bodySize, 14);
  assert.equal(post.response.status, 201);
  assert.deepEqual(post.response.content, {
    size: 8,
    mimeType: 'application/json',
    text: '{"id":1}',
  });
  assert.equal(post._resourceType, 'xhr');

  assert.equal(script.request.method, 'GET');
  assert.equal(script.request.postData, undefined);
  assert.equal(script.response.content.mimeType, 'application/javascript');
  assert.equal(plain.response.content.mimeType, 'text/plain');

  assert.equal(noBody.response.status, 0);
  assert.equal(noBody.response.content.text, undefined);
  assert.equal(noBody.response.content.comment, 'Response body was not captured.');

  assert.deepEqual(odd.request.queryString, []);
  // An empty captured body is still a captured body.
  assert.equal(odd.response.content.text, '');
});

test('an exported HAR reads back through the HAR importer', async () => {
  const harness = createUiHarness({ storageState: { overrides: [] } });
  await flushUi(harness.window);
  const { buildHar, parseHarToRules } = harness.window.NetworkOverridesUi;

  const har = buildHar(
    [
      {
        url: `${TEST_DOMAIN}/api/a`,
        type: 'fetch',
        method: 'PUT',
        statusCode: 404,
        body: '{"a":1}',
      },
      { url: `${TEST_DOMAIN}/api/b`, type: 'fetch' },
    ],
    { creatorVersion: '1.0.0', exportedAt }
  );
  const rules = parseHarToRules(JSON.stringify(har));

  assert.deepEqual(JSON.parse(JSON.stringify(rules)), [
    {
      pattern: `${TEST_DOMAIN}/api/a`,
      method: 'PUT',
      mode: 'text',
      body: '{"a":1}',
      statusCode: 404,
    },
    { pattern: `${TEST_DOMAIN}/api/b`, method: 'GET', mode: 'text', body: '' },
  ]);
});

test('Export HAR asks the background for bodies and downloads a .har file', async () => {
  const harness = createUiHarness({
    storageState: { overrides: [] },
    apis: [
      { url: `${TEST_DOMAIN}/api/users`, type: 'fetch', method: 'GET', statusCode: 200 },
      { url: `${TEST_DOMAIN}/api/orders`, type: 'xmlhttprequest', method: 'POST' },
    ],
  });
  await flushUi(harness.window);

  click(harness, 'export-har-btn');
  await flushUi(harness.window);

  const request = harness.sentMessages.filter(message => message.type === 'getApis').at(-1);
  assert.equal(request.includeBodies, true);

  const download = harness.downloads.at(-1);
  assert.match(download.filename, /^network-overrides-.+-\d+\.har$/);
  const har = JSON.parse(download.content);
  assert.deepEqual(
    har.log.entries.map(entry => [entry.request.method, entry.request.url]),
    [
      ['GET', `${TEST_DOMAIN}/api/users`],
      ['POST', `${TEST_DOMAIN}/api/orders`],
    ]
  );
});

test('Export HAR downloads nothing when nothing was captured', async () => {
  const harness = createUiHarness({ storageState: { overrides: [] }, apis: [] });
  await flushUi(harness.window);
  const before = harness.downloads.length;

  click(harness, 'export-har-btn');
  await flushUi(harness.window);

  assert.equal(harness.downloads.length, before);
});
