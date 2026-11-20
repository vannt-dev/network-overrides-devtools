/*! SPDX-License-Identifier: MIT | Copyright (c) 2025 Van Nguyen | github.com/vannt-dev/network-overrides-devtools */
/// <reference path="./types.ts" />
/// <reference path="./notifications.ts" />
/// <reference path="./dialogs.ts" />

namespace NetworkOverridesUi {
  export async function loadProfiles(
    selectEl: HTMLSelectElement | undefined,
    domain: string
  ): Promise<void> {
    if (!selectEl || !domain) return;
    const key = `rule_profiles_${domain}`;
    try {
      const data = await Promise.resolve(chrome.storage.local.get([key]));
      const profiles: Record<string, OverrideRule[]> = data[key] || {};
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = t('profiles_placeholder');
      placeholder.dataset.i18n = 'profiles_placeholder';
      selectEl.replaceChildren(placeholder);
      Object.keys(profiles).forEach(name => {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        selectEl.appendChild(option);
      });
    } catch (error) {
      showNotification(t('toast_profiles_load_failed', errorMessage(error)), 'error');
    }
  }

  export async function saveProfile(
    selectEl: HTMLSelectElement | undefined,
    domain: string,
    currentRules: OverrideRule[]
  ): Promise<void> {
    if (!domain) {
      showNotification(t('toast_profile_needs_domain'), 'error');
      return;
    }
    const profileName = await showPromptDialog(
      t('profile_save_title'),
      t('profile_save_message'),
      t('profile_name_label'),
      t('profile_name_placeholder')
    );
    if (!profileName) return;
    const key = `rule_profiles_${domain}`;
    try {
      const data = await Promise.resolve(chrome.storage.local.get([key]));
      const profiles: Record<string, OverrideRule[]> = data[key] || {};
      profiles[profileName] = JSON.parse(JSON.stringify(currentRules));
      await Promise.resolve(chrome.storage.local.set({ [key]: profiles }));
      await loadProfiles(selectEl, domain);
      if (selectEl) selectEl.value = profileName;
      showNotification(t('toast_profile_saved', profileName), 'success');
    } catch (error) {
      showNotification(t('toast_profile_save_failed', errorMessage(error)), 'error');
    }
  }

  export async function deleteProfile(
    selectEl: HTMLSelectElement | undefined,
    domain: string
  ): Promise<void> {
    if (!selectEl || !selectEl.value || !domain) {
      showNotification(t('toast_profile_select'), 'error');
      return;
    }
    const name = selectEl.value;
    const confirmed = await showConfirmDialog(
      t('profile_delete_title'),
      t('profile_delete_message', name),
      t('profile_delete_button'),
      undefined,
      true
    );
    if (!confirmed) return;

    const key = `rule_profiles_${domain}`;
    try {
      const data = await Promise.resolve(chrome.storage.local.get([key]));
      const profiles: Record<string, OverrideRule[]> = data[key] || {};
      delete profiles[name];
      await Promise.resolve(chrome.storage.local.set({ [key]: profiles }));
      await loadProfiles(selectEl, domain);
      showNotification(t('toast_profile_deleted', name), 'success');
    } catch (error) {
      showNotification(t('toast_profile_delete_failed', errorMessage(error)), 'error');
    }
  }
}
