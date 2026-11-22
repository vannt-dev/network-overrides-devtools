/*! SPDX-License-Identifier: MIT | Copyright (c) 2025 Van Nguyen | github.com/vannt-dev/network-overrides-devtools */
/// <reference path="./types.ts" />
/// <reference path="./notifications.ts" />

namespace NetworkOverridesUi {
  /** The status line next to the switch, from the last reported attach state. */
  export function attachStatusText(state: UiState): string {
    if (state.attachError) return t('attach_failed', state.attachError);
    return state.attached ? t('attach_on') : t('attach_off');
  }

  export function updateAttachStatus(
    elements: Elements,
    state: UiState,
    enabledStorageKey: string,
    attached: boolean,
    error?: string
  ): void {
    state.attached = attached;
    state.attachError = error || null;
    elements.attachStatus.classList.toggle('attach-status--on', attached && !error);
    elements.attachStatus.classList.toggle('attach-status--error', !!error);
    elements.attachStatus.style.display = '';
    elements.attachStatus.textContent = attachStatusText(state);
    elements.enableCheckbox.checked = attached;
    if (!error) return;

    state.enabled = false;
    void Promise.resolve(chrome.storage.local.set({ [enabledStorageKey]: false })).catch(
      storageError => {
        showNotification(t('toast_persist_disabled_failed', errorMessage(storageError)), 'error');
      }
    );
  }
}
