/// <reference path="./types.ts" />
/// <reference path="./modal.ts" />
/// <reference path="./primitives.ts" />

namespace NetworkOverridesUi {
  export function renderRulesList(
    elements: Elements,
    state: UiState,
    onEdit: (index: number) => void,
    onToggle: (index: number, enabled: boolean) => void,
    onDelete: (index: number) => void,
    onDuplicate: (index: number) => void
  ): void {
    elements.listEl.innerHTML = '';
    state.overrides.forEach((rule, index) => {
      const li = document.createElement('li');
      li.className = 'override-item';

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

      li.appendChild(cb);
      li.appendChild(span);
      li.appendChild(actionsDiv);
      elements.listEl.appendChild(li);
    });
  }
}
