// Background manages debugger lifecycle, API collection, and overrides
const attachedTabs = new Set();
const overridesMap = new Map(); // tabId -> { enabled, overrides }
const recentApisMap = new Map(); // tabId -> Set of recent unique URLs (max 50)


chrome.runtime.onMessage.addListener((msg, sender) => {
    if (msg.type === 'update') {
        const tabId = msg.tabId;
        overridesMap.set(tabId, { enabled: msg.enabled, overrides: msg.overrides || [] });
        if (msg.enabled) {
            attachDebugger(tabId).catch(console.error);
        } else {
            detachDebugger(tabId).catch(console.error);
        }
    } else if (msg.type === 'getApis') {
        const tabId = msg.tabId;
        const apis = Array.from(recentApisMap.get(tabId) || []);
        chrome.runtime.sendMessage(sender, { type: 'apisResponse', apis });  // Direct response
    }
});


async function attachDebugger(tabId) {
    if (attachedTabs.has(tabId)) return;
    try {
        chrome.debugger.attach({ tabId: tabId }, '1.3', () => {
            if (chrome.runtime.lastError) { console.error('attach failed', chrome.runtime.lastError); return; }
            attachedTabs.add(tabId);
            // Enable Network and Fetch
            chrome.debugger.sendCommand({ tabId }, 'Network.enable', {}, () => {
                if (chrome.runtime.lastError) console.error('Network.enable failed');
            });
            chrome.debugger.sendCommand({ tabId }, 'Fetch.enable', { patterns: [{ requestStage: 'Response' }] }, () => {
                if (chrome.runtime.lastError) console.error('Fetch.enable failed');
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
                // cleanup per-tab state
                overridesMap.delete(tabId);
                recentApisMap.delete(tabId);
            });
        });
    } catch (e) { console.error(e); }
}

// cleanup when tab closes
chrome.tabs.onRemoved.addListener((tabId) => {
    if (attachedTabs.has(tabId)) {
        detachDebugger(tabId).catch(console.error);
    }
});

// Listen to debugger events
chrome.debugger.onEvent.addListener((source, method, params) => {
    const tabId = source.tabId;
    
    if (method === 'Network.requestWillBeSent') {
        // Collect unique recent APIs (max 50 per tab)
        let apis = recentApisMap.get(tabId) || new Set();
        apis.add(params.request.url);
        if (apis.size > 50) {
            const arr = Array.from(apis).slice(-50);
            apis = new Set(arr);
        }
        recentApisMap.set(tabId, apis);
        return;
    }
    
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
            // find override by string contains or regex pattern (/pattern/flags)
            const ov = (info.overrides || []).find(o => {
                if (!o.pattern) return false;
                if (o.pattern.startsWith('/') && o.pattern.lastIndexOf('/') > 0) {
                    const lastSlash = o.pattern.lastIndexOf('/');
                    const regexSource = o.pattern.slice(1, lastSlash);
                    const regexFlags = o.pattern.slice(lastSlash + 1);
                    try {
                        const re = new RegExp(regexSource, regexFlags);
                        return re.test(url);
                    } catch (_e) {
                        return false;
                    }
                }
                return url.includes(o.pattern);
            });
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
                responseBodyBase64 = btoa(unescape(encodeURIComponent(ov.body || '')));
            }


            const headers = params.responseHeaders || [];
            // ensure content-type present
            if (!headers.find(h => h.name.toLowerCase() === 'content-type')) {
                headers.push({ name: 'Content-Type', value: 'application/json; charset=utf-8' });
            }
            headers.push({ name: 'x-network-overrides', value: 'true' });
            headers.push({ name: 'x-network-overrides-pattern', value: ov.pattern });


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


// Clean up on detach
// Note: Maps cleared in detachDebugger if needed
