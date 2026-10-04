import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createBackgroundContext } from './test-harness.mjs';

const WRAPPER = createBackgroundContext().NETWORK_OVERRIDES_WS_WRAPPER;

// A WebSocket stand-in with the browser behaviour the wrapper relies on:
// `onmessage` registers its listener when first assigned, like an event
// handler attribute does.
class FakeWebSocket extends EventTarget {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  constructor(url) {
    super();
    this.url = url;
    this.readyState = 1;
    this.sent = [];
    this._onmessage = null;
    this._handlerRegistered = false;
  }
  get onmessage() {
    return this._onmessage;
  }
  set onmessage(fn) {
    this._onmessage = fn;
    if (!this._handlerRegistered) {
      this._handlerRegistered = true;
      this.addEventListener('message', event => this._onmessage?.(event));
    }
  }
  send(data) {
    this.sent.push(data);
  }
  serverSends(data) {
    this.dispatchEvent(new MessageEvent('message', { data, origin: 'wss://x.test' }));
  }
  close() {
    this.readyState = 3;
    this.dispatchEvent(new Event('close'));
  }
}

function setup(rules) {
  const reports = [];
  const window = {
    WebSocket: FakeWebSocket,
    MessageEvent,
    setTimeout,
    clearTimeout,
    URL,
    __nowsReport: json => reports.push(JSON.parse(json)),
  };
  window.window = window;
  vm.createContext(window);
  const install = rules => vm.runInContext(`(${WRAPPER})(${JSON.stringify(rules)});`, window);
  install(rules);
  return { window, reports, install };
}

const ws = fields => ({
  pattern: 'wss://x.test/*',
  body: '',
  mode: 'text',
  kind: 'websocket',
  ...fields,
});

const tick = ms => new Promise(resolve => setTimeout(resolve, ms));

test('replaces a received frame before the page sees it', () => {
  const { window, reports } = setup([ws({ wsAction: 'replace', body: '{"price":1}' })]);
  const socket = new window.WebSocket('wss://x.test/feed');
  const seen = [];
  socket.addEventListener('message', e => seen.push(e.data));
  socket.serverSends('{"price":99}');
  assert.deepEqual(seen, ['{"price":1}']);
  assert.deepEqual(reports, [{ event: 'applied' }]);
});

test('onmessage assigned after creation sees the rewritten frame once', () => {
  const { window } = setup([ws({ wsAction: 'replace', body: 'new' })]);
  const socket = new window.WebSocket('wss://x.test/feed');
  const seen = [];
  socket.onmessage = e => seen.push(e.data);
  socket.serverSends('old');
  assert.deepEqual(seen, ['new']);
});

test('substitutes every match, with regex groups', () => {
  const { window } = setup([
    ws({
      wsAction: 'substitute',
      wsMatch: '"price":(\\d+)',
      wsMatchRegex: true,
      body: '"price":0$1',
    }),
  ]);
  const socket = new window.WebSocket('wss://x.test/feed');
  const seen = [];
  socket.addEventListener('message', e => seen.push(e.data));
  socket.serverSends('{"price":5,"x":{"price":7}}');
  assert.deepEqual(seen, ['{"price":05,"x":{"price":07}}']);
});

test('plain-text substitute treats the match literally', () => {
  const { window } = setup([ws({ wsAction: 'substitute', wsMatch: 'a.b', body: 'X' })]);
  const socket = new window.WebSocket('wss://x.test/feed');
  const seen = [];
  socket.addEventListener('message', e => seen.push(e.data));
  socket.serverSends('a.b axb a.b');
  assert.deepEqual(seen, ['X axb X']);
});

test('blocks a sent frame that contains the match, passes the others', () => {
  const { window } = setup([ws({ wsDirection: 'send', wsAction: 'block', wsMatch: 'ping' })]);
  const socket = new window.WebSocket('wss://x.test/feed');
  socket.send('ping 1');
  socket.send('hello');
  assert.deepEqual(socket.sent, ['hello']);
});

test('a receive rule does not touch sent frames, and the reverse', () => {
  const { window } = setup([ws({ wsDirection: 'receive', wsAction: 'block' })]);
  const socket = new window.WebSocket('wss://x.test/feed');
  socket.send('out');
  const seen = [];
  socket.addEventListener('message', e => seen.push(e.data));
  socket.serverSends('in');
  assert.deepEqual(socket.sent, ['out']);
  assert.deepEqual(seen, []);
});

test('keeps order behind a delayed frame', async () => {
  const { window } = setup([ws({ wsAction: 'delay', wsMatch: 'slow', delayMs: 30 })]);
  const socket = new window.WebSocket('wss://x.test/feed');
  const seen = [];
  socket.addEventListener('message', e => seen.push(e.data));
  socket.serverSends('slow 1');
  socket.serverSends('fast 2');
  assert.deepEqual(seen, []);
  await tick(60);
  assert.deepEqual(seen, ['slow 1', 'fast 2']);
});

test('drops queued frames when the socket closes', async () => {
  const { window } = setup([ws({ wsDirection: 'send', wsAction: 'delay', delayMs: 20 })]);
  const socket = new window.WebSocket('wss://x.test/feed');
  socket.send('late');
  socket.close();
  await tick(40);
  assert.deepEqual(socket.sent, []);
});

test('passes binary frames and other URLs untouched', () => {
  const { window, reports } = setup([ws({ wsAction: 'block' })]);
  const socket = new window.WebSocket('wss://x.test/feed');
  const other = new window.WebSocket('wss://other.test/feed');
  const buffer = new ArrayBuffer(2);
  socket.send(buffer);
  other.send('text');
  assert.equal(socket.sent[0], buffer);
  assert.deepEqual(other.sent, ['text']);
  assert.deepEqual(reports, []);
});

test('first matching enabled rule wins; disabled and http rules are ignored', () => {
  const { window } = setup([
    { pattern: '*', body: 'http', mode: 'text' },
    ws({ wsAction: 'replace', body: 'disabled', enabled: false }),
    ws({ wsAction: 'replace', body: 'first' }),
    ws({ wsAction: 'replace', body: 'second' }),
  ]);
  const socket = new window.WebSocket('wss://x.test/feed');
  const seen = [];
  socket.addEventListener('message', e => seen.push(e.data));
  socket.serverSends('x');
  assert.deepEqual(seen, ['first']);
});

test('an invalid regex skips the rule and is reported once', () => {
  const { window, reports } = setup([
    ws({ wsAction: 'block', wsMatch: '(', wsMatchRegex: true }),
    ws({ wsAction: 'replace', body: 'fallback' }),
  ]);
  const socket = new window.WebSocket('wss://x.test/feed');
  const seen = [];
  socket.addEventListener('message', e => seen.push(e.data));
  socket.serverSends('a');
  socket.serverSends('b');
  assert.deepEqual(seen, ['fallback', 'fallback']);
  assert.equal(reports.filter(r => r.event === 'error').length, 1);
  assert.equal(reports[0].pattern, 'wss://x.test/*');
});

test('processes templates in the replacement unless turned off', () => {
  const { window } = setup([ws({ wsAction: 'replace', body: '{{epoch}}' })]);
  const socket = new window.WebSocket('wss://x.test/feed');
  const seen = [];
  socket.addEventListener('message', e => seen.push(e.data));
  socket.serverSends('x');
  assert.match(seen[0], /^\d+$/);

  const off = setup([ws({ wsAction: 'replace', body: '{{epoch}}', processTemplates: false })]);
  const socket2 = new off.window.WebSocket('wss://x.test/feed');
  const seen2 = [];
  socket2.addEventListener('message', e => seen2.push(e.data));
  socket2.serverSends('x');
  assert.deepEqual(seen2, ['{{epoch}}']);
});

test('keeps WebSocket identity and constants', () => {
  const { window } = setup([]);
  const socket = new window.WebSocket('wss://x.test/feed');
  assert.equal(window.WebSocket.name, 'WebSocket');
  assert.equal(window.WebSocket.OPEN, 1);
  assert.ok(socket instanceof window.WebSocket);
  assert.ok(socket instanceof FakeWebSocket);
});

test('installing again swaps the rules instead of wrapping twice', () => {
  const { window, install } = setup([ws({ wsAction: 'replace', body: 'one' })]);
  const Wrapped = window.WebSocket;
  install([ws({ wsAction: 'replace', body: 'two' })]);
  assert.equal(window.WebSocket, Wrapped);
  const socket = new window.WebSocket('wss://x.test/feed');
  const seen = [];
  socket.addEventListener('message', e => seen.push(e.data));
  socket.serverSends('x');
  assert.deepEqual(seen, ['two']);

  install([]);
  socket.serverSends('y');
  assert.deepEqual(seen, ['two', 'y']);
});
