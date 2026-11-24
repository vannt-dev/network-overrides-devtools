/*! SPDX-License-Identifier: MIT | Copyright (c) 2025 Van Nguyen | github.com/vannt-dev/network-overrides-devtools */
/// <reference path="./types.ts" />
/// <reference path="./headers-editor.ts" />
/// <reference path="./response-variants.ts" />

namespace NetworkOverridesUi {
  export const FAIL_REASONS = [
    'Failed',
    'Aborted',
    'TimedOut',
    'AccessDenied',
    'ConnectionRefused',
    'ConnectionReset',
    'ConnectionClosed',
    'ConnectionFailed',
    'NameNotResolved',
    'InternetDisconnected',
    'AddressUnreachable',
    'BlockedByClient',
    'BlockedByResponse',
  ];

  export function escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /** The wrapper of a field, with its label and hint: what is shown or hidden. */
  export function fieldOf(el: Element | null | undefined): HTMLElement | null {
    if (!el) return null;
    return (el.closest('.modal-field') || el.closest('label')) as HTMLElement | null;
  }

  function selectedModalType(elements: Elements): ModalType {
    const checked = elements.modal?.querySelector(
      'input[name="modal-override-type"]:checked'
    ) as HTMLInputElement | null;
    return ((checked?.value || 'body') as ModalType) || 'body';
  }

  export function updateModalVisibility(elements: Elements, type: ModalType): void {
    const isWs = type === 'websocket';
    const isInject = type === 'inject';
    // Neither a WebSocket rule nor an inject rule answers an HTTP request.
    const notHttp = isWs || isInject;
    const wsAction = elements.modalWsAction?.value || 'replace';
    const wsUsesBody = wsAction === 'replace' || wsAction === 'substitute';
    const show = (el: HTMLElement | null | undefined, visible: boolean) => {
      if (el) el.style.display = visible ? '' : 'none';
    };

    show(elements.modalBodyFields, type === 'body' || (isWs && wsUsesBody));
    show(elements.modalRedirectFields, type === 'redirect');
    show(elements.modalFailFields, type === 'fail');
    show(elements.modalWsFields, isWs);
    show(elements.modalInjectFields, isInject);
    show(elements.modalPresets, !notHttp);
    show(elements.modalStatusField, type === 'body');
    show(fieldOf(elements.modalRespondAtRequest), type === 'body');
    show(elements.modalHeadersField, type === 'body');
    show(elements.modalRemoveHeadersField, type === 'body');
    show(elements.modalRequestHeadersField, type !== 'fail' && type !== 'redirect' && !notHttp);
    show(elements.modalRequestBodyField, type !== 'fail' && type !== 'redirect' && !notHttp);
    show(
      fieldOf(elements.modalDelay),
      isWs ? wsAction === 'delay' : type !== 'redirect' && !isInject
    );
    show(fieldOf(elements.modalMethod), !notHttp);
    show(fieldOf(elements.modalGraphqlOp), !notHttp);
    elements.modalMatchFields
      ?.querySelectorAll<HTMLElement>('.modal-field-help, .modal-field')
      .forEach(field => {
        if (!field.contains(elements.modalGlobalRule || null)) show(field, !notHttp);
      });
    show(fieldOf(elements.modalMode), type === 'body');
    updateScriptHelp(elements);
    updateFileVisibility(elements);
  }

  // A script body is code and a patch body is a list of changes, not a
  // response: each gets its own explanation, and the template option, which
  // only rewrites literal bodies, is put away. A patch needs the real
  // response, so it cannot answer without calling the server.
  export function updateScriptHelp(elements: Elements): void {
    const checked = elements.modal?.querySelector(
      'input[name="modal-override-type"]:checked'
    ) as HTMLInputElement | null;
    const isBody = (checked?.value || 'body') === 'body';
    const isScript = isBody && elements.modalMode?.value === 'script';
    const isPatch = isBody && elements.modalMode?.value === 'patch';
    // A pass-through rule keeps the real body: there is no body to type.
    const isPassthrough = isBody && elements.modalMode?.value === 'passthrough';
    const bodyField = fieldOf(elements.modalBody);
    if (bodyField) bodyField.style.display = isPassthrough ? 'none' : '';
    if (elements.modalPassthroughHelp) {
      elements.modalPassthroughHelp.style.display = isPassthrough ? '' : 'none';
    }
    if (elements.modalPreviewContainer && isPassthrough) {
      elements.modalPreviewContainer.style.display = 'none';
    }
    // Other responses go with a typed or loaded body only.
    const responses = document.getElementById('modal-responses-fields');
    const mode = elements.modalMode?.value || 'text';
    if (responses) {
      responses.style.display = isBody && (mode === 'text' || mode === 'file') ? '' : 'none';
    }
    const help = elements.modal?.querySelector('#modal-script-help') as HTMLElement | null;
    if (help) help.style.display = isScript ? '' : 'none';
    const patchHelp = elements.modal?.querySelector('#modal-patch-help') as HTMLElement | null;
    if (patchHelp) patchHelp.style.display = isPatch ? '' : 'none';
    const templates = fieldOf(elements.modalProcessTemplates);
    // The option goes with the body: hidden for redirect and network-error rules.
    const bodyShown = elements.modalBodyFields?.style.display !== 'none';
    if (templates) {
      templates.style.display = isScript || isPatch || isPassthrough || !bodyShown ? 'none' : '';
    }
    const respondAtRequest = fieldOf(elements.modalRespondAtRequest);
    if (respondAtRequest) {
      respondAtRequest.style.display = isBody && !isPatch && !isPassthrough ? '' : 'none';
    }
    if (elements.modalBody) {
      elements.modalBody.placeholder = isScript
        ? 'return { status: 200, body: { ok: true } };'
        : isPatch
          ? 'set data.user.plan = "pro"\nremove data.ads'
          : t('modal_body_placeholder');
    }
  }

  export function updateImagePreview(elements: Elements, body: string): void {
    if (!elements.modalPreviewContainer) return;
    const trimmed = body.trim();
    if (!trimmed) {
      elements.modalPreviewContainer.style.display = 'none';
      elements.modalPreviewContainer.innerHTML = '';
      return;
    }
    if (
      trimmed.startsWith('data:image/') ||
      (trimmed.startsWith('<svg') && trimmed.endsWith('</svg>'))
    ) {
      elements.modalPreviewContainer.style.display = 'block';
      elements.modalPreviewContainer.innerHTML = `<img src="${escapeHtml(trimmed)}" alt="${escapeHtml(t('preview_alt'))}" />`;
    } else if (elements.modalMode && elements.modalMode.value === 'file') {
      elements.modalPreviewContainer.style.display = 'block';
      elements.modalPreviewContainer.innerHTML = `<img src="data:image/png;base64,${escapeHtml(trimmed)}" alt="${escapeHtml(t('preview_alt'))}" onerror="this.parentElement.style.display='none'" />`;
    } else {
      elements.modalPreviewContainer.style.display = 'none';
      elements.modalPreviewContainer.innerHTML = '';
    }
  }

  export function updateBodyFormatAction(elements: Elements): void {
    const val = elements.modalBody.value.trim();
    if (!val) {
      elements.formatJsonBtn.style.display = 'none';
      return;
    }
    try {
      JSON.parse(val);
      elements.formatJsonBtn.style.display = 'inline-flex';
    } catch {
      elements.formatJsonBtn.style.display = 'none';
    }
  }

  export function prefillAdvancedFields(elements: Elements, existing: OverrideRule | null): void {
    if (elements.modalGraphqlOp) {
      elements.modalGraphqlOp.value = existing?.graphqlOperation || '';
    }
    if (elements.modalMatchQuery) {
      elements.modalMatchQuery.value = NetworkOverridesUtils.formatQueryConditions(
        existing?.matchQuery
      );
    }
    if (elements.modalMatchHeaders) {
      elements.modalMatchHeaders.value = NetworkOverridesUtils.formatHeaderConditions(
        existing?.matchHeaders
      );
    }
    if (elements.modalMatchBody) {
      elements.modalMatchBody.value = existing?.matchBody || '';
    }
    elements.modalStatus.value =
      existing && typeof existing.statusCode === 'number' ? String(existing.statusCode) : '';
    elements.modalDelay.value =
      existing && typeof existing.delayMs === 'number' ? String(existing.delayMs) : '';
    elements.modalHeaders.value = (existing?.responseHeaders || [])
      .map(header => `${header.name}: ${header.value}`)
      .join('\n');
    if (elements.modalRequestHeaders) {
      elements.modalRequestHeaders.value = (existing?.requestHeaders || [])
        .map(header => `${header.name}: ${header.value}`)
        .join('\n');
    }
    if (elements.modalRequestBody) {
      elements.modalRequestBody.value = existing?.requestBody || '';
    }
    if (elements.modalProcessTemplates) {
      elements.modalProcessTemplates.checked = existing?.processTemplates !== false;
    }
    if (elements.modalGlobalRule) {
      elements.modalGlobalRule.checked = existing?.isGlobal === true;
    }
    if (elements.modalRespondAtRequest) {
      elements.modalRespondAtRequest.checked = existing?.respondAtRequest === true;
    }
    if (elements.modalRemoveHeaders) {
      elements.modalRemoveHeaders.value = (existing?.removeResponseHeaders || []).join('\n');
    }
    prefillResponseVariants(elements, existing);
    elements.modalFailReason.value =
      existing?.failReason && FAIL_REASONS.includes(existing.failReason)
        ? existing.failReason
        : 'Failed';

    // Render visual header tables if present
    if (elements.modalResponseHeadersTable) {
      renderHeaderTable(elements.modalResponseHeadersTable, elements.modalHeaders);
    }
    if (elements.modalRequestHeadersTable && elements.modalRequestHeaders) {
      renderHeaderTable(elements.modalRequestHeadersTable, elements.modalRequestHeaders);
    }
  }

  export function openModal(elements: Elements): void {
    elements.modalFeedback.textContent = '';
    elements.modalFeedback.className = 'modal-feedback';
    elements.modal
      .querySelectorAll('[aria-invalid="true"]')
      .forEach(field => field.removeAttribute('aria-invalid'));
    elements.modal.style.display = 'block';
    // Every group that holds a value opens, so no setting is hidden.
    syncAdvancedGroups(elements, true);
  }

  export function closeModal(elements: Elements): void {
    elements.modal.style.display = 'none';
  }

  function isShown(el: HTMLElement | null | undefined): boolean {
    return !!el && el.style.display !== 'none';
  }

  function countHeaderLines(text: string | undefined): number {
    return text ? parseHeadersText(text).length : 0;
  }

  /**
   * How many settings each Advanced group holds, counting only what saving
   * the rule would keep for the chosen type.
   */
  export function countAdvancedValues(elements: Elements): Record<string, number> {
    const type = selectedModalType(elements);
    const isWs = type === 'websocket' || type === 'inject';
    const mode = elements.modalMode?.value || 'text';
    const filled = (el: HTMLInputElement | HTMLTextAreaElement | null | undefined) =>
      el && el.value.trim() ? 1 : 0;

    const conditions =
      (isWs
        ? 0
        : filled(elements.modalGraphqlOp) +
          filled(elements.modalMatchQuery) +
          filled(elements.modalMatchHeaders) +
          (elements.modalMatchBody?.value ? 1 : 0)) + (elements.modalGlobalRule?.checked ? 1 : 0);
    const realResponse = mode === 'patch' || mode === 'passthrough';
    const timing =
      (isShown(fieldOf(elements.modalDelay)) ? filled(elements.modalDelay) : 0) +
      (type === 'fail' ? 1 : 0) +
      (type === 'body' && !realResponse && elements.modalRespondAtRequest?.checked ? 1 : 0);
    const removed = NetworkOverridesUtils.parseHeaderNames(
      elements.modalRemoveHeaders?.value || ''
    );
    const responseHeaders =
      type === 'body'
        ? countHeaderLines(elements.modalHeaders?.value) +
          ('names' in removed ? removed.names.length : 1)
        : 0;
    const responses =
      type === 'body' && (mode === 'text' || mode === 'file') ? countResponseVariants(elements) : 0;
    const templatesOff =
      isShown(elements.modalBodyFields) &&
      isShown(fieldOf(elements.modalProcessTemplates)) &&
      elements.modalProcessTemplates?.checked === false;
    const bodyType = (type === 'body' && mode !== 'text' ? 1 : 0) + (templatesOff ? 1 : 0);
    const request =
      type === 'body'
        ? filled(elements.modalRequestBody) + countHeaderLines(elements.modalRequestHeaders?.value)
        : 0;
    return {
      'modal-match-fields': conditions,
      'modal-group-timing': timing,
      'modal-group-response-headers': responseHeaders,
      'modal-group-body-type': bodyType,
      'modal-group-request': request,
      'modal-group-responses': responses,
    };
  }

  function setCount(summaryOwner: Element, count: number): void {
    const badge = summaryOwner.querySelector(
      ':scope > summary .modal-group-count'
    ) as HTMLElement | null;
    if (!badge) return;
    badge.hidden = count === 0;
    badge.textContent = count === 0 ? '' : String(count);
    badge.title = count === 1 ? t('settings_in_use_one') : t('settings_in_use_other', count);
  }

  /**
   * Refreshes the count on every Advanced group, hides groups with nothing
   * that applies to the chosen type and, with `openFilled`, opens exactly
   * the groups that hold a value (used when the editor opens).
   */
  export function syncAdvancedGroups(elements: Elements, openFilled = false): void {
    const advanced = elements.modalAdvancedFields;
    if (!advanced || advanced.tagName !== 'DETAILS') return;
    const counts = countAdvancedValues(elements);
    let total = 0;
    advanced.querySelectorAll<HTMLDetailsElement>('details.modal-group').forEach(group => {
      const count = counts[group.id] || 0;
      total += count;
      setCount(group, count);
      const fields = Array.from(group.children).filter(
        child => child.tagName !== 'SUMMARY'
      ) as HTMLElement[];
      group.style.display = fields.some(field => isShown(field)) ? '' : 'none';
      if (openFilled) group.open = count > 0;
    });
    setCount(advanced, total);
    advanced.style.display = Array.from(
      advanced.querySelectorAll<HTMLElement>('details.modal-group')
    ).some(group => isShown(group))
      ? ''
      : 'none';
    if (openFilled) advanced.open = total > 0;
  }

  /** Opens every collapsed section around a field, so it can be seen and focused. */
  export function revealField(field: Element | null | undefined): void {
    let node = field?.parentElement || null;
    while (node) {
      if (node.tagName === 'DETAILS') (node as HTMLDetailsElement).open = true;
      node = node.parentElement;
    }
  }

  /**
   * The body of the "Empty list" preset: `[]`, or the same JSON object with
   * each of its top-level lists emptied (`{}` when it has none).
   */
  export function emptyListBody(current: string): string {
    let parsed: unknown;
    try {
      parsed = JSON.parse(current);
    } catch {
      return '[]';
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return '[]';
    const record = parsed as Record<string, unknown>;
    const keys = Object.keys(record).filter(key => Array.isArray(record[key]));
    if (keys.length === 0) return '{}';
    keys.forEach(key => {
      record[key] = [];
    });
    return JSON.stringify(record, null, 2);
  }

  export type PresetName =
    'empty-list' | 'server-error' | 'slow' | 'offline' | 'no-csp' | 'no-cache';

  /** The headers the "No CSP" and "No cache" presets remove from the real response. */
  export const CSP_HEADER_NAMES = [
    'content-security-policy',
    'content-security-policy-report-only',
  ];
  export const CACHE_HEADER_NAMES = [
    'cache-control',
    'expires',
    'etag',
    'last-modified',
    'pragma',
    'age',
  ];

  function presetLabel(preset: PresetName): string {
    if (preset === 'empty-list') return t('preset_empty_list');
    if (preset === 'server-error') return t('preset_server_error');
    if (preset === 'slow') return t('preset_slow');
    if (preset === 'no-csp') return t('preset_no_csp');
    if (preset === 'no-cache') return t('preset_no_cache');
    return t('preset_offline');
  }

  /** Keeps the real response and adds `names` to the headers it removes. */
  function keepRealResponseWithout(elements: Elements, names: string[]): void {
    chooseModalType(elements, 'body');
    elements.modalMode.value = 'passthrough';
    if (elements.modalRemoveHeaders) {
      const current = NetworkOverridesUtils.parseHeaderNames(elements.modalRemoveHeaders.value);
      const listed = 'names' in current ? current.names : [];
      elements.modalRemoveHeaders.value = [
        ...listed,
        ...names.filter(name => !listed.includes(name)),
      ].join('\n');
      revealField(elements.modalRemoveHeaders);
    }
  }

  function chooseModalType(elements: Elements, type: ModalType): void {
    const radio = elements.modal.querySelector(
      `input[name="modal-override-type"][value="${type}"]`
    ) as HTMLInputElement | null;
    if (radio) radio.checked = true;
    if (type !== 'body') elements.modalStatus.value = '';
    updateModalVisibility(elements, type);
  }

  function useTextBody(elements: Elements, body: string, status: string): void {
    chooseModalType(elements, 'body');
    elements.modalMode.value = 'text';
    elements.modalBody.value = body;
    elements.modalStatus.value = status;
  }

  /** Fills the editor's existing fields for one of the one-click presets. */
  export function applyPreset(elements: Elements, preset: PresetName): void {
    if (preset === 'empty-list') {
      useTextBody(elements, emptyListBody(elements.modalBody.value), '200');
    } else if (preset === 'server-error') {
      useTextBody(elements, '{"error":"Internal Server Error"}', '500');
    } else if (preset === 'slow') {
      if (selectedModalType(elements) === 'redirect') chooseModalType(elements, 'body');
      elements.modalDelay.value = '3000';
      revealField(elements.modalDelay);
    } else if (preset === 'offline') {
      chooseModalType(elements, 'fail');
      elements.modalFailReason.value = 'InternetDisconnected';
      revealField(elements.modalFailReason);
    } else if (preset === 'no-csp') {
      keepRealResponseWithout(elements, CSP_HEADER_NAMES);
    } else if (preset === 'no-cache') {
      keepRealResponseWithout(elements, CACHE_HEADER_NAMES);
    }
    updateScriptHelp(elements);
    updateBodyFormatAction(elements);
    updateImagePreview(elements, elements.modalBody.value);
    syncAdvancedGroups(elements);
    elements.modalFeedback.textContent = t('preset_applied', presetLabel(preset));
    elements.modalFeedback.className = 'modal-feedback is-info';
  }
}
