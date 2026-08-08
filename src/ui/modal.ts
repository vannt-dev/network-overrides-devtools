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

  export function updateModalVisibility(
    elements: Elements,
    type: 'body' | 'redirect' | 'fail'
  ): void {
    elements.modalBodyFields.style.display = type === 'body' ? '' : 'none';
    elements.modalRedirectFields.style.display = type === 'redirect' ? '' : 'none';
    elements.modalFailFields.style.display = type === 'fail' ? '' : 'none';
    elements.modalAdvancedFields.style.display = type === 'redirect' ? 'none' : '';
    elements.modalStatusField.style.display = type === 'body' ? '' : 'none';
    elements.modalHeadersField.style.display = type === 'body' ? '' : 'none';
    if (elements.modalRequestHeadersField) {
      elements.modalRequestHeadersField.style.display = type === 'fail' ? 'none' : '';
    }
    elements.modalPattern.disabled = type === 'body';
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
