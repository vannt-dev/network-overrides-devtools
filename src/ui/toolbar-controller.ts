/// <reference path="./types.ts" />
/// <reference path="./modal.ts" />
/// <reference path="./notifications.ts" />

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

    async function refreshApis(button: HTMLButtonElement): Promise<void> {
      if (button.disabled) return;
      const originalTitle = button.title;
      button.disabled = true;
      button.classList.add('loading');
      button.setAttribute('aria-busy', 'true');
      button.title = 'Refreshing captured requests…';
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
      elements.modalTitleText.textContent = 'Add override';
      elements.modalUrl.textContent = '';
      elements.modalPattern.value = '';
      elements.modalMethod.value = 'ANY';
      elements.modalBody.value = '';
      elements.modalRedirectUrl.value = '';
      prefillAdvancedFields(elements, null);
      updateModalVisibility(elements, 'body');
      elements.modalPattern.disabled = false;
      openModal(elements);
    });
    elements.addBtn?.addEventListener('click', async () => {
      const pattern = elements.patternInput.value.trim();
      if (!pattern) {
        showNotification('Pattern is required before adding a rule.', 'error');
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
        showPersistenceNotification('Rule added', result);
      } catch (error) {
        showNotification(`Could not add rule: ${errorMessage(error)}`, 'error');
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
        showNotification(`Could not save interception setting: ${errorMessage(error)}`, 'error');
        return;
      }

      try {
        await notifyBackground();
        showNotification(
          nextEnabled ? 'Interception enabled.' : 'Interception disabled.',
          'success'
        );
      } catch (error) {
        showNotification(
          `${nextEnabled ? 'Enabled' : 'Disabled'} setting saved, but the background update failed: ${errorMessage(error)}`,
          'warning',
          7000
        );
      }
    });
  }
}
