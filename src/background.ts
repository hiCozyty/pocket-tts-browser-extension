/// <reference lib="webworker" />

const MENU_OPEN = "pocket_tts_open_popup";

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    chrome.runtime.openOptionsPage?.();
  }
});

chrome.action.onClicked.addListener(() => {
  // No-op; clicking the action opens the popup defined in manifest.json.
});

void MENU_OPEN;
