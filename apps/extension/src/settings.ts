export interface ExtensionSettings {
  baseUrl: string;
  token: string;
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  baseUrl: "http://127.0.0.1:17321",
  token: "",
};

export function loadSettings(): Promise<ExtensionSettings> {
  return chrome.storage.local.get(DEFAULT_SETTINGS) as Promise<ExtensionSettings>;
}
