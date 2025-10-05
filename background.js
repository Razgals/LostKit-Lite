// Background script for extension functionality
chrome.runtime.onInstalled.addListener(() => {
    console.log('LostKit Lite extension installed');
});

// Open side panel when extension icon is clicked
chrome.action.onClicked.addListener((tab) => {
    chrome.sidePanel.open({ windowId: tab.windowId });
});

// Listen for window closes to update IRC window state
chrome.windows.onRemoved.addListener((windowId) => {
    chrome.storage.local.get(['lostkit-settings'], (result) => {
        if (result['lostkit-settings']) {
            const settings = JSON.parse(result['lostkit-settings']);
            if (settings.ircWindowId === windowId) {
                settings.ircWindowId = null;
                chrome.storage.local.set({ 
                    'lostkit-settings': JSON.stringify(settings) 
                });
            }
        }
    });
});