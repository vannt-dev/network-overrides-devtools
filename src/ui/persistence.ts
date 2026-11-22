/*! SPDX-License-Identifier: MIT | Copyright (c) 2025 Van Nguyen | github.com/vannt-dev/network-overrides-devtools */
/// <reference path="./types.ts" />
/// <reference path="./notifications.ts" />

namespace NetworkOverridesUi {
  export async function persistRuleChange(
    saveState: (rules: OverrideRule[]) => Promise<PersistenceResult>,
    nextOverrides: OverrideRule[],
    successMessage: string,
    renderRules: () => void
  ): Promise<void> {
    try {
      const result = await saveState(nextOverrides);
      renderRules();
      showPersistenceNotification(successMessage, result);
    } catch (error) {
      renderRules();
      showNotification(t('toast_update_rules_failed', errorMessage(error)), 'error');
    }
  }
}
