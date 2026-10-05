// Manual end-to-end check for WebSocket frame rules: `npm run build && node scripts/e2e-websocket.mjs`.
// Starts a tiny echo server, loads the unpacked extension in Chromium,
// attaches it to a test page through the service worker, and checks that a
// receive-replace rule and a send-block rule both take effect.
import http from 'node:http';
import crypto from 'node:crypto';
import path from 'node:path';
import { chromium } from 'playwright';

function frame(text) {
  const payload = Buffer.from(text);
  const header = payload.length < 126 ? Buffer.from([0x81, payload.length]) : null;
  if (!header) throw new Error('keep test frames short');
  return Buffer.concat([header, payload]);
}

function readFrame(buffer) {
  const length = buffer[1] & 0x7f;
  const mask = buffer.subarray(2, 6);
  const data = buffer.subarray(6, 6 + length);
  return Buffer.from(data.map((byte, i) => byte ^ mask[i % 4])).toString();
}

const page = `<!doctype html><title>ws</title><script>
  window.received = [];
  const socket = new WebSocket('ws://' + location.host + '/echo');
  socket.onmessage = e => window.received.push(e.data);
  socket.onopen = () => { socket.send('ping'); socket.send('hello'); };
</script>`;

const server = http.createServer((req, res) => res.end(page));
server.on('upgrade', (req, socket) => {
  const accept = crypto
    .createHash('sha1')
    .update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');
  socket.write(
    `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`
  );
  // A reload resets the connection; that is expected here.
  socket.on('error', () => {});
  socket.on('data', chunk => {
    // Answer text frames only (opcode 1); ignore close and control frames.
    if ((chunk[0] & 0x0f) !== 1) return;
    socket.write(frame(`echo:${readFrame(chunk)}`));
  });
});
await new Promise(resolve => server.listen(0, resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

const extensionPath = path.resolve('.');
const context = await chromium.launchPersistentContext('', {
  headless: false,
  args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
});
try {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const tab = await context.newPage();
  await tab.goto(`${origin}/`);
  await worker.evaluate(async url => {
    const [target] = await chrome.tabs.query({ url: `${url}/*` });
    const state = NetworkOverridesTabState.ensure(target.id);
    state.enabled = true;
    // The panel sends the tab URL with every update; without an origin the
    // reload below looks like a navigation and reloads rules from storage.
    state.origin = url;
    state.overrides = [
      {
        pattern: '*',
        body: 'mocked',
        mode: 'text',
        kind: 'websocket',
        wsAction: 'replace',
        wsMatch: 'hello',
      },
      {
        pattern: '*',
        body: '',
        mode: 'text',
        kind: 'websocket',
        wsDirection: 'send',
        wsAction: 'block',
        wsMatch: 'ping',
      },
    ];
    await NetworkOverridesBackground.attachDebugger(target.id);
  }, origin);
  await tab.reload();
  await tab.waitForTimeout(1000);
  const received = await tab.evaluate(() => window.received);
  console.log('received:', received);
  if (JSON.stringify(received) !== JSON.stringify(['mocked'])) {
    throw new Error(
      `expected ["mocked"] (ping blocked, echo:hello replaced), got ${JSON.stringify(received)}`
    );
  }
  console.log('WebSocket e2e: OK');
} finally {
  await context.close();
  server.close();
}
