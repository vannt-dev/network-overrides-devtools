/// <reference types="chrome" />

namespace NetworkOverridesPanel {
  const ui = NetworkOverridesUi.init({
    autoFillOnOpen: true,
    showManualEditor: true,
  });

  if (chrome.devtools && chrome.devtools.network) {
    chrome.devtools.network.getHAR(harLog => {
      if (harLog && harLog.entries) {
        const initialApis = harLog.entries
          .map(entry => ({
            url: entry.request?.url,
            type: entry._resourceType || 'other',
            method: entry.request?.method,
            headers: entry.request?.headers,
            postData: entry.request?.postData?.text,
          }))
          .filter(api => !!api.url) as NetworkOverridesShared.ApiEntry[];
        
        ui.addApis(initialApis);
      }
    });

    chrome.devtools.network.onRequestFinished.addListener(request => {
      if (request && request.request && request.request.url) {
        ui.addApis([
          {
            url: request.request.url,
            type: request._resourceType || 'other',
            method: request.request.method,
            headers: request.request.headers,
            postData: request.request.postData?.text,
          },
        ]);
      }
    });
  }
}
