/*! SPDX-License-Identifier: MIT | Copyright (c) 2025 Van Nguyen | github.com/vannt-dev/network-overrides-devtools */
/// <reference path="./types.ts" />
/// <reference path="./primitives.ts" />
/// <reference path="./curl.ts" />
/// <reference path="./rule-summary.ts" />

namespace NetworkOverridesUi {
  export const TYPE_ORDER = [
    'xhr',
    'fetch',
    'script',
    'stylesheet',
    'image',
    'media',
    'font',
    'document',
    'websocket',
    'manifest',
    'eventsource',
    'texttrack',
    'other',
  ];

  export const TYPE_LABELS: Record<string, string> = {
    xhr: 'XHR',
    fetch: 'Fetch',
    script: 'JS',
    stylesheet: 'CSS',
    image: 'Img',
    media: 'Media',
    font: 'Font',
    document: 'Doc',
    websocket: 'WS',
    manifest: 'Manifest',
    eventsource: 'EventSource',
    texttrack: 'TextTrack',
    other: 'Other',
  };

  export function matchesMethod(
    ruleMethod: string | undefined,
    requestMethod: string | undefined
  ): boolean {
    return NetworkOverridesUtils.matchesMethod(ruleMethod, requestMethod);
  }

  export function getMatchingRuleStatus(
    api: UiApi,
    overrides: OverrideRule[]
  ): { rule: OverrideRule; index: number; isDisabledOnly: boolean } | null {
    let firstMatch: { rule: OverrideRule; index: number } | null = null;
    for (let i = 0; i < overrides.length; i++) {
      const rule = overrides[i];
      if ((rule.kind === 'websocket') !== (api.type.toLowerCase() === 'websocket')) continue;
      if (!matchesMethod(rule.method, api.method)) continue;
      const request = { url: api.url, headers: api.headers, body: api.postData };
      if (!NetworkOverridesUtils.matchesRequestConditions(rule, request)) continue;
      if (NetworkOverridesUtils.patternMatches(rule.pattern, api.url)) {
        if (!firstMatch) firstMatch = { rule, index: i };
        if (rule.enabled !== false) {
          return { rule, index: i, isDisabledOnly: false };
        }
      }
    }
    if (firstMatch) {
      return { rule: firstMatch.rule, index: firstMatch.index, isDisabledOnly: true };
    }
    return null;
  }

  export function renderCapturedApis(
    elements: Elements,
    state: UiState,
    onApiClick: (api: UiApi) => void
  ): void {
    elements.apisList.innerHTML = '';

    const filterText = state.apiFilter.toLowerCase().trim();
    const typeInputs = Array.from(document.querySelectorAll<HTMLInputElement>('.capture-type-cb'));
    const visibleTypes = typeInputs
      .filter(input => input.checked)
      .map(input => input.value.toLowerCase());
    const apisToRender = state.capturedApis.filter(api => {
      if (typeInputs.length > 0 && !visibleTypes.includes(api.type.toLowerCase())) return false;
      if (filterText && !api.url.toLowerCase().includes(filterText)) {
        return false;
      }
      const match = getMatchingRuleStatus(api, state.overrides);
      if (state.activeTab === 'overridden') {
        return match !== null;
      }
      return match === null;
    });

    const typeCounts: Record<string, number> = {};
    let capturedCount = 0;
    let overriddenCount = 0;

    state.capturedApis.forEach(api => {
      const t = api.type.toLowerCase();
      typeCounts[t] = (typeCounts[t] || 0) + 1;

      const match = getMatchingRuleStatus(api, state.overrides);
      if (match !== null && !match.isDisabledOnly) {
        overriddenCount++;
      } else {
        capturedCount++;
      }
    });

    typeInputs.forEach(input => {
      const typeVal = input.value.toLowerCase();
      const count = typeCounts[typeVal] || 0;
      const baseLabel = TYPE_LABELS[typeVal] || typeVal.toUpperCase();
      const parentLabel = input.parentElement;
      if (parentLabel) {
        const textNode = Array.from(parentLabel.childNodes).find(
          n => n.nodeType === Node.TEXT_NODE
        );
        if (textNode) {
          textNode.nodeValue = ` ${baseLabel} (${count})`;
        }
      }
    });

    const tabBtns = document.querySelectorAll<HTMLElement>('.tab-btn');
    tabBtns.forEach(btn => {
      const tabType = btn.dataset.tab;
      if (tabType === 'other') {
        btn.textContent = t('tab_captured', capturedCount);
      } else if (tabType === 'overridden') {
        btn.textContent = t('tab_overridden', overriddenCount);
      } else if (tabType === 'overrides') {
        btn.textContent = t('tab_rules', state.overrides.length);
      }
    });

    apisToRender.sort((a, b) => {
      const idxA = TYPE_ORDER.indexOf(a.type);
      const idxB = TYPE_ORDER.indexOf(b.type);
      const orderA = idxA === -1 ? 999 : idxA;
      const orderB = idxB === -1 ? 999 : idxB;
      if (orderA !== orderB) return orderA - orderB;
      return a.url.localeCompare(b.url);
    });

    if (apisToRender.length === 0) {
      const emptyDiv = document.createElement('div');
      emptyDiv.className = 'empty-state';
      emptyDiv.textContent =
        state.activeTab === 'overridden'
          ? t('empty_overridden')
          : filterText
            ? t('empty_search')
            : t('empty_captured');
      elements.apisList.appendChild(emptyDiv);
      return;
    }

    const fragment = document.createDocumentFragment();

    apisToRender.forEach(api => {
      const item = document.createElement('li');
      item.className = 'api-item';

      const match = getMatchingRuleStatus(api, state.overrides);
      const isOverridden = match !== null && !match.isDisabledOnly;
      const isDisabledOverridden = match !== null && match.isDisabledOnly;

      if (isOverridden) {
        item.classList.add('overridden', 'active');
      } else if (isDisabledOverridden) {
        item.classList.add('overridden-disabled', 'api-item--rule-disabled');
      }

      const infoDiv = document.createElement('div');
      infoDiv.className = 'api-info';

      const methodBadge = document.createElement('span');
      const methodStr = (api.method || 'GET').toUpperCase();
      methodBadge.className = `method-badge method-${methodStr.toLowerCase()}`;
      methodBadge.textContent = methodStr;

      const typeBadge = document.createElement('span');
      typeBadge.className = `type-badge type-${api.type.toLowerCase()}`;
      typeBadge.textContent = TYPE_LABELS[api.type.toLowerCase()] || api.type.toUpperCase();

      const urlSpan = document.createElement('b');
      urlSpan.className = 'api-url';
      urlSpan.innerHTML = highlightApiLabel(api.url, state.apiFilter);
      urlSpan.title = api.url;

      infoDiv.appendChild(methodBadge);
      infoDiv.appendChild(typeBadge);
      infoDiv.appendChild(urlSpan);

      if (isOverridden) {
        const badge = document.createElement('span');
        badge.className = 'overridden-badge';
        badge.textContent = t('badge_overridden');
        badge.title = summarizeRule(match.rule);
        infoDiv.appendChild(badge);
      } else if (isDisabledOverridden) {
        const badge = document.createElement('span');
        badge.className = 'overridden-badge overridden-badge-disabled';
        badge.textContent = t('badge_disabled');
        badge.title = t('badge_disabled_title', summarizeRule(match.rule));
        infoDiv.appendChild(badge);
      }

      const actionsDiv = document.createElement('div');
      actionsDiv.className = 'api-actions';

      const copyCurlBtn = createUiButton('cURL', {
        className: 'curl-btn',
        variant: 'ghost',
        size: 'small',
        title: t('api_copy_curl_title'),
      });
      copyCurlBtn.addEventListener('click', e => {
        e.stopPropagation();
        const cmd = generateCurlCommand(api);
        navigator.clipboard.writeText(cmd).then(() => {
          copyCurlBtn.innerText = t('api_copied');
          setTimeout(() => (copyCurlBtn.innerText = 'cURL'), 1500);
        });
      });

      // The same as clicking the row, made visible: opens the editor filled
      // from this request, or the rule that already covers it.
      const mockBtn = createUiButton(t('api_mock_this'), {
        className: 'mock-btn',
        variant: 'ghost',
        size: 'small',
        title: match ? t('api_mock_edit_title') : t('api_mock_new_title'),
      });
      mockBtn.addEventListener('click', e => {
        e.stopPropagation();
        onApiClick(api);
      });

      actionsDiv.appendChild(mockBtn);
      actionsDiv.appendChild(copyCurlBtn);

      item.appendChild(infoDiv);
      item.appendChild(actionsDiv);

      item.addEventListener('click', () => onApiClick(api));
      fragment.appendChild(item);
    });

    elements.apisList.appendChild(fragment);
  }
}
