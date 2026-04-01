// ===== DOM ELEMENTS =====
const enableCheckbox = document.getElementById('enable');
const patternInput = document.getElementById('pattern');
const bodyInput = document.getElementById('body');
const addBtn = document.getElementById('add');
const listEl = document.getElementById('list');
const modeSelect = document.getElementById('mode');
const apisSection = document.getElementById('apis-section');
const apisList = document.getElementById('apis-list');
const modal = document.getElementById('override-modal');
const modalUrl = document.getElementById('modal-url');
const modalMode = document.getElementById('modal-mode');
const modalBody = document.getElementById('modal-body');
const saveOverrideBtn = document.getElementById('save-override');
const closeModal = document.querySelector('.close');
newRow = document.getElementById('new-row');  // Hide manual for now, APIs focus
newRow.style.display = 'none';

let overrides = [];
let apis = [];
let selectedApi = null;

async function loadApis() {
    const tabId = await getActiveTabId();
    chrome.runtime.sendMessage({ type: 'getApis', tabId }, (response) => {
        if (response?.apis) {
            apis = response.apis;
            renderApis();
            if (apis.length > 0) {
                apisSection.style.display = 'block';
            }
        }
    });
}

function renderApis() {
    apisList.innerHTML = '';
    apis.forEach(url => {
        const li = document.createElement('li');
        li.className = 'api-item';
        li.dataset.url = url;
        li.innerHTML = `<b title="Click to override">${escapeHtml(url)}</b>`;
        li.addEventListener('click', () => openOverrideModal(url));
        apisList.appendChild(li);
    });
}


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


function renderList() {
    listEl.innerHTML = '';
    overrides.forEach((o, i) => {
        const li = document.createElement('li');
        li.className = 'override-item';
        li.innerHTML = `
            <b>Pattern:</b> ${escapeHtml(o.pattern)}
            <button data-index="${i}" class="del-btn">Delete</button>
            <pre>${escapeHtml((o.body || '').substring(0, 400))}${ (o.body || '').length > 400 ? '...' : ''}</pre>
        `;
        listEl.appendChild(li);
    });
}

function openOverrideModal(url) {
    selectedApi = url;
    modalUrl.textContent = url;
    modal.style.display = 'block';
    modalBody.value = '';
    modalMode.value = 'text';
    modalBody.focus();
}

function closeOverrideModal() {
    modal.style.display = 'none';
    selectedApi = null;
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
    if (e.target.classList.contains('del-btn')) {
        const i = Number(e.target.dataset.index);
        overrides.splice(i, 1);
        await chrome.storage.local.set({ overrides });
        renderList();
        notifyBackground();
    }
});

// Modal events
closeModal.addEventListener('click', closeOverrideModal);
window.addEventListener('click', (e) => {
    if (e.target === modal) closeOverrideModal();
});

saveOverrideBtn.addEventListener('click', async () => {
    if (!selectedApi) return;
    const mode = modalMode.value;
    const body = modalBody.value || '';
    overrides.unshift({ pattern: selectedApi, body, mode }); // Add to front for recency
    await chrome.storage.local.set({ overrides });
    renderList();
    notifyBackground();
    closeOverrideModal();
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

    loadApis();  // Load recent APIs
    
    // Notify background when popup opens (ensures debugger attach)
    notifyBackground();
})();
