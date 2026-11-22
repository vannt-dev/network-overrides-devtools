/*! SPDX-License-Identifier: MIT | Copyright (c) 2025 Van Nguyen | github.com/vannt-dev/network-overrides-devtools */
/// <reference path="./types.ts" />
/// <reference path="./headers-editor.ts" />
/// <reference path="./modal.ts" />
/// <reference path="../static-files.ts" />

namespace NetworkOverridesUi {
  /**
   * Above this many characters of body, the editor warns that the rule may not
   * fit: rules live in chrome.storage, which holds about 10 MB in all.
   */
  export const LARGE_BODY_CHARS = 2 * 1024 * 1024;

  /** The name of the local file the body came from, or '' when there is none. */
  export function heldFileName(elements: Elements): string {
    return elements.modalBodyFileInfo?.dataset.fileName || '';
  }

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round((bytes / 1024) * 10) / 10} KB`;
    return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
  }

  /** The size of the body in bytes: base64 is counted as the bytes it holds. */
  function bodySize(elements: Elements): number {
    const body = elements.modalBody.value;
    if (elements.modalMode.value === 'file') {
      const padding = body.endsWith('==') ? 2 : body.endsWith('=') ? 1 : 0;
      return Math.max(0, Math.floor((body.length * 3) / 4) - padding);
    }
    return body.length;
  }

  /**
   * A binary file is kept as base64 out of sight: the editor shows its name
   * and size instead. A text file stays in the text box, to be edited.
   */
  export function updateFileVisibility(elements: Elements): void {
    const info = elements.modalBodyFileInfo;
    if (!info) return;
    const name = heldFileName(elements);
    const binary = !!name && elements.modalMode.value === 'file';
    info.hidden = !name;
    if (elements.modalBodyFileName) {
      elements.modalBodyFileName.textContent = name
        ? t('file_loaded', name, formatSize(bodySize(elements)))
        : '';
    }
    elements.modalBody.style.display = binary ? 'none' : '';
    if (binary) elements.formatJsonBtn.style.display = 'none';
  }

  function setHeldFile(elements: Elements, name: string): void {
    if (!elements.modalBodyFileInfo) return;
    if (name) elements.modalBodyFileInfo.dataset.fileName = name;
    else delete elements.modalBodyFileInfo.dataset.fileName;
    updateFileVisibility(elements);
  }

  /** Fills the inject fields and the local-file note from a rule, or clears them. */
  export function prefillStaticFields(elements: Elements, rule: OverrideRule | null): void {
    const inject = rule?.kind === 'inject' ? rule : null;
    if (elements.modalInjectScript) elements.modalInjectScript.value = inject?.injectScript || '';
    if (elements.modalInjectStyle) elements.modalInjectStyle.value = inject?.injectStyle || '';
    if (elements.modalInjectRelaxCsp) elements.modalInjectRelaxCsp.checked = !!inject?.relaxCsp;
    setHeldFile(elements, !inject && rule?.fileName ? rule.fileName : '');
  }

  /** Builds an inject rule from the editor, or says which field is missing. */
  export function readInjectRule(
    elements: Elements,
    pattern: string
  ): { rule: OverrideRule } | { error: string; field: HTMLElement } {
    const script = elements.modalInjectScript?.value || '';
    const style = elements.modalInjectStyle?.value || '';
    if (!script.trim() && !style.trim()) {
      return {
        error: t('error_inject_empty'),
        field: (elements.modalInjectScript || elements.modalPattern) as HTMLElement,
      };
    }
    const rule: OverrideRule = { pattern, body: '', mode: 'text', kind: 'inject' };
    if (script.trim()) rule.injectScript = script;
    if (style.trim()) rule.injectStyle = style;
    if (elements.modalInjectRelaxCsp?.checked) rule.relaxCsp = true;
    if (elements.modalGlobalRule?.checked) rule.isGlobal = true;
    return { rule };
  }

  /** Puts `Content-Type: <type>` in the response headers, replacing any there. */
  function setContentTypeHeader(elements: Elements, contentType: string): void {
    const kept = elements.modalHeaders.value
      .split('\n')
      .filter(line => line.trim() && !/^\s*content-type\s*:/i.test(line));
    elements.modalHeaders.value = [`Content-Type: ${contentType}`, ...kept].join('\n');
    if (elements.modalResponseHeadersTable) {
      renderHeaderTable(elements.modalResponseHeadersTable, elements.modalHeaders);
    }
  }

  function readFile(file: File, asText: boolean): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ''));
      reader.onerror = () => reject(reader.error || new Error('read failed'));
      if (asText) reader.readAsText(file);
      else reader.readAsDataURL(file);
    });
  }

  function showFileFeedback(elements: Elements, message: string, kind: 'info' | 'error'): void {
    elements.modalFeedback.textContent = message;
    elements.modalFeedback.className = `modal-feedback is-${kind}`;
  }

  /**
   * "Use a local file…": the picked file becomes the response body. A text
   * file (script, stylesheet, page, JSON, SVG) goes into the text box as is,
   * with {{...}} placeholders left alone; anything else is kept as base64.
   * Its Content-Type is set from the file, and can be changed under
   * Advanced → Response headers.
   */
  export function bindLocalFilePicker(elements: Elements): void {
    const picker = elements.modalBodyFile;
    if (!picker) return;
    elements.modalBodyFileBtn?.addEventListener('click', () => {
      picker.value = '';
      picker.click();
    });
    elements.modalBodyFileClear?.addEventListener('click', () => {
      if (elements.modalMode.value === 'file') {
        elements.modalBody.value = '';
        elements.modalMode.value = 'text';
        updateScriptHelp(elements);
      }
      setHeldFile(elements, '');
      updateBodyFormatAction(elements);
      updateImagePreview(elements, elements.modalBody.value);
      syncAdvancedGroups(elements);
    });
    // A base64 body is hidden only while the body type is base64.
    elements.modalMode?.addEventListener('change', () => updateFileVisibility(elements));
    picker.addEventListener('change', async () => {
      const file = picker.files?.[0];
      if (!file) return;
      picker.dataset.loading = 'true';
      try {
        const contentType =
          NetworkOverridesUtils.guessContentType(file.name) ||
          file.type ||
          NetworkOverridesUtils.guessContentType(elements.modalPattern.value) ||
          'application/octet-stream';
        const asText = NetworkOverridesUtils.isTextContentType(contentType);
        const content = await readFile(file, asText);
        if (asText) {
          elements.modalMode.value = 'text';
          elements.modalBody.value = content;
          if (elements.modalProcessTemplates) elements.modalProcessTemplates.checked = false;
        } else {
          const comma = content.indexOf(',');
          elements.modalMode.value = 'file';
          elements.modalBody.value = comma >= 0 ? content.slice(comma + 1) : '';
        }
        setContentTypeHeader(elements, contentType);
        updateScriptHelp(elements);
        setHeldFile(elements, file.name);
        updateBodyFormatAction(elements);
        updateFileVisibility(elements);
        updateImagePreview(elements, elements.modalBody.value);
        syncAdvancedGroups(elements);
        if (elements.modalBody.value.length > LARGE_BODY_CHARS) {
          showFileFeedback(
            elements,
            t('file_large_warning', file.name, formatSize(elements.modalBody.value.length)),
            'info'
          );
        } else {
          showFileFeedback(elements, t('file_loaded', file.name, formatSize(file.size)), 'info');
        }
      } catch (error) {
        showFileFeedback(elements, t('file_read_failed', errorMessage(error)), 'error');
      } finally {
        delete picker.dataset.loading;
      }
    });
  }
}
