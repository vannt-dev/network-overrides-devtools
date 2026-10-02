/// <reference path="./types.ts" />
/// <reference path="./modal.ts" />
/// <reference path="./primitives.ts" />
/// <reference path="./view-utils.ts" />

namespace NetworkOverridesUi {
  export function renderRulesList(
    elements: Elements,
    state: UiState,
    onEdit: (index: number) => void,
    onToggle: (index: number, enabled: boolean) => void,
    onDelete: (index: number) => void,
    onDuplicate: (index: number) => void,
    onMove: (from: number, target: number, placement: RulePlacement) => void = () => {}
  ): void {
    elements.listEl.innerHTML = '';
    const fragment = document.createDocumentFragment();
    // Index of the rule being dragged; null between drags.
    let dragIndex: number | null = null;
    const clearDropMarkers = () => {
      elements.listEl
        .querySelectorAll('.override-item--drop-before, .override-item--drop-after')
        .forEach(item =>
          item.classList.remove('override-item--drop-before', 'override-item--drop-after')
        );
    };

    state.overrides.forEach((rule, index) => {
      const li = document.createElement('li');
      li.className = 'override-item';

      const canDropHere = () =>
        dragIndex !== null &&
        dragIndex !== index &&
        isSameRuleGroup(state.overrides[dragIndex], rule);
      // The upper half of a row drops before it, the lower half after it.
      const placementFor = (event: DragEvent): RulePlacement => {
        const bounds = li.getBoundingClientRect();
        return event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after';
      };

      const handle = document.createElement('button');
      handle.type = 'button';
      handle.className = 'rule-drag-handle';
      handle.textContent = '⠿';
      handle.draggable = true;
      handle.title = 'Drag to reorder, or press the up and down arrow keys';
      handle.setAttribute('aria-label', `Reorder rule ${rule.pattern}`);
      handle.addEventListener('click', e => e.stopPropagation());
      handle.addEventListener('keydown', e => {
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
        e.preventDefault();
        e.stopPropagation();
        if (e.key === 'ArrowUp') onMove(index, index - 1, 'before');
        else onMove(index, index + 1, 'after');
      });
      handle.addEventListener('dragstart', e => {
        dragIndex = index;
        li.classList.add('override-item--dragging');
        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', String(index));
          e.dataTransfer.setDragImage(li, 0, 0);
        }
      });
      handle.addEventListener('dragend', () => {
        dragIndex = null;
        li.classList.remove('override-item--dragging');
        clearDropMarkers();
      });

      li.addEventListener('dragover', e => {
        if (!canDropHere()) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        clearDropMarkers();
        li.classList.add(`override-item--drop-${placementFor(e)}`);
      });
      li.addEventListener('dragleave', () => {
        li.classList.remove('override-item--drop-before', 'override-item--drop-after');
      });
      li.addEventListener('drop', e => {
        if (!canDropHere()) return;
        e.preventDefault();
        const from = dragIndex as number;
        dragIndex = null;
        clearDropMarkers();
        onMove(from, index, placementFor(e));
      });

      const isEnabled = rule.enabled !== false;
      if (!isEnabled) {
        li.classList.add('disabled-rule', 'override-item--disabled');
      }

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = isEnabled;
      cb.classList.add('rule-toggle', 'override-enabled-toggle');
      cb.title = isEnabled ? 'Disable rule' : 'Enable rule';
      cb.addEventListener('change', e => {
        e.stopPropagation();
        onToggle(index, cb.checked);
      });

      const span = document.createElement('span');
      span.className = 'rule-pattern';

      if (rule.isGlobal) {
        const globalBadge = document.createElement('span');
        globalBadge.className = 'global-badge rule-global-badge';
        globalBadge.textContent = 'GLOBAL';
        globalBadge.style.cssText =
          'background:#7c3aed;color:#fff;padding:1px 4px;border-radius:3px;font-size:10px;margin-right:4px;font-weight:bold;';
        span.appendChild(globalBadge);
      }

      const methodText = rule.method && rule.method !== 'ANY' ? rule.method : null;
      if (methodText) {
        const methodBadge = document.createElement('span');
        methodBadge.className = `rule-method-badge method-${methodText.toLowerCase()}`;
        methodBadge.textContent = methodText;
        span.appendChild(methodBadge);
      }

      if (rule.graphqlOperation) {
        const gqlBadge = document.createElement('span');
        gqlBadge.className = 'graphql-badge';
        gqlBadge.textContent = `GQL: ${rule.graphqlOperation}`;
        span.appendChild(gqlBadge);
      }

      const patternText = document.createTextNode(` ${rule.pattern} `);
      span.appendChild(patternText);

      if (rule.failReason) {
        const failBadge = document.createElement('span');
        failBadge.className = 'fail-badge override-fail-badge';
        failBadge.textContent = 'FAIL';
        failBadge.title = rule.failReason;
        span.appendChild(failBadge);
      } else if (rule.redirectUrl) {
        const redirSpan = document.createElement('span');
        redirSpan.className = 'redirect-text';
        redirSpan.textContent = ` ➔ ${rule.redirectUrl}`;
        span.appendChild(redirSpan);
      }

      if (typeof rule.statusCode === 'number') {
        const statusBadge = document.createElement('span');
        statusBadge.className = 'status-badge override-status-badge';
        statusBadge.textContent = `${rule.statusCode}`;
        span.appendChild(statusBadge);
      }

      if (typeof rule.delayMs === 'number' && rule.delayMs > 0) {
        const delayBadge = document.createElement('span');
        delayBadge.className = 'delay-badge override-delay-badge';
        delayBadge.textContent = `⏱ ${rule.delayMs}ms`;
        span.appendChild(delayBadge);
      }

      if (Array.isArray(rule.responseHeaders) && rule.responseHeaders.length > 0) {
        const headerBadge = document.createElement('span');
        headerBadge.className = 'header-badge';
        headerBadge.textContent = `+${rule.responseHeaders.length} res headers`;
        span.appendChild(headerBadge);
      }

      if (Array.isArray(rule.requestHeaders) && rule.requestHeaders.length > 0) {
        const reqHeaderBadge = document.createElement('span');
        reqHeaderBadge.className = 'header-badge';
        reqHeaderBadge.textContent = `+${rule.requestHeaders.length} req headers`;
        span.appendChild(reqHeaderBadge);
      }

      span.addEventListener('click', () => onEdit(index));

      const actionsDiv = document.createElement('div');
      actionsDiv.className = 'rule-actions';

      const editBtn = createUiButton('Edit', {
        className: 'action-btn edit-btn',
        variant: 'ghost',
        size: 'small',
        title: 'Edit rule',
      });
      editBtn.addEventListener('click', e => {
        e.stopPropagation();
        onEdit(index);
      });

      const dupBtn = createUiButton('Copy', {
        className: 'action-btn duplicate-btn',
        variant: 'ghost',
        size: 'small',
        title: 'Duplicate rule',
      });
      dupBtn.addEventListener('click', e => {
        e.stopPropagation();
        onDuplicate(index);
      });

      const delBtn = createUiButton('Delete', {
        className: 'action-btn delete-btn del-btn',
        variant: 'danger',
        size: 'small',
        title: 'Delete rule',
      });
      delBtn.addEventListener('click', e => {
        e.stopPropagation();
        onDelete(index);
      });

      actionsDiv.appendChild(editBtn);
      actionsDiv.appendChild(dupBtn);
      actionsDiv.appendChild(delBtn);

      li.appendChild(handle);
      li.appendChild(cb);
      li.appendChild(span);
      li.appendChild(actionsDiv);
      fragment.appendChild(li);
    });
    elements.listEl.appendChild(fragment);
  }
}
