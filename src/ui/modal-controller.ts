/*! SPDX-License-Identifier: MIT | Copyright (c) 2025 Van Nguyen | github.com/vannt-dev/network-overrides-devtools */
/// <reference path="./types.ts" />
/// <reference path="./headers-editor.ts" />
/// <reference path="./modal.ts" />
/// <reference path="./notifications.ts" />
/// <reference path="./websocket-rule.ts" />

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
      revealField(field);
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
      syncAdvancedGroups(elements);
    });
    // Counts follow every change, including header rows added or removed
    // with the table editor's buttons.
    elements.modal?.addEventListener('change', () => syncAdvancedGroups(elements));
    elements.modal?.addEventListener('click', () => syncAdvancedGroups(elements));
    elements.modalPresets?.addEventListener('click', event => {
      const button = (event.target as HTMLElement).closest?.('[data-preset]') as HTMLElement | null;
      if (!button) return;
      applyPreset(elements, button.dataset.preset as PresetName);
    });
    elements.modal?.addEventListener('keydown', (event: KeyboardEvent) => {
      const isCtrlOrCmd = event.ctrlKey || event.metaKey;
      if (isCtrlOrCmd && event.key === 'Enter') {
        event.preventDefault();
        elements.saveOverrideBtn?.click();
      } else if (isCtrlOrCmd && event.shiftKey && (event.key === 'F' || event.key === 'f')) {
        event.preventDefault();
        elements.formatJsonBtn?.click();
      }
    });
    elements.modalMode?.addEventListener('change', () => {
      updateScriptHelp(elements);
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
        showModalFeedback(elements, t('error_body_not_json'), 'error', elements.modalBody);
      }
    });

    const typeRadios = elements.modal?.querySelectorAll('input[name="modal-override-type"]') || [];
    typeRadios.forEach(radio => {
      radio.addEventListener('change', event => {
        const value = (event.target as HTMLInputElement).value as ModalType;
        // The status is hidden for other types: a prefilled one must not be saved with them.
        if (value !== 'body') elements.modalStatus.value = '';
        updateModalVisibility(elements, value);
        // The error to simulate lives under Timing & failure: show it.
        if (value === 'fail') revealField(elements.modalFailReason);
        syncAdvancedGroups(elements);
      });
    });
    elements.modalWsAction?.addEventListener('change', () => {
      updateModalVisibility(elements, 'websocket');
      if (elements.modalWsAction.value === 'delay') revealField(elements.modalDelay);
      syncAdvancedGroups(elements);
    });

    elements.saveOverrideBtn?.addEventListener('click', async () => {
      clearModalFeedback(elements);
      const commit = async (rule: OverrideRule) => {
        const previousOverrides = state.overrides;
        const nextOverrides = [...state.overrides];
        if (state.currentEditIndex !== null) nextOverrides[state.currentEditIndex] = rule;
        else nextOverrides.push(rule);

        const originalButtonText = elements.saveOverrideBtn.textContent || t('modal_save');
        elements.saveOverrideBtn.disabled = true;
        elements.saveOverrideBtn.textContent = t('modal_saving_button');
        showModalFeedback(elements, t('modal_saving'), 'info');
        try {
          const result = await saveState(nextOverrides);
          renderRules();
          closeModal(elements);
          showPersistenceNotification(t('toast_override_saved'), result);
        } catch (error) {
          state.overrides = previousOverrides;
          const reason = error instanceof Error ? error.message : String(error);
          showModalFeedback(
            elements,
            reason ? t('error_save_override_reason', reason) : t('error_save_override'),
            'error'
          );
        } finally {
          elements.saveOverrideBtn.disabled = false;
          elements.saveOverrideBtn.textContent = originalButtonText;
        }
      };

      const pattern = elements.modalPattern.value.trim();
      if (!pattern) {
        showModalFeedback(elements, t('error_pattern_required'), 'error', elements.modalPattern);
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
      let patch: NetworkOverridesShared.PatchOperation[] | undefined;
      if (overrideType === 'body') {
        body = elements.modalBody.value;
        mode = elements.modalMode.value as OverrideMode;
        if (mode === 'patch') {
          const parsed = NetworkOverridesUtils.parsePatchText(body);
          if (!parsed.operations) {
            showModalFeedback(elements, parsed.error, 'error', elements.modalBody);
            return;
          }
          patch = parsed.operations;
          body = '';
        }
      } else if (overrideType === 'redirect') {
        redirectUrl = elements.modalRedirectUrl.value.trim();
        if (!redirectUrl) {
          showModalFeedback(
            elements,
            t('error_redirect_required'),
            'error',
            elements.modalRedirectUrl
          );
          return;
        }
      }

      let statusCode: number | undefined;
      // Hidden for WebSocket rules, so a value left from another type must not block saving.
      if (overrideType !== 'websocket' && elements.modalStatus.value.trim()) {
        statusCode = parseInt(elements.modalStatus.value.trim(), 10);
        if (isNaN(statusCode) || statusCode < 100 || statusCode > 599) {
          showModalFeedback(elements, t('error_status_range'), 'error', elements.modalStatus);
          return;
        }
      }

      let delayMs: number | undefined;
      if (elements.modalDelay.value.trim()) {
        delayMs = parseInt(elements.modalDelay.value.trim(), 10);
        if (isNaN(delayMs) || delayMs < 0 || delayMs > 120000) {
          showModalFeedback(elements, t('error_delay_range'), 'error', elements.modalDelay);
          return;
        }
      }

      if (overrideType === 'websocket') {
        const result = readWebSocketRule(elements, pattern, delayMs);
        if ('error' in result) {
          showModalFeedback(elements, result.error, 'error', result.field);
          return;
        }
        await commit(result.rule);
        return;
      }

      if (hasMalformedHeaderLine(elements.modalHeaders.value)) {
        showModalFeedback(elements, t('error_response_headers'), 'error', elements.modalHeaders);
        return;
      }
      if (
        elements.modalRequestHeaders &&
        hasMalformedHeaderLine(elements.modalRequestHeaders.value)
      ) {
        showModalFeedback(
          elements,
          t('error_request_headers'),
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
      if (patch) rule.patch = patch;
      if (redirectUrl) rule.redirectUrl = redirectUrl;
      if (method && method !== 'ANY') rule.method = method;
      if (elements.modalGraphqlOp?.value.trim()) {
        rule.graphqlOperation = elements.modalGraphqlOp.value.trim();
      }
      const matchQuery = NetworkOverridesUtils.parseQueryConditions(
        elements.modalMatchQuery?.value || ''
      );
      if (matchQuery.length > 0) rule.matchQuery = matchQuery;
      const matchHeaders = NetworkOverridesUtils.parseHeaderConditions(
        elements.modalMatchHeaders?.value || ''
      );
      if (matchHeaders.length > 0) rule.matchHeaders = matchHeaders;
      if (elements.modalMatchBody?.value) rule.matchBody = elements.modalMatchBody.value;
      if (elements.modalRequestBody?.value.trim()) {
        rule.requestBody = elements.modalRequestBody.value;
      }
      if (overrideType === 'body' && !patch && elements.modalProcessTemplates?.checked === false) {
        rule.processTemplates = false;
      }
      // A patch needs the real response, so it never answers without the server.
      if (overrideType === 'body' && !patch && elements.modalRespondAtRequest?.checked) {
        rule.respondAtRequest = true;
      }
      if (elements.modalGlobalRule?.checked) {
        rule.isGlobal = true;
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

      await commit(rule);
    });
  }
}
