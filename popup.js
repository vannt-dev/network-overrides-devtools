// ===== DOM ELEMENTS =====
const enableCheckbox = document.getElementById('enable');
const patternInput = document.getElementById('pattern');
const bodyInput = document.getElementById('body');
const addBtn = document.getElementById('add');
const listEl = document.getElementById('list');
const modeSelect = document.getElementById('mode');

let overrides = [];


// ===== HELPERS =====
function escapeHtml(s) {
    return s.replace(/[&<>"']/g, c => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[c]));
}

// Lấy tab đang active, để background biết cần attach debugger vào tab nào
function getActiveTabId() {
    return new Promise(resolve => {
        chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
            resolve(tabs[0].id);
        });
    });
}

// Gửi thông báo cập nhật tới background
async function notifyBackground() {
    const tabId = await getActiveTabId();
    const data = await chrome.storage.local.get(['enabled', 'overrides']);

    chrome.runtime.sendMessage({
        type: 'update',
        tabId,
        enabled: !!data.enabled,
        overrides: data.overrides || []
    });
}


// ===== UI RENDERING =====
function renderList() {
    listEl.innerHTML = '';

    overrides.forEach((o, i) => {
        const li = document.createElement('li');
        li.className = 'override-item';

        li.innerHTML = `
      <b>Pattern:</b> ${escapeHtml(o.pattern)}
      <button data-index="${i}" class="del-btn">Delete</button>
      <pre>${escapeHtml(o.body.substring(0, 400))}${o.body.length > 400 ? '...' : ''}</pre>
    `;

        listEl.appendChild(li);
    });
}


// ===== EVENT HANDLERS =====

// Add override
addBtn.addEventListener('click', async () => {
    const pattern = patternInput.value.trim();
    if (!pattern) return alert('Pattern is required');

    const mode = modeSelect.value;
    let body = bodyInput.value || '';

    overrides.push({ pattern, body, mode });
    await chrome.storage.local.set({ overrides });

    patternInput.value = '';
    bodyInput.value = '';

    renderList();
    notifyBackground();
});

// Delete override
listEl.addEventListener('click', async (e) => {
    if (!e.target.classList.contains('del-btn')) return;

    const i = Number(e.target.dataset.index);
    overrides.splice(i, 1);

    await chrome.storage.local.set({ overrides });

    renderList();
    notifyBackground();
});

// Enable/Disable override feature
enableCheckbox.addEventListener('change', async () => {
    await chrome.storage.local.set({ enabled: enableCheckbox.checked });
    notifyBackground();
});


// ===== INIT =====
(async function init() {
    const data = await chrome.storage.local.get(['enabled', 'overrides']);
    enableCheckbox.checked = !!data.enabled;

    overrides = data.overrides || [];
    renderList();

    // Notify background when popup opens (ensures debugger attach)
    notifyBackground();
})();
