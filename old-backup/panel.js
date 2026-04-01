const enableCheckbox = document.getElementById('enable');
const patternInput = document.getElementById('pattern');
const bodyInput = document.getElementById('body');
const addBtn = document.getElementById('add');
const listEl = document.getElementById('list');
const modeSelect = document.getElementById('mode');


let overrides = [];


function renderList() {
    listEl.innerHTML = '';
    overrides.forEach((o, i) => {
        const li = document.createElement('li');
        li.className = 'override-item';
        li.innerHTML = `<b>Pattern:</b> ${escapeHtml(o.pattern)} <button data-i="${i}">Delete</button>
<pre>${escapeHtml(o.body.slice(0, 1000))}${o.body.length > 1000 ? '...' : ''}</pre>`;
        listEl.appendChild(li);
    });
}


function escapeHtml(s) { return s.replace(/[&<>\"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }


addBtn.addEventListener('click', async () => {
    const pattern = patternInput.value.trim();
    if (!pattern) return alert('Pattern required');
    const mode = modeSelect.value;
    let body = bodyInput.value || '';
    if (mode === 'file') {
        // assume user pasted base64 body
    }
    overrides.push({ pattern, body, mode });
    await chrome.storage.local.set({ overrides });
    renderList();
    notifyBackground();
});


listEl.addEventListener('click', async (e) => {
    if (e.target.matches('button')) {
        const i = Number(e.target.dataset.i);
        overrides.splice(i, 1);
        await chrome.storage.local.set({ overrides });
        renderList();
        notifyBackground();
    }
});


enableCheckbox.addEventListener('change', async () => {
    await chrome.storage.local.set({ enabled: enableCheckbox.checked });
    notifyBackground();
});


async function notifyBackground() {
    const tabId = chrome.devtools.inspectedWindow.tabId;
    const data = await chrome.storage.local.get(['enabled', 'overrides']);
    chrome.runtime.sendMessage({ type: 'update', tabId, enabled: !!data.enabled, overrides: data.overrides || [] });
}


// init
(async function init() {
    const data = await chrome.storage.local.get(['enabled', 'overrides']);
    overrides = data.overrides || [];
    enableCheckbox.checked = !!data.enabled;
    renderList();
    // notify background initially so it's ready
    notifyBackground();
})();