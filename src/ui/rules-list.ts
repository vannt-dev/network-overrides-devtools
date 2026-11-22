/*! SPDX-License-Identifier: MIT | Copyright (c) 2025 Van Nguyen | github.com/vannt-dev/network-overrides-devtools */
/// <reference path="./types.ts" />
/// <reference path="./modal.ts" />
/// <reference path="./primitives.ts" />
/// <reference path="./view-utils.ts" />
/// <reference path="./websocket-rule.ts" />
/// <reference path="./rule-summary.ts" />

namespace NetworkOverridesUi {
  /** One line per query, header and body condition of a rule, for the list's tooltip. */
  export function describeMatchConditions(rule: OverrideRule): string[] {
    const lines: string[] = [];
    if (rule.matchQuery?.length) {
      lines.push(t('detail_query', NetworkOverridesUtils.formatQueryConditions(rule.matchQuery)));
    }
    for (const header of rule.matchHeaders || []) {
      lines.push(
        typeof header.value === 'string'
          ? t('detail_header_value', header.name, header.value)
          : t('detail_header', header.name)
      );
    }
    if (rule.matchBody) lines.push(t('detail_body_contains', rule.matchBody));
    return lines;
  }

  /** The longer lines behind a rule's one-line summary, for its tooltip. */
  export function describeRuleDetails(rule: OverrideRule): string[] {
    const lines = [summarizeRule(rule)];
    const conditions = describeMatchConditions(rule);
    if (rule.kind !== 'websocket' && conditions.length > 0) {
      lines.push(t('detail_only_when'), ...conditions);
    }
    if (rule.mode === 'patch' && rule.kind !== 'websocket' && !rule.failReason) {
      lines.push(t('detail_patch'), NetworkOverridesUtils.formatPatchOperations(rule.patch));
    }
    if (rule.respondAtRequest && !rule.failReason && !rule.redirectUrl) {
      lines.push(t('detail_no_server'));
    }
    lines.push(t('detail_click_to_edit'));
    return lines;
  }

  /** What a rule's hit badge says, in its tooltip and to a screen reader. */
  export function describeRuleHit(hit: RuleHit | undefined, idle: boolean): string[] {
    if (!hit || hit.count < 1) {
      return idle ? [t('hits_idle'), t('hits_idle_check')] : [t('hits_none')];
    }
    const lines = [hit.count === 1 ? t('hits_count_one') : t('hits_count_other', hit.count)];
    if (Number.isFinite(hit.lastAt)) {
      lines.push(t('hits_last', new Date(hit.lastAt).toLocaleTimeString()));
    }
    if (hit.lastUrl) lines.push(hit.lastUrl);
    return lines;
  }

  /**
   * Fills the hit badges of the rendered rules from `state.ruleHits`, in
   * place: counts arrive while the user may be dragging or tabbing through
   * the list, so it is not rebuilt for them.
   */
  export function updateRuleHitBadges(elements: Elements, state: UiState): void {
    const mayHint = state.enabled && state.attached && state.trafficSeen;
    elements.listEl.querySelectorAll<HTMLElement>('.rule-hits').forEach(badge => {
      const hit = state.ruleHits[badge.dataset.hitKey || ''];
      const count = hit && hit.count > 0 ? hit.count : 0;
      const idle = count === 0 && mayHint && badge.dataset.hint === 'true';
      const text = count > 999 ? '999+' : String(count);
      const lines = describeRuleHit(hit, idle);
      const title = lines.join('\n');
      if (badge.textContent !== text) badge.textContent = text;
      if (badge.title !== title) {
        badge.title = title;
        badge.setAttribute('aria-label', lines.join('. '));
      }
      badge.classList.toggle('rule-hits--active', count > 0);
      badge.classList.toggle('rule-hits--idle', idle);
    });
  }

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

    const hitKeys = NetworkOverridesUtils.ruleHitKeys(state.overrides);

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
      handle.title = t('rule_drag_title');
      handle.setAttribute('aria-label', t('rule_drag_label', rule.pattern));
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
      cb.title = isEnabled ? t('rule_disable') : t('rule_enable');
      cb.addEventListener('change', e => {
        e.stopPropagation();
        onToggle(index, cb.checked);
      });

      const span = document.createElement('span');
      span.className = 'rule-pattern';

      if (rule.isGlobal) {
        const globalBadge = document.createElement('span');
        globalBadge.className = 'global-badge rule-global-badge';
        globalBadge.textContent = t('rule_global_badge');
        globalBadge.style.cssText =
          'background:#7c3aed;color:#fff;padding:1px 4px;border-radius:3px;font-size:10px;margin-right:4px;font-weight:bold;';
        span.appendChild(globalBadge);
      }

      // One line: what the rule matches → what it does. The editor holds the rest.
      const summary = document.createElement('span');
      summary.className = 'rule-summary';
      summary.textContent = summarizeRule(rule);
      summary.title = describeRuleDetails(rule).join('\n');
      span.appendChild(summary);

      span.addEventListener('click', () => onEdit(index));

      // How often the rule was applied; filled by updateRuleHitBadges.
      const hitBadge = document.createElement('span');
      hitBadge.className = 'rule-hits';
      hitBadge.dataset.hitKey = hitKeys[index];
      // WebSocket frames are not in the captured traffic, so no hint there.
      hitBadge.dataset.hint = String(isEnabled && rule.kind !== 'websocket');
      hitBadge.setAttribute('role', 'note');
      hitBadge.tabIndex = 0;
      hitBadge.addEventListener('click', e => e.stopPropagation());

      const actionsDiv = document.createElement('div');
      actionsDiv.className = 'rule-actions';

      const editBtn = createUiButton(t('rule_edit'), {
        className: 'action-btn edit-btn',
        variant: 'ghost',
        size: 'small',
        title: t('rule_edit_title'),
      });
      editBtn.addEventListener('click', e => {
        e.stopPropagation();
        onEdit(index);
      });

      const dupBtn = createUiButton(t('rule_copy'), {
        className: 'action-btn duplicate-btn',
        variant: 'ghost',
        size: 'small',
        title: t('rule_copy_title'),
      });
      dupBtn.addEventListener('click', e => {
        e.stopPropagation();
        onDuplicate(index);
      });

      const delBtn = createUiButton(t('rule_delete'), {
        className: 'action-btn delete-btn del-btn',
        variant: 'danger',
        size: 'small',
        title: t('rule_delete_title'),
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
      li.appendChild(hitBadge);
      li.appendChild(actionsDiv);
      fragment.appendChild(li);
    });
    elements.listEl.appendChild(fragment);
    updateRuleHitBadges(elements, state);
  }
}
