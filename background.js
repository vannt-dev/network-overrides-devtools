// Background manages debugger lifecycle and paused events
const attachedTabs = new Set();
const overridesMap = new Map(); // tabId -> { enabled, overrides }


chrome.runtime.onMessage.addListener((msg, sender) => {
    if (msg && msg.type === 'update') {
        const tabId = msg.tabId;
        overridesMap.set(tabId, { enabled: msg.enabled, overrides: msg.overrides || [] });
        if (msg.enabled) {
            attachDebugger(tabId).catch(console.error);
        } else {
            detachDebugger(tabId).catch(console.error);
        }
    }
});


async function attachDebugger(tabId) {
    if (attachedTabs.has(tabId)) return;
    try {
        chrome.debugger.attach({ tabId: tabId }, '1.3', () => {
            if (chrome.runtime.lastError) { console.error('attach failed', chrome.runtime.lastError); return; }
            attachedTabs.add(tabId);
            // Enable Fetch with requestPaused events for responses
            chrome.debugger.sendCommand({ tabId }, 'Fetch.enable', { patterns: [{ requestStage: 'Response' }] }, () => {
                if (chrome.runtime.lastError) console.error('Fetch.enable failed', chrome.runtime.lastError);
            });
        });
    } catch (e) { console.error(e); }
}

async function detachDebugger(tabId) {
    if (!attachedTabs.has(tabId)) return;
    try {
        // disable Fetch
        chrome.debugger.sendCommand({ tabId }, 'Fetch.disable', {}, () => {
            chrome.debugger.detach({ tabId: tabId }, () => {
                attachedTabs.delete(tabId);
            });
        });
    } catch (e) { console.error(e); }
}


// Listen to debugger events
chrome.debugger.onEvent.addListener(async (source, method, params) => {
    if (method === 'Fetch.requestPaused') {
        const tabId = source.tabId;
        const info = overridesMap.get(tabId);
        if (!info || !info.enabled) {
            // continue the request normally
            chrome.debugger.sendCommand({ tabId }, 'Fetch.continueRequest', { requestId: params.requestId });
            return;
        }


        try {
            const url = params.request.url || '';
            // find override by simple contains match
            const ov = (info.overrides || []).find(o => url.includes(o.pattern));
            if (!ov) {
                chrome.debugger.sendCommand({ tabId }, 'Fetch.continueRequest', { requestId: params.requestId });
                return;
            }


            // Prepare response
            let responseBodyBase64;
            if (ov.mode === 'file') {
                // assume user provided base64 body
                responseBodyBase64 = ov.body;
            } else {
                // text mode - encode to base64 (utf-8)
                responseBodyBase64 = btoa(unescape(encodeURIComponent(ov.body)));
            }


            const headers = params.responseHeaders || [];
            // ensure content-type present
            if (!headers.find(h => h.name.toLowerCase() === 'content-type')) {
                headers.push({ name: 'Content-Type', value: 'application/json; charset=utf-8' });
            }


            // fulfill request with our body
            chrome.debugger.sendCommand({ tabId }, 'Fetch.fulfillRequest', {
                requestId: params.requestId,
                responseCode: 200,
                responseHeaders: headers,
                body: responseBodyBase64
            }, () => {
                if (chrome.runtime.lastError) console.error('fulfillRequest failed', chrome.runtime.lastError);
            });
        } catch (err) {
            console.error(err);
            // fallback
            chrome.debugger.sendCommand({ tabId }, 'Fetch.continueRequest', { requestId: params.requestId });
        }
    }
});


// Helper: base64 helpers for node-like env (not used in background but left for reference)