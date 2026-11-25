import test from 'node:test';
import assert from 'node:assert/strict';
import { createUiContext } from './test-harness.mjs';
import { createBackgroundHarness } from './background-test-harness.mjs';
import { TEST_DOMAIN } from './config.mjs';

const plain = value => JSON.parse(JSON.stringify(value));
const tick = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));
const Collection = createUiContext().NetworkOverridesCollection;
const LIST = `${TEST_DOMAIN}/api/todos`;

const options = (extra = {}) => ({
  idField: 'id',
  idType: 'number',
  newUuid: () => 'uuid-1',
  ...extra,
});

function storeOf(items, idField = 'id') {
  return Collection.createStore(structuredClone(items), idField, 'seed');
}

/** Runs one request against a store, keeping the store it leaves behind. */
function call(holder, method, url, body, extra) {
  const where = Collection.route('/api/todos', url);
  assert.ok(where, `${url} routes to the collection`);
  const answer = Collection.handle(
    holder.store,
    { method, url, body: body === undefined ? undefined : JSON.stringify(body) },
    where,
    options(extra)
  );
  if (answer.store) holder.store = answer.store;
  return plain(answer);
}

const header = (answer, name) => answer.headers.find(h => h.name === name)?.value;

// ---- routing --------------------------------------------------------------------------

test('a plain pattern routes the list and one item below it, nothing deeper or beside it', () => {
  const route = url => plain(Collection.route('/api/todos', url));
  assert.deepEqual(route(LIST), {});
  assert.deepEqual(route(`${LIST}/`), {});
  assert.deepEqual(route(`${LIST}?done=true#top`), {});
  assert.deepEqual(route(`${LIST}/5`), { id: '5' });
  assert.deepEqual(route(`${LIST}/5/?x=1`), { id: '5' });
  assert.deepEqual(route(`${LIST}/a%20b`), { id: 'a b' });
  assert.equal(route(`${LIST}/5/comments`), null);
  assert.equal(route(`${LIST}-old`), null);
  assert.equal(route(`${TEST_DOMAIN}/api/users`), null);
});

test('a * pattern or a /regex/ must match the list address', () => {
  assert.deepEqual(plain(Collection.route('*/api/todos', `${LIST}/7`)), { id: '7' });
  assert.deepEqual(plain(Collection.route('*/api/todos', LIST)), {});
  assert.equal(Collection.route('*/api/todos', `${LIST}/7/x`), null);
  assert.deepEqual(plain(Collection.route('/\\/todos$/', `${LIST}/7`)), { id: '7' });
  assert.deepEqual(plain(Collection.route('/\\/todos$/', LIST)), {});
});

test('matchRule uses the collection routes only for collection rules', () => {
  const rule = { pattern: '*/api/todos', body: '', mode: 'collection' };
  assert.deepEqual(plain(Collection.matchRule(rule, rule.pattern, `${LIST}/3`)), []);
  assert.equal(Collection.matchRule({ ...rule, mode: 'text' }, rule.pattern, `${LIST}/3`), null);
});

// ---- store operations -----------------------------------------------------------------

test('the seed must be a JSON array of objects; blank is an empty list', () => {
  assert.deepEqual(plain(Collection.parseItems('')), { items: [] });
  assert.deepEqual(plain(Collection.parseItems('[{"id":1}]')), { items: [{ id: 1 }] });
  assert.match(Collection.parseItems('{"id":1}').error, /not a JSON array/);
  assert.match(Collection.parseItems('[{"id":1},2]').error, /item 2/);
  assert.ok('error' in Collection.parseItems('[{'));
});

test('GET lists the items, filters by field and pages with _page and _limit', () => {
  const holder = {
    store: storeOf([
      { id: 1, done: true, user: 'a' },
      { id: 2, done: false, user: 'a' },
      { id: 3, done: true, user: 'b' },
    ]),
  };
  const all = call(holder, 'GET', LIST);
  assert.equal(all.status, 200);
  assert.deepEqual(
    all.body.map(item => item.id),
    [1, 2, 3]
  );
  assert.equal(header(all, 'X-Total-Count'), '3');
  const done = call(holder, 'GET', `${LIST}?done=true&user=a`);
  assert.deepEqual(done.body, [{ id: 1, done: true, user: 'a' }]);
  const page = call(holder, 'GET', `${LIST}?_limit=2&_page=2`);
  assert.deepEqual(
    page.body.map(item => item.id),
    [3]
  );
  assert.equal(header(page, 'X-Total-Count'), '3');
  assert.equal(all.store, undefined, 'a read changes nothing');
});

test('GET one item by its id, whether the id is a number or text; 404 when missing', () => {
  const holder = {
    store: storeOf([
      { id: 1, title: 'a' },
      { id: 'x7', title: 'b' },
    ]),
  };
  assert.deepEqual(call(holder, 'GET', `${LIST}/1`).body, { id: 1, title: 'a' });
  assert.deepEqual(call(holder, 'GET', `${LIST}/x7`).body, { id: 'x7', title: 'b' });
  const missing = call(holder, 'GET', `${LIST}/9`);
  assert.equal(missing.status, 404);
  assert.deepEqual(missing.body, { error: 'Not found' });
  assert.equal(header(missing, 'Content-Type'), 'application/json; charset=utf-8');
});

test('POST adds an item with the next number id, never reusing one after a delete', () => {
  const holder = { store: storeOf([{ id: 1 }, { id: 4 }]) };
  const created = call(holder, 'POST', LIST, { title: 'new' });
  assert.equal(created.status, 201);
  assert.deepEqual(created.body, { title: 'new', id: 5 });
  assert.equal(call(holder, 'DELETE', `${LIST}/5`).status, 204);
  assert.deepEqual(call(holder, 'POST', LIST, { title: 'again' }).body, {
    title: 'again',
    id: 6,
  });
  assert.deepEqual(plain(holder.store.items.map(item => item.id)), [1, 4, 6]);
});

test('POST keeps an id it is given, refuses one in use and needs a JSON object', () => {
  const holder = { store: storeOf([{ id: 1 }]) };
  assert.deepEqual(call(holder, 'POST', LIST, { id: 10 }).body, { id: 10 });
  assert.deepEqual(call(holder, 'POST', LIST, {}).body, { id: 11 });
  const taken = call(holder, 'POST', LIST, { id: '1' });
  assert.equal(taken.status, 409);
  assert.equal(taken.store, undefined);
  assert.equal(call(holder, 'POST', LIST, [1, 2]).status, 400);
  assert.equal(call(holder, 'POST', LIST).status, 400);
  const notJson = Collection.handle(
    holder.store,
    { method: 'POST', url: LIST, body: 'not json' },
    {},
    options()
  );
  assert.equal(notJson.status, 400);
});

test('new ids can be UUIDs, and the id field can have another name', () => {
  const holder = { store: storeOf([{ key: 'a' }], 'key') };
  const created = call(holder, 'POST', LIST, { title: 't' }, { idField: 'key', idType: 'uuid' });
  assert.deepEqual(created.body, { title: 't', key: 'uuid-1' });
  assert.deepEqual(call(holder, 'GET', `${LIST}/uuid-1`, undefined, { idField: 'key' }).body, {
    title: 't',
    key: 'uuid-1',
  });
});

test('PUT replaces an item, PATCH merges into it; both keep the id and 404 when missing', () => {
  const holder = { store: storeOf([{ id: 1, title: 'a', done: false, tags: ['x'] }]) };
  const patched = call(holder, 'PATCH', `${LIST}/1`, { done: true, id: 99 });
  assert.equal(patched.status, 200);
  assert.deepEqual(patched.body, { id: 1, title: 'a', done: true, tags: ['x'] });
  const replaced = call(holder, 'PUT', `${LIST}/1`, { title: 'b' });
  assert.deepEqual(replaced.body, { title: 'b', id: 1 });
  assert.deepEqual(plain(holder.store.items), [{ title: 'b', id: 1 }]);
  assert.equal(call(holder, 'PUT', `${LIST}/2`, { title: 'c' }).status, 404);
  assert.equal(call(holder, 'PATCH', `${LIST}/2`, { title: 'c' }).status, 404);
  assert.equal(call(holder, 'PATCH', `${LIST}/1`, 'text').status, 400);
});

test('DELETE removes an item with 204 and no body, then 404', () => {
  const holder = { store: storeOf([{ id: 1 }, { id: 2 }]) };
  const deleted = call(holder, 'DELETE', `${LIST}/1`);
  assert.equal(deleted.status, 204);
  assert.equal(deleted.body, undefined);
  assert.deepEqual(plain(holder.store.items), [{ id: 2 }]);
  assert.equal(call(holder, 'DELETE', `${LIST}/1`).status, 404);
});

test('OPTIONS and HEAD change nothing; other methods get 405 with Allow', () => {
  const holder = { store: storeOf([{ id: 1 }]) };
  const options204 = call(holder, 'OPTIONS', LIST);
  assert.equal(options204.status, 204);
  assert.match(header(options204, 'Allow'), /POST/);
  const head = call(holder, 'HEAD', `${LIST}/1`);
  assert.equal(head.status, 200);
  assert.equal(head.body, undefined);
  assert.equal(call(holder, 'DELETE', LIST).status, 405);
  assert.equal(call(holder, 'POST', `${LIST}/1`, {}).status, 405);
  const odd = call(holder, 'PROPFIND', `${LIST}/1`);
  assert.equal(odd.status, 405);
  assert.match(header(odd, 'Allow'), /PATCH/);
  assert.deepEqual(plain(holder.store.items), [{ id: 1 }]);
});

test('a change that would make the collection too large is refused with 413', () => {
  const holder = { store: storeOf([]) };
  const big = 'x'.repeat(Collection.MAX_STORE_CHARS);
  const answer = call(holder, 'POST', LIST, { big });
  assert.equal(answer.status, 413);
  assert.deepEqual(plain(holder.store.items), []);
});

test('replacing the items by hand keeps the ids already given', () => {
  const store = { seed: 's', items: [], nextId: 8 };
  assert.equal(Collection.replaceItems(store, [{ id: 2 }], 'id').nextId, 8);
  assert.equal(Collection.replaceItems(store, [{ id: 20 }], 'id').nextId, 21);
});

// ---- background ------------------------------------------------------------------------

const RULE = {
  pattern: '/api/todos',
  mode: 'collection',
  body: '[{"id":1,"title":"Buy milk","done":false}]',
};

async function backgroundWith(rules, harness = createBackgroundHarness()) {
  harness.callMessage({
    type: 'update',
    tabId: 7,
    tabUrl: `${TEST_DOMAIN}/`,
    enabled: true,
    overrides: rules,
  });
  await tick();
  return harness;
}

let requestCounter = 0;
/** Sends one request through the interceptor and returns how it was answered. */
function send(harness, method, url, body, headers = {}) {
  const requestId = `req-${++requestCounter}`;
  const request = { url, method, headers };
  if (body !== undefined) request.postData = JSON.stringify(body);
  harness.emitDebuggerEvent('Fetch.requestPaused', {
    requestId,
    request,
    resourceType: 'Fetch',
  });
  const command = harness.commandLog.filter(({ params }) => params?.requestId === requestId).at(-1);
  const text = Buffer.from(command.params.body || '', 'base64').toString('utf8');
  return {
    method: command.method,
    status: command.params.responseCode,
    body: text ? JSON.parse(text) : undefined,
    header: name =>
      command.params.responseHeaders?.find(h => h.name.toLowerCase() === name.toLowerCase())?.value,
  };
}

function collectionMessage(harness, type, extra = {}) {
  return harness.callMessage({ type, tabId: 7, pattern: RULE.pattern, ...extra }).response;
}

test('the background answers POST, GET and DELETE from the list at the request stage', async () => {
  const harness = await backgroundWith([RULE]);
  const created = send(harness, 'POST', LIST, { title: 'Walk' });
  assert.equal(created.method, 'Fetch.fulfillRequest');
  assert.equal(created.status, 201);
  assert.deepEqual(created.body, { title: 'Walk', id: 2 });
  assert.equal(created.header('x-network-overrides-pattern'), '/api/todos');
  assert.equal(created.header('Content-Type'), 'application/json; charset=utf-8');

  const list = send(harness, 'GET', `${LIST}?_limit=10`);
  assert.equal(list.status, 200);
  assert.deepEqual(
    list.body.map(item => item.title),
    ['Buy milk', 'Walk']
  );
  assert.equal(list.header('X-Total-Count'), '2');

  const deleted = send(harness, 'DELETE', `${LIST}/1`);
  assert.equal(deleted.status, 204);
  assert.equal(deleted.body, undefined);
  assert.equal(send(harness, 'GET', `${LIST}/1`).status, 404);
  assert.deepEqual(send(harness, 'GET', LIST).body, [{ title: 'Walk', id: 2 }]);
});

test('a cross-origin request gets its preflight answered and the page origin allowed', async () => {
  const harness = await backgroundWith([RULE]);
  const preflight = send(harness, 'OPTIONS', `${LIST}/1`, undefined, {
    Origin: 'https://app.test',
    'Access-Control-Request-Method': 'PATCH',
    'Access-Control-Request-Headers': 'content-type',
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.header('Access-Control-Allow-Methods'), 'PATCH');
  const patched = send(
    harness,
    'PATCH',
    `${LIST}/1`,
    { done: true },
    { Origin: 'https://app.test' }
  );
  assert.equal(patched.status, 200);
  assert.deepEqual(patched.body, { id: 1, title: 'Buy milk', done: true });
  assert.equal(patched.header('Access-Control-Allow-Origin'), 'https://app.test');
  assert.equal(patched.header('Access-Control-Expose-Headers'), 'X-Total-Count');
});

test('a collection rule never answers at the response stage', async () => {
  const harness = await backgroundWith([RULE]);
  harness.emitDebuggerEvent('Fetch.requestPaused', {
    requestId: 'late',
    request: { url: LIST, method: 'POST', headers: {}, postData: '{"title":"x"}' },
    responseStatusCode: 200,
    responseHeaders: [],
    resourceType: 'Fetch',
  });
  const command = harness.commandLog.filter(({ params }) => params?.requestId === 'late').at(-1);
  assert.equal(command.method, 'Fetch.continueRequest');
  assert.equal(send(harness, 'GET', LIST).body.length, 1);
});

test('PUT, PATCH and POST read the body of their own request only', async () => {
  const harness = await backgroundWith([RULE]);
  send(harness, 'POST', LIST, { title: 'first' });
  // The same address again without a body: no earlier body stands in for it.
  assert.equal(send(harness, 'POST', LIST).status, 400);
});

test('the seed fills {{...}} placeholders once, and an invalid seed answers 500', async () => {
  const harness = await backgroundWith([
    { ...RULE, body: '[{"id":1,"made":"{{$uuid}}"}]' },
    { pattern: '/api/broken', mode: 'collection', body: '{"not":"a list"}' },
  ]);
  const first = send(harness, 'GET', `${LIST}/1`).body.made;
  assert.match(first, /^[0-9a-f-]{36}$/);
  assert.equal(send(harness, 'GET', `${LIST}/1`).body.made, first);
  const broken = send(harness, 'GET', `${TEST_DOMAIN}/api/broken`);
  assert.equal(broken.status, 500);
  assert.match(broken.body.error, /not a JSON array/);
});

test('the list is kept when the rules are sent again, and starts over when the seed changes', async () => {
  const harness = await backgroundWith([RULE]);
  send(harness, 'POST', LIST, { title: 'kept' });
  await backgroundWith([{ ...RULE, delayMs: 0 }], harness);
  assert.equal(send(harness, 'GET', LIST).body.length, 2);
  await backgroundWith([{ ...RULE, body: '[]' }], harness);
  assert.deepEqual(send(harness, 'GET', LIST).body, []);
  // The rules change when the tab visits another site: the list waits for its rule to return.
  send(harness, 'POST', LIST, { title: 'kept again' });
  await backgroundWith([], harness);
  await backgroundWith([{ ...RULE, body: '[]' }], harness);
  assert.equal(send(harness, 'GET', LIST).body.length, 1);
});

test('lists of rules that are gone are dropped once a tab holds too many', async () => {
  const TabState = createBackgroundHarness().context.NetworkOverridesTabState;
  const limit = TabState.COLLECTIONS_LIMIT;
  const rules = Array.from({ length: limit + 1 }, (_, i) => ({ ...RULE, pattern: `/api/c${i}` }));
  const harness = await backgroundWith(rules);
  rules.forEach(rule => send(harness, 'GET', `${TEST_DOMAIN}${rule.pattern}`));
  const state = harness.context.NetworkOverridesTabState.get(7);
  assert.equal(state.collections.size, limit + 1);
  await backgroundWith([rules[0]], harness);
  assert.deepEqual([...state.collections.keys()], ['/api/c0']);
});

test('the editor reads, replaces and resets the list through messages', async () => {
  const harness = await backgroundWith([RULE]);
  send(harness, 'POST', LIST, { title: 'added' });
  assert.equal(collectionMessage(harness, 'getCollection').items.length, 2);

  const saved = collectionMessage(harness, 'setCollection', { items: [{ id: 30, title: 'x' }] });
  assert.equal(saved.success, true);
  assert.deepEqual(send(harness, 'GET', LIST).body, [{ id: 30, title: 'x' }]);
  assert.equal(send(harness, 'POST', LIST, {}).body.id, 31);

  const bad = collectionMessage(harness, 'setCollection', { items: [1] });
  assert.equal(bad.success, false);

  const reset = collectionMessage(harness, 'resetCollection');
  assert.equal(reset.success, true);
  assert.deepEqual(plain(reset.items), [{ id: 1, title: 'Buy milk', done: false }]);
  assert.equal(send(harness, 'GET', LIST).body.length, 1);

  const unknown = collectionMessage(harness, 'getCollection', { pattern: '/nope' });
  assert.deepEqual(plain(unknown), {
    type: 'getCollectionResponse',
    success: false,
    error: 'not-saved',
  });
});

test('the list survives a worker restart', async () => {
  const first = await backgroundWith([RULE]);
  send(first, 'POST', LIST, { title: 'before restart' });
  send(first, 'DELETE', `${LIST}/1`);
  await tick(600);
  const second = createBackgroundHarness({ sessionState: first.sessionState });
  await second.context.NetworkOverridesBackground.ready;
  await tick(5);
  assert.deepEqual(send(second, 'GET', LIST).body, [{ title: 'before restart', id: 2 }]);
  // The next id goes on from where it was.
  assert.equal(send(second, 'POST', LIST, {}).body.id, 3);
});
