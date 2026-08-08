/// <reference types="chrome" />
/// <reference path="../shared.ts" />
/// <reference path="../utils.ts" />

namespace NetworkOverridesUi {
  export const KNOWN_METHODS = ['ANY', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
  export type OverrideMode = NetworkOverridesShared.OverrideMode;
  export type OverrideRule = NetworkOverridesShared.OverrideRule;
  export type ApiEntry = NetworkOverridesShared.ApiEntry;
  export type FetchHeader = NetworkOverridesShared.FetchHeader;
  export type HeaderField = NetworkOverridesShared.FetchHeader;

  export interface PersistenceResult {
    applied: boolean;
    warning?: string;
    retry?: () => Promise<void>;
  }

  export interface Elements {
    enableCheckbox: HTMLInputElement;
    attachStatus: HTMLElement;
    patternInput: HTMLInputElement;
    bodyInput: HTMLTextAreaElement;
    addBtn: HTMLButtonElement;
    listEl: HTMLUListElement;
    modeSelect: HTMLSelectElement;
    apisSection: HTMLDivElement;
    apiSearchInput: HTMLInputElement;
    apisList: HTMLDivElement;
    tabsContainer: HTMLDivElement;
    overridesSection: HTMLDivElement;
    modal: HTMLDivElement;
    modalUrl: HTMLElement;
    modalTitleText: HTMLElement;
    modalPattern: HTMLInputElement;
    modalMethod: HTMLSelectElement;
    modalMode: HTMLSelectElement;
    modalBody: HTMLTextAreaElement;
    modalRedirectUrl: HTMLInputElement;
    modalBodyFields: HTMLDivElement;
    modalRedirectFields: HTMLDivElement;
    modalStatus: HTMLInputElement;
    modalDelay: HTMLInputElement;
    modalHeaders: HTMLTextAreaElement;
    modalFailFields: HTMLDivElement;
    modalFailReason: HTMLSelectElement;
    modalAdvancedFields: HTMLDivElement;
    modalStatusField: HTMLElement;
    modalHeadersField: HTMLElement;
    modalFeedback: HTMLElement;
    saveOverrideBtn: HTMLButtonElement;
    formatJsonBtn: HTMLButtonElement;
    closeModal: HTMLElement;
    newRow: HTMLDivElement;
    refreshBtn: HTMLButtonElement;
    infoBtn: HTMLButtonElement;
    redirectUrlInput: HTMLInputElement;
    addApiBtn: HTMLButtonElement;
    exportRulesBtn: HTMLButtonElement;
    importRulesBtn: HTMLButtonElement;
    importRulesInput: HTMLInputElement;
    modalRequestHeaders?: HTMLTextAreaElement;
    modalRequestHeadersField?: HTMLElement;
    modalGraphqlOp?: HTMLInputElement;
    modalPreviewContainer?: HTMLDivElement;
    profilesSelect?: HTMLSelectElement;
    saveProfileBtn?: HTMLButtonElement;
    deleteProfileBtn?: HTMLButtonElement;
    // New Visual Table & cURL/Swagger elements
    modalRequestHeadersTable?: HTMLDivElement;
    modalResponseHeadersTable?: HTMLDivElement;
    importCurlSwaggerBtn?: HTMLButtonElement;
    curlSwaggerModal?: HTMLDivElement;
    curlSwaggerTextarea?: HTMLTextAreaElement;
    curlSwaggerFileInput?: HTMLInputElement;
    curlSwaggerImportBtn?: HTMLButtonElement;
    curlSwaggerCloseModal?: HTMLElement;
  }

  export interface AppOptions {
    autoFillOnOpen: boolean;
    showManualEditor: boolean;
  }

  export interface UiApi {
    url: string;
    type: string;
    method?: string;
    headers?: HeaderField[];
    postData?: string;
    hasBody?: boolean;
    body?: string;
    statusCode?: number;
    ruleCount?: number;
    isDisabledOnly?: boolean;
  }

  export interface UiState {
    overrides: OverrideRule[];
    currentEditIndex: number | null;
    capturedApis: UiApi[];
    apiFilter: string;
    activeTab: string;
    attached: boolean;
    enabled: boolean;
    attachError: string | null;
  }
}
