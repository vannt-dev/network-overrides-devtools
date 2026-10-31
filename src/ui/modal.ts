/*! SPDX-License-Identifier: MIT | Copyright (c) 2025 Van Nguyen | github.com/vannt-dev/network-overrides-devtools */
/// <reference path="./types.ts" />
/// <reference path="./headers-editor.ts" />

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

  export function updateModalVisibility(elements: Elements, type: ModalType): void {
    const isWs = type === 'websocket';
    const wsAction = elements.modalWsAction?.value || 'replace';
    const wsUsesBody = wsAction === 'replace' || wsAction === 'substitute';
    const show = (el: HTMLElement | null | undefined, visible: boolean) => {
      if (el) el.style.display = visible ? '' : 'none';
    };

    show(elements.modalBodyFields, type === 'body' || (isWs && wsUsesBody));
    show(elements.modalRedirectFields, type === 'redirect');
    show(elements.modalFailFields, type === 'fail');
    show(elements.modalWsFields, isWs);
    show(elements.modalAdvancedFields, type !== 'redirect');
    show(elements.modalStatusField, type === 'body');
    show(elements.modalRespondAtRequest?.closest('label'), type === 'body');
    show(elements.modalHeadersField, type === 'body');
    show(elements.modalRequestHeadersField, type !== 'fail' && !isWs);
    show(elements.modalRequestBodyField, type !== 'fail' && !isWs);
    show(elements.modalDelay.closest('label'), !isWs || wsAction === 'delay');
    show(elements.modalMethod.closest('label'), !isWs);
    show(elements.modalGraphqlOp?.closest('label'), !isWs);
    show(elements.modalMatchFields, !isWs);
    show(elements.modalMode, !isWs);
    elements.modalPattern.disabled = type === 'body';
    updateScriptHelp(elements);
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
    const help = elements.modal?.querySelector('#modal-script-help') as HTMLElement | null;
    if (help) help.style.display = isScript ? '' : 'none';
    const patchHelp = elements.modal?.querySelector('#modal-patch-help') as HTMLElement | null;
    if (patchHelp) patchHelp.style.display = isPatch ? '' : 'none';
    const templates = elements.modalProcessTemplates?.closest('label') as HTMLElement | null;
    if (templates) templates.style.display = isScript || isPatch ? 'none' : '';
    const respondAtRequest = elements.modalRespondAtRequest?.closest('label') as HTMLElement | null;
    if (respondAtRequest) respondAtRequest.style.display = isBody && !isPatch ? '' : 'none';
    if (elements.modalBody) {
      elements.modalBody.placeholder = isScript
        ? 'return { status: 200, body: { ok: true } };'
        : isPatch
          ? 'set data.user.plan = "pro"\nremove data.ads'
          : 'Custom response body';
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
      elements.modalPreviewContainer.innerHTML = `<img src="${escapeHtml(trimmed)}" alt="Preview" />`;
    } else if (elements.modalMode && elements.modalMode.value === 'file') {
      elements.modalPreviewContainer.style.display = 'block';
      elements.modalPreviewContainer.innerHTML = `<img src="data:image/png;base64,${escapeHtml(trimmed)}" alt="Image Preview" onerror="this.parentElement.style.display='none'" />`;
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
    // Open the section when the rule has conditions, so they are not missed.
    if (elements.modalMatchFields) {
      elements.modalMatchFields.open = Boolean(
        existing?.matchQuery?.length || existing?.matchHeaders?.length || existing?.matchBody
      );
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
  }

  export function closeModal(elements: Elements): void {
    elements.modal.style.display = 'none';
  }
}
