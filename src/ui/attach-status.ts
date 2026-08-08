/// <reference path="./types.ts" />
/// <reference path="./notifications.ts" />

namespace NetworkOverridesUi {
  export function updateAttachStatus(
    elements: Elements,
    state: UiState,
    enabledStorageKey: string,
    attached: boolean,
    error?: string
  ): void {
    state.attached = attached;
    elements.attachStatus.classList.toggle('attach-status--on', attached && !error);
    elements.attachStatus.classList.toggle('attach-status--error', !!error);
    elements.attachStatus.style.display = '';
    elements.attachStatus.textContent = error
      ? `Attach failed: ${error}`
      : attached
        ? 'Intercepting requests'
        : 'Inactive';
    elements.enableCheckbox.checked = attached;
    if (!error) return;

    state.enabled = false;
    void Promise.resolve(chrome.storage.local.set({ [enabledStorageKey]: false })).catch(
      storageError => {
        showNotification(
          `Could not persist the disabled interception state: ${errorMessage(storageError)}`,
          'error'
        );
      }
    );
  }
}
