/*! SPDX-License-Identifier: MIT | Copyright (c) 2025 Van Nguyen | github.com/vannt-dev/network-overrides-devtools */
/// <reference path="./types.ts" />
/// <reference path="./modal.ts" />
/// <reference path="./notifications.ts" />
/// <reference path="./websocket-rule.ts" />

namespace NetworkOverridesUi {
  export interface ToolbarControllerOptions {
    elements: Elements;
    state: UiState;
    getStorageKey: (suffix: string) => string;
    saveState: (rules: OverrideRule[]) => Promise<PersistenceResult>;
    renderRules: () => void;
    renderApis: () => void;
    loadApis: () => Promise<void>;
    notifyBackground: () => Promise<void>;
    setThrottle: (preset: ThrottlePreset) => Promise<void>;
  }

  /**
   * The capture-type boxes start as the page has them (XHR and Fetch); the background works with the saved
   * choice, so the boxes show that one once it is read.
   */
  async function restoreCaptureTypes(renderApis: () => void): Promise<void> {
    try {
      const data: any = await Promise.resolve(chrome.storage.local.get(['capturedBodyTypes']));
      const saved = data?.capturedBodyTypes;
      if (!Array.isArray(saved)) return;
      const types = saved.map((type: unknown) => String(type).toLowerCase());
      document.querySelectorAll<HTMLInputElement>('.capture-type-cb').forEach(input => {
        input.checked = types.includes(input.value.toLowerCase());
      });
      renderApis();
    } catch {}
  }

  export function bindToolbarController(options: ToolbarControllerOptions): void {
    const {
      elements,
      state,
      getStorageKey,
      saveState,
      renderRules,
      renderApis,
      loadApis,
      notifyBackground,
      setThrottle,
    } = options;

    const tabButtons = elements.tabsContainer?.querySelectorAll('.tab-btn') || [];
    tabButtons.forEach(button => {
      button.classList.toggle('active', (button as HTMLElement).dataset.tab === 'other');
      button.addEventListener('click', () => {
        tabButtons.forEach(item => item.classList.remove('active'));
        button.classList.add('active');
        state.activeTab = (button as HTMLElement).dataset.tab || 'other';
        const rulesTab = state.activeTab === 'overrides';
        elements.apisSection.style.display = rulesTab ? 'none' : 'block';
        elements.overridesSection.style.display = rulesTab ? 'block' : 'none';
        if (!rulesTab) renderApis();
      });
    });

    elements.apiSearchInput?.addEventListener('input', () => {
      state.apiFilter = elements.apiSearchInput.value;
      renderApis();
    });
    document.querySelectorAll<HTMLInputElement>('.capture-type-cb').forEach(input => {
      input.addEventListener('change', () => {
        const types = Array.from(
          document.querySelectorAll<HTMLInputElement>('.capture-type-cb:checked')
        ).map(item => item.value);
        chrome.runtime.sendMessage({ type: 'updateCapturedBodyTypes', types });
        renderApis();
      });
    });
    void restoreCaptureTypes(renderApis);
    elements.throttleSelect?.addEventListener('change', async () => {
      const previousPreset = state.throttlePreset;
      const preset = elements.throttleSelect.value as ThrottlePreset;
      elements.throttleSelect.disabled = true;
      try {
        await setThrottle(preset);
        showNotification(
          t('toast_throttle_changed', elements.throttleSelect.selectedOptions[0]?.text || preset),
          'success'
        );
      } catch (error) {
        state.throttlePreset = previousPreset;
        elements.throttleSelect.value = previousPreset;
        showNotification(t('toast_throttle_failed', errorMessage(error)), 'error');
      } finally {
        elements.throttleSelect.disabled = false;
      }
    });

    async function refreshApis(button: HTMLButtonElement): Promise<void> {
      if (button.disabled) return;
      const originalTitle = button.title;
      button.disabled = true;
      button.classList.add('loading');
      button.setAttribute('aria-busy', 'true');
      button.title = t('refreshing_title');
      try {
        await loadApis();
      } finally {
        button.disabled = false;
        button.classList.remove('loading');
        button.removeAttribute('aria-busy');
        button.title = originalTitle;
      }
    }

    elements.refreshBtn?.addEventListener('click', () => {
      void refreshApis(elements.refreshBtn);
    });
    const capturedRefreshButton = document.getElementById(
      'refresh-captured-apis'
    ) as HTMLButtonElement | null;
    capturedRefreshButton?.addEventListener('click', () => {
      void refreshApis(capturedRefreshButton);
    });
    elements.infoBtn?.addEventListener('click', () => {
      chrome.tabs.create?.({ url: chrome.runtime.getURL?.('guide.html') || 'guide.html' });
    });
    elements.addApiBtn?.addEventListener('click', () => {
      state.currentEditIndex = null;
      elements.modalTitleText.textContent = t('modal_title_add');
      elements.modalUrl.textContent = '';
      elements.modalPattern.value = '';
      elements.modalMethod.value = 'ANY';
      elements.modalBody.value = '';
      elements.modalMode.value = 'text';
      elements.modalRedirectUrl.value = '';
      const bodyRadio = elements.modal.querySelector(
        'input[name="modal-override-type"][value="body"]'
      ) as HTMLInputElement;
      if (bodyRadio) bodyRadio.checked = true;
      prefillAdvancedFields(elements, null);
      prefillWebSocketFields(elements, null);
      updateModalVisibility(elements, 'body');
      elements.modalPattern.disabled = false;
      openModal(elements);
    });
    elements.addBtn?.addEventListener('click', async () => {
      const pattern = elements.patternInput.value.trim();
      if (!pattern) {
        showNotification(t('toast_pattern_required'), 'error');
        elements.patternInput.focus();
        return;
      }
      const rule: OverrideRule = {
        pattern,
        body: elements.bodyInput.value,
        mode: elements.modeSelect.value as OverrideMode,
      };
      const redirectUrl = elements.redirectUrlInput.value.trim();
      if (redirectUrl) rule.redirectUrl = redirectUrl;
      try {
        const result = await saveState([...state.overrides, rule]);
        renderRules();
        showPersistenceNotification(t('toast_rule_added'), result);
      } catch (error) {
        showNotification(t('toast_add_rule_failed', errorMessage(error)), 'error');
      }
    });
    elements.enableCheckbox?.addEventListener('change', async () => {
      const previousEnabled = state.enabled;
      const nextEnabled = elements.enableCheckbox.checked;
      try {
        await Promise.resolve(
          chrome.storage.local.set({ [getStorageKey('enabled')]: nextEnabled })
        );
        state.enabled = nextEnabled;
      } catch (error) {
        state.enabled = previousEnabled;
        elements.enableCheckbox.checked = previousEnabled;
        showNotification(t('toast_enable_save_failed', errorMessage(error)), 'error');
        return;
      }

      try {
        await notifyBackground();
        showNotification(
          nextEnabled ? t('toast_interception_on') : t('toast_interception_off'),
          'success'
        );
      } catch (error) {
        showNotification(
          nextEnabled
            ? t('toast_enabled_sync_failed', errorMessage(error))
            : t('toast_disabled_sync_failed', errorMessage(error)),
          'warning',
          7000
        );
      }
    });
  }
}
