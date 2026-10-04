/// <reference path="../shared.ts" />
/// <reference path="../utils.ts" />

// Runs in the page's main world, wrapped in `(function (rules) { … })` by
// scripts/bundle.mjs together with utils.js. Nothing here may touch extension
// APIs: the page talks back only through the `__nowsReport` CDP binding.
namespace NetworkOverridesInjected {
  type OverrideRule = NetworkOverridesShared.OverrideRule;
  type Direction = 'send' | 'receive';

  export type Outcome =
    | { kind: 'pass' }
    | { kind: 'drop' }
    | { kind: 'deliver'; data: string; delayMs: number };

  const INSTALLED = '__networkOverridesWsWrapper';
  const REDISPATCHED = '__networkOverridesRedispatched';
  const QUEUES = '__networkOverridesWsQueues';

  const regexCache = new Map<string, RegExp | null>();

  function compile(
    rule: OverrideRule,
    flags: string,
    onRegexError: (rule: OverrideRule, message: string) => void
  ): RegExp | null {
    const source = rule.wsMatchRegex
      ? rule.wsMatch || ''
      : NetworkOverridesUtils.escapeRegex(rule.wsMatch || '');
    const key = `${flags}/${source}`;
    if (regexCache.has(key)) return regexCache.get(key) as RegExp | null;
    let regex: RegExp | null = null;
    try {
      regex = new RegExp(source, flags);
    } catch (error) {
      onRegexError(rule, error instanceof Error ? error.message : String(error));
    }
    regexCache.set(key, regex);
    return regex;
  }

  export function applyRules(
    rules: OverrideRule[],
    url: string,
    direction: Direction,
    data: string,
    onRegexError: (rule: OverrideRule, message: string) => void
  ): Outcome {
    for (const rule of rules) {
      if (rule.kind !== 'websocket' || rule.enabled === false) continue;
      const ruleDirection = rule.wsDirection || 'receive';
      if (ruleDirection !== 'both' && ruleDirection !== direction) continue;
      const captures = NetworkOverridesUtils.matchPattern(rule.pattern, url);
      if (captures === null) continue;
      if (rule.wsMatch) {
        const matcher = compile(rule, '', onRegexError);
        if (!matcher || !matcher.test(data)) continue;
      }

      const template = (text: string) =>
        rule.processTemplates === false
          ? text
          : NetworkOverridesUtils.processResponseTemplate(text, captures, url);

      switch (rule.wsAction) {
        case 'block':
          return { kind: 'drop' };
        case 'delay':
          return { kind: 'deliver', data, delayMs: Math.max(0, rule.delayMs || 0) };
        case 'substitute': {
          const global = compile(rule, 'g', onRegexError);
          if (!global) continue;
          return {
            kind: 'deliver',
            data: data.replace(global, template(rule.body || '')),
            delayMs: 0,
          };
        }
        case 'replace':
        default:
          return { kind: 'deliver', data: template(rule.body || ''), delayMs: 0 };
      }
    }
    return { kind: 'pass' };
  }

  /** Runs frames one after another so a delayed frame holds back the ones behind it. */
  class FrameQueue {
    private items: { delayMs: number; run: () => void }[] = [];
    private busy = false;
    private timer: ReturnType<typeof setTimeout> | undefined;
    private closed = false;

    get idle(): boolean {
      return !this.busy && this.items.length === 0;
    }

    push(delayMs: number, run: () => void): void {
      if (this.closed) return;
      this.items.push({ delayMs, run });
      if (!this.busy) this.next();
    }

    close(): void {
      this.closed = true;
      this.items = [];
      if (this.timer !== undefined) clearTimeout(this.timer);
      this.busy = false;
    }

    private next(): void {
      const item = this.items.shift();
      if (!item) {
        this.busy = false;
        return;
      }
      this.busy = true;
      const step = () => {
        this.timer = undefined;
        try {
          item.run();
        } finally {
          this.next();
        }
      };
      if (item.delayMs > 0) this.timer = setTimeout(step, item.delayMs);
      else step();
    }
  }

  export function install(win: any, initialRules: OverrideRule[]): void {
    const existing = win[INSTALLED];
    if (existing) {
      existing.setRules(initialRules);
      return;
    }

    let rules: OverrideRule[] = Array.isArray(initialRules) ? initialRules : [];
    const reportedErrors = new Set<string>();
    const report = (payload: object) => {
      try {
        if (typeof win.__nowsReport === 'function') win.__nowsReport(JSON.stringify(payload));
      } catch {}
    };
    const onRegexError = (rule: OverrideRule, message: string) => {
      const key = `${rule.pattern}\u0000${rule.wsMatch}`;
      if (reportedErrors.has(key)) return;
      reportedErrors.add(key);
      report({ event: 'error', pattern: rule.pattern, message });
    };
    const decide = (url: string, direction: Direction, data: unknown): Outcome => {
      if (typeof data !== 'string' || rules.length === 0) return { kind: 'pass' };
      try {
        const outcome = applyRules(rules, url, direction, data, onRegexError);
        if (outcome.kind !== 'pass') report({ event: 'applied' });
        return outcome;
      } catch {
        // Fail open: a broken rule must never break the page's socket.
        return { kind: 'pass' };
      }
    };

    const Native = win.WebSocket;
    const nativeSend = Native.prototype.send;
    const nativeAddEventListener = Native.prototype.addEventListener;

    class WebSocket extends Native {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        const socket = this as any;
        const receiveQueue = new FrameQueue();
        const sendQueue = new FrameQueue();
        socket[QUEUES] = { sendQueue };

        nativeAddEventListener.call(
          socket,
          'message',
          (event: any) => {
            if (event[REDISPATCHED]) return;
            const outcome = decide(socket.url, 'receive', event.data);
            if (outcome.kind === 'pass' && receiveQueue.idle) return;
            event.stopImmediatePropagation();
            if (outcome.kind === 'drop') return;
            const data = outcome.kind === 'deliver' ? outcome.data : event.data;
            const delayMs = outcome.kind === 'deliver' ? outcome.delayMs : 0;
            receiveQueue.push(delayMs, () => {
              const replay = new win.MessageEvent('message', {
                data,
                origin: event.origin,
                lastEventId: event.lastEventId,
              });
              replay[REDISPATCHED] = true;
              socket.dispatchEvent(replay);
            });
          },
          true
        );
        nativeAddEventListener.call(socket, 'close', () => {
          receiveQueue.close();
          sendQueue.close();
        });
      }

      send(data: any): void {
        const socket = this as any;
        const sendQueue: FrameQueue = socket[QUEUES].sendQueue;
        const outcome = decide(socket.url, 'send', data);
        if (outcome.kind === 'pass' && sendQueue.idle) {
          nativeSend.call(socket, data);
          return;
        }
        if (outcome.kind === 'drop') return;
        const payload = outcome.kind === 'deliver' ? outcome.data : data;
        const delayMs = outcome.kind === 'deliver' ? outcome.delayMs : 0;
        sendQueue.push(delayMs, () => {
          if (socket.readyState === Native.OPEN) nativeSend.call(socket, payload);
        });
      }
    }

    Object.defineProperty(WebSocket, 'name', { value: 'WebSocket' });
    win[INSTALLED] = {
      setRules(next: OverrideRule[]) {
        rules = Array.isArray(next) ? next : [];
      },
    };
    win.WebSocket = WebSocket;
  }
}
