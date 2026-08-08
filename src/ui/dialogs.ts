namespace NetworkOverridesUi {
  let dialogQueue: Promise<void> = Promise.resolve();

  interface DialogOptions {
    title: string;
    message: string;
    primaryLabel: string;
    secondaryLabel?: string;
    inputLabel?: string;
    inputPlaceholder?: string;
    danger?: boolean;
  }

  function presentDialog(options: DialogOptions): Promise<boolean | string | null> {
    return new Promise(resolve => {
      const previousFocus = document.activeElement as HTMLElement | null;
      const backdrop = document.createElement('div');
      backdrop.className = 'ui-dialog-backdrop';

      const dialog = document.createElement('section');
      dialog.className = 'ui-dialog';
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-modal', 'true');
      dialog.setAttribute('aria-labelledby', 'shared-dialog-title');

      const title = document.createElement('h3');
      title.id = 'shared-dialog-title';
      title.className = 'ui-dialog__title';
      title.textContent = options.title;

      const message = document.createElement('p');
      message.className = 'ui-dialog__message';
      message.textContent = options.message;
      dialog.append(title, message);

      let input: HTMLInputElement | undefined;
      if (options.inputLabel) {
        const field = document.createElement('label');
        field.className = 'modal-field';
        const label = document.createElement('span');
        label.textContent = options.inputLabel;
        input = document.createElement('input');
        input.type = 'text';
        input.placeholder = options.inputPlaceholder || '';
        field.append(label, input);
        dialog.appendChild(field);
      }

      const actions = document.createElement('div');
      actions.className = 'ui-dialog__actions';
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'ui-btn ui-btn--secondary';
      cancel.textContent = 'Cancel';
      actions.appendChild(cancel);

      if (options.secondaryLabel) {
        const secondary = document.createElement('button');
        secondary.type = 'button';
        secondary.className = 'ui-btn ui-btn--outline';
        secondary.textContent = options.secondaryLabel;
        secondary.dataset.dialogAction = 'secondary';
        actions.appendChild(secondary);
      }

      const primary = document.createElement('button');
      primary.type = 'button';
      primary.className = options.danger ? 'ui-btn ui-btn--danger' : 'ui-btn ui-btn--primary';
      primary.textContent = options.primaryLabel;
      primary.dataset.dialogAction = 'primary';
      actions.appendChild(primary);
      dialog.appendChild(actions);
      backdrop.appendChild(dialog);
      document.body.appendChild(backdrop);

      const finish = (value: boolean | string | null): void => {
        document.removeEventListener('keydown', onKeyDown);
        backdrop.remove();
        previousFocus?.focus();
        resolve(value);
      };
      const submit = (): void => {
        if (!input) {
          finish(true);
          return;
        }
        const value = input.value.trim();
        if (!value) {
          input.setAttribute('aria-invalid', 'true');
          input.focus();
          return;
        }
        finish(value);
      };
      const onKeyDown = (event: KeyboardEvent): void => {
        if (event.key === 'Escape') finish(null);
        if (event.key === 'Enter' && document.activeElement !== cancel) submit();
      };
      cancel.addEventListener('click', () => finish(null));
      actions
        .querySelector<HTMLElement>('[data-dialog-action="secondary"]')
        ?.addEventListener('click', () => finish(false));
      primary.addEventListener('click', submit);
      document.addEventListener('keydown', onKeyDown);
      window.setTimeout(() => (input || primary).focus(), 0);
    });
  }

  function openDialog(options: DialogOptions): Promise<boolean | string | null> {
    const operation = dialogQueue.then(() => presentDialog(options));
    dialogQueue = operation.then(
      () => undefined,
      () => undefined
    );
    return operation;
  }

  export async function showConfirmDialog(
    title: string,
    message: string,
    primaryLabel = 'Confirm',
    secondaryLabel?: string,
    danger = false
  ): Promise<boolean | null> {
    return (await openDialog({
      title,
      message,
      primaryLabel,
      secondaryLabel,
      danger,
    })) as boolean | null;
  }

  export async function showPromptDialog(
    title: string,
    message: string,
    inputLabel: string,
    inputPlaceholder = ''
  ): Promise<string | null> {
    return (await openDialog({
      title,
      message,
      primaryLabel: 'Save',
      inputLabel,
      inputPlaceholder,
    })) as string | null;
  }
}
