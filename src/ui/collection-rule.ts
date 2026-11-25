/*! SPDX-License-Identifier: MIT | Copyright (c) 2025 Van Nguyen | github.com/vannt-dev/network-overrides-devtools */
/// <reference types="chrome" />
/// <reference path="./types.ts" />
/// <reference path="./i18n.ts" />
/// <reference path="../collection.ts" />

namespace NetworkOverridesUi {
  /** Fills the collection fields from a rule, or clears them. */
  export function prefillCollectionFields(elements: Elements, rule: OverrideRule | null): void {
    const collection = rule?.mode === 'collection' ? rule : null;
    if (elements.modalCollectionIdField) {
      elements.modalCollectionIdField.value = collection?.collectionIdField || '';
    }
    if (elements.modalCollectionIdType) {
      elements.modalCollectionIdType.value =
        collection?.collectionIdType === 'uuid' ? 'uuid' : 'number';
    }
    if (elements.modalCollectionData) elements.modalCollectionData.value = '';
    setCollectionNote(elements, '');
  }

  function setCollectionNote(elements: Elements, text: string, isError = false): void {
    const note = elements.modalCollectionNote;
    if (!note) return;
    note.textContent = text;
    note.classList.toggle('is-error', isError);
  }

  /**
   * Checks the seed of a collection rule: a JSON array of objects, or blank.
   * A seed with `{{...}}` placeholders may only become JSON once they are
   * filled, so it is let through when placeholders are on.
   */
  export function collectionSeedError(seed: string, templates: boolean): string | null {
    const parsed = NetworkOverridesCollection.parseItems(seed);
    if (!('error' in parsed)) return null;
    if (templates && seed.includes('{{')) return null;
    return t('error_collection_seed', parsed.error);
  }

  /** The id settings of the collection rule being edited. */
  export function readCollectionSettings(
    elements: Elements
  ): Pick<OverrideRule, 'collectionIdField' | 'collectionIdType'> {
    const settings: Pick<OverrideRule, 'collectionIdField' | 'collectionIdType'> = {};
    const field = elements.modalCollectionIdField?.value.trim() || '';
    if (field && field !== NetworkOverridesCollection.DEFAULT_ID_FIELD) {
      settings.collectionIdField = field;
    }
    if (elements.modalCollectionIdType?.value === 'uuid') settings.collectionIdType = 'uuid';
    return settings;
  }

  export interface CollectionEditorOptions {
    elements: Elements;
    tabId: () => number | null;
    // The saved collection rule the editor is open on, or null for a new or other rule.
    savedRule: () => OverrideRule | null;
  }

  /**
   * The "Current data" box of a collection rule: shows the list the rule
   * answers from now, saves it as edited, or puts the seed back.
   */
  export function bindCollectionEditor(options: CollectionEditorOptions): {
    load: () => Promise<void>;
  } {
    const { elements } = options;
    const buttons = [
      elements.modalCollectionReload,
      elements.modalCollectionSave,
      elements.modalCollectionReset,
    ];

    function setEnabled(enabled: boolean): void {
      buttons.forEach(button => {
        if (button) button.disabled = !enabled;
      });
      if (elements.modalCollectionData) elements.modalCollectionData.readOnly = !enabled;
    }

    function send(message: Record<string, unknown>): Promise<any> {
      return new Promise(resolve => {
        try {
          chrome.runtime.sendMessage(message, response => {
            if (chrome.runtime.lastError) {
              resolve({ success: false, error: chrome.runtime.lastError.message });
              return;
            }
            resolve(response);
          });
        } catch (error) {
          resolve({
            success: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });
    }

    async function run(
      type: 'getCollection' | 'setCollection' | 'resetCollection',
      done: (count: number) => string,
      items?: unknown
    ): Promise<void> {
      const rule = options.savedRule();
      const tabId = options.tabId();
      if (!rule || tabId === null) {
        setEnabled(false);
        if (elements.modalCollectionData) elements.modalCollectionData.value = '';
        setCollectionNote(elements, t('collection_note_unsaved'));
        return;
      }
      setEnabled(true);
      const message: Record<string, unknown> = { type, tabId, pattern: rule.pattern };
      if (items !== undefined) message.items = items;
      const response = await send(message);
      if (!response || response.success === false) {
        const reason = response?.error === 'not-saved' ? '' : String(response?.error || '');
        setCollectionNote(
          elements,
          reason ? t('collection_note_error', reason) : t('collection_note_unsaved'),
          true
        );
        return;
      }
      const list = Array.isArray(response.items) ? response.items : [];
      if (elements.modalCollectionData) {
        elements.modalCollectionData.value = JSON.stringify(list, null, 2);
        elements.modalCollectionData.removeAttribute('aria-invalid');
      }
      setCollectionNote(elements, done(list.length));
    }

    const loaded = (count: number) => t('collection_note_loaded', String(count));
    elements.modalCollectionReload?.addEventListener('click', () => {
      void run('getCollection', loaded);
    });
    elements.modalCollectionReset?.addEventListener('click', () => {
      void run('resetCollection', count => t('collection_note_reset', String(count)));
    });
    elements.modalCollectionSave?.addEventListener('click', () => {
      const parsed = NetworkOverridesCollection.parseItems(
        elements.modalCollectionData?.value || ''
      );
      if ('error' in parsed) {
        elements.modalCollectionData?.setAttribute('aria-invalid', 'true');
        setCollectionNote(elements, t('error_collection_data', parsed.error), true);
        return;
      }
      void run('setCollection', count => t('collection_note_saved', String(count)), parsed.items);
    });

    return { load: () => run('getCollection', loaded) };
  }
}
