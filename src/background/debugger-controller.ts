/// <reference types="chrome" />
/// <reference path="../shared.ts" />
/// <reference path="../utils.ts" />
/// <reference path="../tab-state.ts" />
namespace NetworkOverridesBackground {
  import TabState = NetworkOverridesTabState;

  async function enableInterception(tabId: number): Promise<void> {
    await sendDebugCommand(tabId, 'Network.enable', {});
    await sendDebugCommand(tabId, 'Fetch.enable', {
      patterns: [{ requestStage: 'Request' }, { requestStage: 'Response' }],
    });
  }

  function sendDebugCommand(tabId: number, method: string, params: object): Promise<void> {
    return new Promise((resolve, reject) => {
      chrome.debugger.sendCommand({ tabId }, method, params, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve();
        }
      });
    });
  }

  function broadcastStatus(tabId: number): void {
    const state = TabState.get(tabId);
    if (!state) return;
    const payload: { type: string; tabId: number; attached: boolean; error?: string } = {
      type: 'status',
      tabId,
      attached: state.attached,
    };
    if (state.attachError) payload.error = state.attachError;
    TabState.runtime(tabId).subscriberPorts.forEach(port => {
      try {
        port.postMessage(payload);
      } catch {}
    });
  }

  export function attachDebugger(tabId: number): Promise<void> {
    const state = TabState.ensure(tabId);
    const rt = TabState.runtime(tabId);
    if (state.attached) return Promise.resolve();
    if (rt.attachPromise) return rt.attachPromise;

    const attempt = new Promise<void>((resolve, reject) => {
      try {
        chrome.debugger.attach({ tabId }, '1.3', async () => {
          if (chrome.runtime.lastError) {
            const message = chrome.runtime.lastError.message || 'attach failed';
            // Debugger sessions belong to the extension, not the worker
            // instance, so our own session survives a worker restart and makes
            // this attach fail. If commands still work, adopt that session;
            // if they fail too, a foreign debugger (e.g. DevTools) owns the tab.
            if (/already attached/i.test(message)) {
              try {
                await enableInterception(tabId);
                return resolve();
              } catch {
                return reject(new Error(message));
              }
            }
            return reject(new Error(message));
          }
          try {
            await enableInterception(tabId);
            resolve();
          } catch (err) {
            chrome.debugger.detach({ tabId }, () => {});
            reject(err instanceof Error ? err : new Error(String(err)));
          }
        });
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    })
      .then(() => {
        state.attached = true;
        state.attachError = undefined;
        TabState.schedulePersist(tabId);
        broadcastStatus(tabId);
      })
      .catch(error => {
        state.attached = false;
        state.attachError = error instanceof Error ? error.message : String(error);
        state.enabled = false;
        TabState.schedulePersist(tabId);
        broadcastStatus(tabId);
        throw error;
      })
      .finally(() => {
        rt.attachPromise = null;
      });

    rt.attachPromise = attempt;
    return attempt;
  }

  export async function detachDebugger(tabId: number): Promise<void> {
    if (!TabState.get(tabId)?.attached) return;

    return new Promise(resolve => {
      try {
        chrome.debugger.sendCommand({ tabId }, 'Fetch.disable', {}, () => {
          chrome.debugger.detach({ tabId }, () => {
            TabState.dispose(tabId);
            resolve();
          });
        });
      } catch (error) {
        console.error(error);
        resolve();
      }
    });
  }

  chrome.tabs.onRemoved.addListener(tabId => {
    if (TabState.get(tabId)?.attached) {
      detachDebugger(tabId).catch(console.error);
    }
    TabState.dispose(tabId);
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (typeof changeInfo.url !== 'string') return;
    const state = TabState.get(tabId);
    if (!state) return;
    const newOrigin = NetworkOverridesUtils.getOrigin(changeInfo.url);
    if (!newOrigin || newOrigin === state.origin) return;

    state.origin = newOrigin;
    state.recentApis.clear();
    state.recentApiBodies.clear();
    const overridesKey = `overrides_${newOrigin}`;
    chrome.storage.local.get([overridesKey], (data: any) => {
      if (state.origin !== newOrigin) return;
      const saved = data?.[overridesKey];
      state.overrides = Array.isArray(saved) ? saved : [];
      TabState.schedulePersist(tabId);
    });
  });

  chrome.debugger.onDetach.addListener((source, reason) => {
    const tabId = source.tabId;
    if (typeof tabId !== 'number') return;
    // The tab is still open (infobar Cancel, DevTools takeover, browser-side
    // teardown) — keep captured data and rules, only record that interception
    // stopped. enabled goes off so a worker restart honors the cancellation.
    const state = TabState.get(tabId);
    if (!state) return;
    state.attached = false;
    state.enabled = false;
    state.attachError = `Debugger detached (${reason || 'unknown reason'})`;
    TabState.schedulePersist(tabId);
    broadcastStatus(tabId);
  });

  chrome.debugger.onEvent.addListener((source, method, params: any) => {
    const tabId = source.tabId;
    if (typeof tabId !== 'number') return;

    if (method === 'Fetch.requestPaused') {
      handleRequestPaused(tabId, params);
      return;
    }

    if (!TabState.get(tabId)?.attached) return;

    if (method === 'Network.requestWillBeSent') {
      const requestUrlInner = params?.request?.url;
      const requestType = params?.type || 'other';
      if (typeof requestUrlInner === 'string') {
        recordApi(tabId, {
          url: requestUrlInner,
          type: requestType,
          method: params.request.method,
          headers: toFetchHeaders(params.request.headers),
          postData: params.request.postData,
        });
      }
      return;
    }
  });

  async function migrateLegacyLocalKeys(): Promise<void> {
    try {
      const all: Record<string, unknown> = await Promise.resolve(chrome.storage.local.get(null));
      const legacy = Object.keys(all || {}).filter(
        key => key.startsWith('recentApis_') || key.startsWith('recentApiBodies_')
      );
      if (legacy.length > 0) {
        await Promise.resolve(chrome.storage.local.remove(legacy));
      }
    } catch {
      // Non-fatal: migration retries on the next worker start.
    }
  }

  export const ready: Promise<void> = (async () => {
    const reattach = await TabState.rehydrate();
    for (const tabId of reattach) {
      // attachDebugger's catch already records the error and disables the tab.
      await attachDebugger(tabId).catch(error => {
        console.error('[NetworkOverrides] Re-attach failed for tab', tabId, error);
      });
    }
    await migrateLegacyLocalKeys();
  })();
}
