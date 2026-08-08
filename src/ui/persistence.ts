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
      showNotification(`Could not update rules: ${errorMessage(error)}`, 'error');
    }
  }
}
