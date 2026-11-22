/*! SPDX-License-Identifier: MIT | Copyright (c) 2025 Van Nguyen | github.com/vannt-dev/network-overrides-devtools */
/// <reference path="./types.ts" />

namespace NetworkOverridesUi {
  export type NotificationKind = 'success' | 'warning' | 'error' | 'info';

  export interface NotificationAction {
    label: string;
    run: () => void | Promise<void>;
  }

  const MAX_VISIBLE_NOTIFICATIONS = 3;

  function getNotificationRegion(): HTMLElement {
    let region = document.getElementById('notification-region');
    if (region) return region;

    region = document.createElement('div');
    region.id = 'notification-region';
    region.className = 'notification-region';
    region.setAttribute('aria-live', 'polite');
    region.setAttribute('aria-relevant', 'additions');
    document.body.appendChild(region);
    return region;
  }

  export function showNotification(
    message: string,
    kind: NotificationKind = 'info',
    durationMs = kind === 'error' ? 7000 : 4000,
    action?: NotificationAction
  ): HTMLElement {
    const region = getNotificationRegion();
    const duplicate = Array.from(region.querySelectorAll<HTMLElement>('.notification-toast')).find(
      item => item.dataset.kind === kind && item.dataset.message === message
    );
    duplicate?.remove();

    const toast = document.createElement('div');
    toast.className = `notification-toast notification-toast--${kind}`;
    toast.dataset.kind = kind;
    toast.dataset.message = message;
    toast.setAttribute('role', kind === 'error' ? 'alert' : 'status');

    const text = document.createElement('span');
    text.className = 'notification-toast__message';
    text.textContent = message;
    toast.appendChild(text);

    if (action) {
      const actionButton = document.createElement('button');
      actionButton.type = 'button';
      actionButton.className = 'notification-toast__action';
      actionButton.textContent = action.label;
      actionButton.addEventListener('click', async () => {
        if (actionButton.disabled) return;
        actionButton.disabled = true;
        try {
          await action.run();
          toast.remove();
        } catch (error) {
          actionButton.disabled = false;
          showNotification(t('toast_retry_failed', errorMessage(error)), 'error', 7000);
        }
      });
      toast.appendChild(actionButton);
    }

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'notification-toast__close';
    close.setAttribute('aria-label', t('toast_dismiss'));
    close.textContent = '\u00d7';
    close.addEventListener('click', () => toast.remove());
    toast.appendChild(close);

    region.appendChild(toast);
    while (region.children.length > MAX_VISIBLE_NOTIFICATIONS) {
      region.firstElementChild?.remove();
    }

    if (durationMs > 0) window.setTimeout(() => toast.remove(), durationMs);
    return toast;
  }

  export function showPersistenceNotification(action: string, result: PersistenceResult): void {
    if (result.applied) {
      showNotification(t('toast_applied', action), 'success');
      return;
    }
    showNotification(
      result.warning
        ? t('toast_not_applied_reason', action, result.warning)
        : t('toast_not_applied', action),
      'warning',
      7000,
      result.retry
        ? {
            label: t('toast_retry'),
            run: async () => {
              await result.retry!();
              showNotification(t('toast_retry_done'), 'success');
            },
          }
        : undefined
    );
  }

  export function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error || t('error_unknown'));
  }
}
