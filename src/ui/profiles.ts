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
      selectEl.innerHTML = '<option value="">-- Rule Profiles --</option>';
      Object.keys(profiles).forEach(name => {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        selectEl.appendChild(option);
      });
    } catch (error) {
      showNotification(`Could not load rule profiles: ${errorMessage(error)}`, 'error');
    }
  }

  export async function saveProfile(
    selectEl: HTMLSelectElement | undefined,
    domain: string,
    currentRules: OverrideRule[]
  ): Promise<void> {
    if (!domain) {
      showNotification('A page domain is required before saving a profile.', 'error');
      return;
    }
    const profileName = await showPromptDialog(
      'Save rule profile',
      'Save the current rules as a reusable profile for this domain.',
      'Profile name',
      'e.g. Staging Mock or Error Flow'
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
      showNotification(`Profile “${profileName}” saved.`, 'success');
    } catch (error) {
      showNotification(`Could not save profile: ${errorMessage(error)}`, 'error');
    }
  }

  export async function deleteProfile(
    selectEl: HTMLSelectElement | undefined,
    domain: string
  ): Promise<void> {
    if (!selectEl || !selectEl.value || !domain) {
      showNotification('Select a profile to delete.', 'error');
      return;
    }
    const name = selectEl.value;
    const confirmed = await showConfirmDialog(
      'Delete rule profile',
      `Delete profile “${name}”? This cannot be undone.`,
      'Delete',
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
      showNotification(`Profile “${name}” deleted.`, 'success');
    } catch (error) {
      showNotification(`Could not delete profile: ${errorMessage(error)}`, 'error');
    }
  }
}
