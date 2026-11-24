/*! SPDX-License-Identifier: MIT | Copyright (c) 2025 Van Nguyen | github.com/vannt-dev/network-overrides-devtools */
/// <reference path="./types.ts" />
/// <reference path="./primitives.ts" />
/// <reference path="./headers-editor.ts" />

// The "Random responses" group of the rule editor: more answers for a body
// rule, each with a weight, and an optional seed for a repeatable order.
namespace NetworkOverridesUi {
  type ResponseVariant = NetworkOverridesShared.ResponseVariant;

  function variantRows(elements: Elements): HTMLElement[] {
    return Array.from(elements.modalVariants?.querySelectorAll<HTMLElement>('.variant-row') || []);
  }

  /** How many other responses the editor holds. */
  export function countResponseVariants(elements: Elements): number {
    return variantRows(elements).length;
  }

  function labelled(text: string, control: HTMLElement): HTMLLabelElement {
    const label = document.createElement('label');
    label.className = 'variant-field';
    const span = document.createElement('span');
    span.textContent = text;
    label.append(span, control);
    return label;
  }

  /** Adds one response row, filled from `variant` when given. */
  export function addResponseVariantRow(
    elements: Elements,
    variant: Partial<ResponseVariant> | null = null
  ): HTMLElement | null {
    const container = elements.modalVariants;
    if (!container) return null;
    const row = document.createElement('div');
    row.className = 'variant-row';

    const head = document.createElement('div');
    head.className = 'variant-row-head';
    const weight = createUiInput({
      className: 'variant-weight',
      type: 'number',
      value: variant && typeof variant.weight === 'number' ? String(variant.weight) : '1',
      ariaLabel: t('variant_weight'),
    });
    weight.min = '0';
    weight.max = String(NetworkOverridesUtils.MAX_RESPONSE_WEIGHT);
    const status = createUiInput({
      className: 'variant-status',
      type: 'number',
      placeholder: t('variant_status_placeholder'),
      value: variant && typeof variant.statusCode === 'number' ? String(variant.statusCode) : '',
      ariaLabel: t('variant_status'),
    });
    status.min = '100';
    status.max = '599';
    const remove = createUiButton('×', {
      className: 'variant-delete header-row-delete',
      variant: 'danger',
      size: 'small',
      title: t('variant_delete'),
      ariaLabel: t('variant_delete'),
    });
    remove.addEventListener('click', () => {
      row.remove();
      syncAdvancedGroups(elements);
    });
    head.append(
      labelled(t('variant_weight'), weight),
      labelled(t('variant_status'), status),
      remove
    );

    const body = document.createElement('textarea');
    body.className = 'variant-body ui-control';
    body.rows = 3;
    body.placeholder = t('variant_body_placeholder');
    body.setAttribute('aria-label', t('variant_body'));
    body.value = typeof variant?.body === 'string' ? variant.body : '';

    const headers = document.createElement('textarea');
    headers.className = 'variant-headers ui-control';
    headers.rows = 1;
    headers.placeholder = 'X-Custom: value';
    headers.setAttribute('aria-label', t('variant_headers'));
    headers.value = formatHeadersText(variant?.responseHeaders || []);

    row.append(head, labelled(t('variant_body'), body), labelled(t('variant_headers'), headers));
    container.appendChild(row);
    return row;
  }

  /** Fills the group from a rule, or empties it for a new one. */
  export function prefillResponseVariants(elements: Elements, rule: OverrideRule | null): void {
    elements.modalVariants?.replaceChildren();
    for (const variant of rule?.responses || []) addResponseVariantRow(elements, variant);
    if (elements.modalWeight) {
      elements.modalWeight.value =
        rule && typeof rule.weight === 'number' && rule.responses?.length
          ? String(rule.weight)
          : '';
    }
    if (elements.modalRandomSeed) {
      elements.modalRandomSeed.value =
        rule && typeof rule.randomSeed === 'number' ? String(rule.randomSeed) : '';
    }
  }

  function wholeNumber(text: string, min: number, max: number): number | null {
    if (!/^\d+$/.test(text)) return null;
    const value = Number(text);
    return value >= min && value <= max ? value : null;
  }

  /**
   * The other responses the editor holds, with the weight of the rule's own
   * answer and the seed, or the field that is wrong.
   */
  export function readResponseVariants(
    elements: Elements
  ):
    | { responses: ResponseVariant[]; weight?: number; randomSeed?: number }
    | { error: string; field: HTMLElement } {
    const maxWeight = NetworkOverridesUtils.MAX_RESPONSE_WEIGHT;
    const responses: ResponseVariant[] = [];
    for (const row of variantRows(elements)) {
      const weightInput = row.querySelector('.variant-weight') as HTMLInputElement;
      const statusInput = row.querySelector('.variant-status') as HTMLInputElement;
      const bodyInput = row.querySelector('.variant-body') as HTMLTextAreaElement;
      const headersInput = row.querySelector('.variant-headers') as HTMLTextAreaElement;
      const weight = wholeNumber(weightInput.value.trim(), 0, maxWeight);
      if (weight === null) {
        return { error: t('error_variant_weight', String(maxWeight)), field: weightInput };
      }
      const variant: ResponseVariant = { weight, body: bodyInput.value };
      const statusText = statusInput.value.trim();
      if (statusText) {
        const status = wholeNumber(statusText, 100, 599);
        if (status === null) return { error: t('error_status_range'), field: statusInput };
        variant.statusCode = status;
      }
      if (headersInput.value.split('\n').some(line => line.trim() && line.indexOf(':') <= 0)) {
        return { error: t('error_response_headers'), field: headersInput };
      }
      const headers = parseHeadersText(headersInput.value);
      if (headers.length > 0) variant.responseHeaders = headers;
      responses.push(variant);
    }
    const result: { responses: ResponseVariant[]; weight?: number; randomSeed?: number } = {
      responses,
    };
    if (responses.length === 0) return result;

    const weightText = elements.modalWeight?.value.trim() || '';
    if (weightText) {
      const weight = wholeNumber(weightText, 0, maxWeight);
      if (weight === null) {
        return {
          error: t('error_variant_weight', String(maxWeight)),
          field: elements.modalWeight as HTMLElement,
        };
      }
      result.weight = weight;
    }
    const total =
      (result.weight === undefined ? 1 : result.weight) +
      responses.reduce((sum, variant) => sum + variant.weight, 0);
    if (total <= 0) {
      return {
        error: t('error_variant_weights_zero'),
        field: (elements.modalWeight || elements.modalVariants) as HTMLElement,
      };
    }
    const seedText = elements.modalRandomSeed?.value.trim() || '';
    if (seedText) {
      const seed = wholeNumber(seedText, 0, NetworkOverridesUtils.MAX_RANDOM_SEED);
      if (seed === null) {
        return { error: t('error_random_seed'), field: elements.modalRandomSeed as HTMLElement };
      }
      result.randomSeed = seed;
    }
    return result;
  }

  /** Wires the "Add a response" button. */
  export function bindResponseVariants(elements: Elements): void {
    elements.modalAddVariant?.addEventListener('click', () => {
      const row = addResponseVariantRow(elements, null);
      (row?.querySelector('.variant-body') as HTMLTextAreaElement | null)?.focus();
      syncAdvancedGroups(elements);
    });
  }
}
