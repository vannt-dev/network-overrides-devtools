namespace NetworkOverridesUi {
  export type UiButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';
  export type UiControlSize = 'small' | 'medium';

  export interface UiButtonOptions {
    className?: string;
    variant?: UiButtonVariant;
    size?: UiControlSize;
    title?: string;
    ariaLabel?: string;
  }

  export interface UiInputOptions {
    className?: string;
    placeholder?: string;
    value?: string;
    type?: string;
    ariaLabel?: string;
  }

  function addClasses(element: Element, classNames: Array<string | undefined>): void {
    classNames
      .flatMap(value => (value || '').split(/\s+/))
      .filter(Boolean)
      .forEach(className => element.classList.add(className));
  }

  export function createUiButton(text: string, options: UiButtonOptions = {}): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = text;
    addClasses(button, [
      'ui-btn',
      `ui-btn--${options.variant || 'secondary'}`,
      `ui-btn--${options.size || 'medium'}`,
      options.className,
    ]);
    if (options.title) button.title = options.title;
    if (options.ariaLabel) button.setAttribute('aria-label', options.ariaLabel);
    return button;
  }

  export function createUiInput(options: UiInputOptions = {}): HTMLInputElement {
    const input = document.createElement('input');
    input.type = options.type || 'text';
    input.className = 'ui-control';
    addClasses(input, [options.className]);
    if (options.placeholder) input.placeholder = options.placeholder;
    if (options.value !== undefined) input.value = options.value;
    if (options.ariaLabel) input.setAttribute('aria-label', options.ariaLabel);
    return input;
  }

  function inferButtonVariant(button: HTMLButtonElement): UiButtonVariant {
    if (
      button.id === 'save-override' ||
      button.id === 'curl-swagger-import-btn' ||
      button.id === 'add'
    ) {
      return 'primary';
    }
    if (button.matches('.delete-btn, .header-row-delete, #delete-profile-btn')) return 'danger';
    if (button.matches('.header-btn, .action-btn, .modal-action-btn, .curl-btn')) return 'ghost';
    if (button.matches('.add-api-btn, .add-header-row-btn')) return 'outline';
    return 'secondary';
  }

  export function upgradeUiPrimitives(root: ParentNode = document): void {
    root.querySelectorAll<HTMLElement>('.modal-field').forEach(field => {
      field.classList.add('ui-field');
      const label = field.querySelector<HTMLElement>(':scope > span');
      label?.classList.add('ui-label');
    });

    root
      .querySelectorAll<
        HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
      >('input:not([type="checkbox"]):not([type="radio"]), select, textarea')
      .forEach(control => {
        control.classList.add('ui-control');
        if (control instanceof HTMLInputElement && control.type === 'file') {
          control.classList.add('ui-control--file');
        }
      });

    root.querySelectorAll<HTMLButtonElement>('button').forEach(button => {
      button.type = 'button';
      button.classList.add('ui-btn', `ui-btn--${inferButtonVariant(button)}`);
      if (button.matches('.header-btn, .action-btn, .add-api-btn, .header-row-delete')) {
        button.classList.add('ui-btn--small');
      } else {
        button.classList.add('ui-btn--medium');
      }
    });
  }
}
