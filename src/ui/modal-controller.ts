/// <reference path="./types.ts" />
/// <reference path="./headers-editor.ts" />
/// <reference path="./modal.ts" />
/// <reference path="./notifications.ts" />

namespace NetworkOverridesUi {
  export interface ModalControllerOptions {
    elements: Elements;
    state: UiState;
    saveState: (rules: OverrideRule[]) => Promise<PersistenceResult>;
    renderRules: () => void;
  }

  function hasMalformedHeaderLine(value: string): boolean {
    return value.split('\n').some(line => {
      const trimmed = line.trim();
      return !!trimmed && trimmed.indexOf(':') <= 0;
    });
  }

  function showModalFeedback(
    elements: Elements,
    message: string,
    kind: 'error' | 'info',
    field?: HTMLElement
  ): void {
    elements.modalFeedback.textContent = message;
    elements.modalFeedback.className = `modal-feedback is-${kind}`;
    if (field) {
      field.setAttribute('aria-invalid', 'true');
      field.focus();
      field.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    }
  }

  function clearModalFeedback(elements: Elements): void {
    elements.modalFeedback.textContent = '';
    elements.modalFeedback.className = 'modal-feedback';
    elements.modal
      .querySelectorAll('[aria-invalid="true"]')
      .forEach(field => field.removeAttribute('aria-invalid'));
  }

  export function bindModalController(options: ModalControllerOptions): void {
    const { elements, state, saveState, renderRules } = options;

    elements.closeModal?.addEventListener('click', () => closeModal(elements));
    elements.modal?.addEventListener('click', event => {
      if (event.target === elements.modal) closeModal(elements);
    });
    elements.modal?.addEventListener('input', event => {
      (event.target as HTMLElement).removeAttribute?.('aria-invalid');
      if (elements.modalFeedback.classList.contains('is-error')) clearModalFeedback(elements);
    });
    elements.modalMode?.addEventListener('change', () => {
      updateImagePreview(elements, elements.modalBody.value);
    });
    elements.modalBody?.addEventListener('input', () => {
      updateBodyFormatAction(elements);
      updateImagePreview(elements, elements.modalBody.value);
    });
    elements.formatJsonBtn?.addEventListener('click', () => {
      try {
        const parsed = JSON.parse(elements.modalBody.value);
        elements.modalBody.value = JSON.stringify(parsed, null, 2);
        updateBodyFormatAction(elements);
        updateImagePreview(elements, elements.modalBody.value);
      } catch {
        showModalFeedback(
          elements,
          'Response body is not valid JSON.',
          'error',
          elements.modalBody
        );
      }
    });

    const typeRadios = elements.modal?.querySelectorAll('input[name="modal-override-type"]') || [];
    typeRadios.forEach(radio => {
      radio.addEventListener('change', event => {
        const value = (event.target as HTMLInputElement).value as 'body' | 'redirect' | 'fail';
        updateModalVisibility(elements, value);
      });
    });

    elements.saveOverrideBtn?.addEventListener('click', async () => {
      clearModalFeedback(elements);
      const pattern = elements.modalPattern.value.trim();
      if (!pattern) {
        showModalFeedback(elements, 'Pattern is required.', 'error', elements.modalPattern);
        return;
      }

      const method = elements.modalMethod.value;
      const selectedType = elements.modal.querySelector(
        'input[name="modal-override-type"]:checked'
      ) as HTMLInputElement;
      const overrideType = selectedType ? selectedType.value : 'body';

      let body = '';
      let mode: OverrideMode = 'text';
      let redirectUrl: string | undefined;
      if (overrideType === 'body') {
        body = elements.modalBody.value;
        mode = elements.modalMode.value as OverrideMode;
      } else if (overrideType === 'redirect') {
        redirectUrl = elements.modalRedirectUrl.value.trim();
        if (!redirectUrl) {
          showModalFeedback(
            elements,
            'Redirect URL is required for a redirect override.',
            'error',
            elements.modalRedirectUrl
          );
          return;
        }
      }

      let statusCode: number | undefined;
      if (elements.modalStatus.value.trim()) {
        statusCode = parseInt(elements.modalStatus.value.trim(), 10);
        if (isNaN(statusCode) || statusCode < 100 || statusCode > 599) {
          showModalFeedback(
            elements,
            'Status code must be between 100 and 599.',
            'error',
            elements.modalStatus
          );
          return;
        }
      }

      let delayMs: number | undefined;
      if (elements.modalDelay.value.trim()) {
        delayMs = parseInt(elements.modalDelay.value.trim(), 10);
        if (isNaN(delayMs) || delayMs < 0 || delayMs > 120000) {
          showModalFeedback(
            elements,
            'Delay must be between 0 and 120000 ms.',
            'error',
            elements.modalDelay
          );
          return;
        }
      }

      if (hasMalformedHeaderLine(elements.modalHeaders.value)) {
        showModalFeedback(
          elements,
          'Extra response headers must use one “Header-Name: value” per line.',
          'error',
          elements.modalHeaders
        );
        return;
      }
      if (
        elements.modalRequestHeaders &&
        hasMalformedHeaderLine(elements.modalRequestHeaders.value)
      ) {
        showModalFeedback(
          elements,
          'Request headers must use one “Header-Name: value” per line.',
          'error',
          elements.modalRequestHeaders
        );
        return;
      }

      const responseHeaders = parseHeadersText(elements.modalHeaders.value);
      const requestHeaders = elements.modalRequestHeaders
        ? parseHeadersText(elements.modalRequestHeaders.value)
        : undefined;
      const rule: OverrideRule = { pattern, body, mode };
      if (redirectUrl) rule.redirectUrl = redirectUrl;
      if (method && method !== 'ANY') rule.method = method;
      if (elements.modalGraphqlOp?.value.trim()) {
        rule.graphqlOperation = elements.modalGraphqlOp.value.trim();
      }
      if (overrideType === 'fail') {
        rule.failReason = FAIL_REASONS.includes(elements.modalFailReason.value)
          ? elements.modalFailReason.value
          : 'Failed';
      }
      if (statusCode !== undefined) rule.statusCode = statusCode;
      if (delayMs !== undefined) rule.delayMs = delayMs;
      if (responseHeaders.length > 0) rule.responseHeaders = responseHeaders;
      if (requestHeaders && requestHeaders.length > 0) rule.requestHeaders = requestHeaders;

      const previousOverrides = state.overrides;
      const nextOverrides = [...state.overrides];
      if (state.currentEditIndex !== null) nextOverrides[state.currentEditIndex] = rule;
      else nextOverrides.push(rule);

      const originalButtonText = elements.saveOverrideBtn.textContent || 'Save Override';
      elements.saveOverrideBtn.disabled = true;
      elements.saveOverrideBtn.textContent = 'Saving…';
      showModalFeedback(elements, 'Saving override…', 'info');
      try {
        const result = await saveState(nextOverrides);
        renderRules();
        closeModal(elements);
        showPersistenceNotification('Override saved', result);
      } catch (error) {
        state.overrides = previousOverrides;
        const reason = error instanceof Error ? error.message : String(error);
        showModalFeedback(
          elements,
          `Could not save override${reason ? `: ${reason}` : '.'}`,
          'error'
        );
      } finally {
        elements.saveOverrideBtn.disabled = false;
        elements.saveOverrideBtn.textContent = originalButtonText;
      }
    });
  }
}
