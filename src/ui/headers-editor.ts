/// <reference path="./types.ts" />
/// <reference path="./primitives.ts" />

namespace NetworkOverridesUi {
  export function parseHeadersText(text: string): HeaderField[] {
    const lines = text.split('\n');
    const headers: HeaderField[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx > 0) {
        headers.push({
          name: trimmed.slice(0, colonIdx).trim(),
          value: trimmed.slice(colonIdx + 1).trim(),
        });
      }
    }
    return headers;
  }

  export function formatHeadersText(headers: HeaderField[]): string {
    return headers.map(h => `${h.name}: ${h.value}`).join('\n');
  }

  export function renderHeaderTable(
    tableContainer: HTMLDivElement,
    textarea: HTMLTextAreaElement
  ): void {
    const initialMode = tableContainer.dataset.editorMode === 'raw' ? 'raw' : 'table';
    tableContainer.innerHTML = '';
    const headers = parseHeadersText(textarea.value);

    const tableWrapper = document.createElement('div');
    tableWrapper.className = 'headers-table-wrapper';

    const modeToggle = document.createElement('div');
    modeToggle.className = 'headers-editor-mode';
    const tableModeBtn = createUiButton('Key-Value', {
      variant: 'ghost',
      size: 'small',
    });
    const rawModeBtn = createUiButton('Raw', { variant: 'ghost', size: 'small' });
    modeToggle.appendChild(tableModeBtn);
    modeToggle.appendChild(rawModeBtn);

    const rowsContainer = document.createElement('div');
    rowsContainer.className = 'headers-table-rows';

    function addRow(name = '', value = '') {
      const row = document.createElement('div');
      row.className = 'header-table-row';

      const keyInput = createUiInput({
        className: 'header-row-key',
        placeholder: 'Header name',
        value: name,
        ariaLabel: 'Header name',
      });

      const valInput = createUiInput({
        className: 'header-row-value',
        placeholder: 'Header value',
        value,
        ariaLabel: 'Header value',
      });

      const deleteBtn = createUiButton('×', {
        className: 'header-row-delete',
        variant: 'danger',
        size: 'small',
        title: 'Delete header',
        ariaLabel: 'Delete header',
      });

      const syncToTextarea = () => {
        const rows = Array.from(rowsContainer.querySelectorAll('.header-table-row'));
        const fields: HeaderField[] = [];
        rows.forEach(r => {
          const k = (r.querySelector('.header-row-key') as HTMLInputElement)?.value.trim();
          const v = (r.querySelector('.header-row-value') as HTMLInputElement)?.value.trim();
          if (k) fields.push({ name: k, value: v });
        });
        textarea.value = formatHeadersText(fields);
      };

      keyInput.addEventListener('input', syncToTextarea);
      valInput.addEventListener('input', syncToTextarea);
      deleteBtn.addEventListener('click', () => {
        row.remove();
        syncToTextarea();
      });

      row.appendChild(keyInput);
      row.appendChild(valInput);
      row.appendChild(deleteBtn);
      rowsContainer.appendChild(row);
    }

    headers.forEach(h => addRow(h.name, h.value));

    const addBtn = createUiButton('+ Add Header', {
      className: 'add-header-row-btn',
      variant: 'outline',
      size: 'small',
    });
    addBtn.addEventListener('click', () => addRow());

    const setMode = (mode: 'table' | 'raw') => {
      tableContainer.dataset.editorMode = mode;
      const tableMode = mode === 'table';
      rowsContainer.style.display = tableMode ? '' : 'none';
      addBtn.style.display = tableMode ? '' : 'none';
      textarea.style.display = tableMode ? 'none' : '';
      tableModeBtn.classList.toggle('active', tableMode);
      rawModeBtn.classList.toggle('active', !tableMode);
    };
    tableModeBtn.addEventListener('click', () => setMode('table'));
    rawModeBtn.addEventListener('click', () => setMode('raw'));

    tableWrapper.appendChild(modeToggle);
    tableWrapper.appendChild(rowsContainer);
    tableWrapper.appendChild(addBtn);
    tableContainer.appendChild(tableWrapper);
    setMode(initialMode);

    // Sync when textarea is edited directly
    textarea.oninput = () => {
      const newHeaders = parseHeadersText(textarea.value);
      rowsContainer.innerHTML = '';
      newHeaders.forEach(h => addRow(h.name, h.value));
    };
  }
}
