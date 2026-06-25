// Background script for extension functionality
chrome.runtime.onInstalled.addListener(() => {
    console.log('LostKit Lite extension installed');
});

// Persistent state for the popup-window fallback (used on Opera / Opera GX).
// Kept in its own storage key so it is not clobbered by sidepanel.js, which
// rewrites the 'lostkit-settings' object wholesale.
const PANEL_STORE_KEY = 'lostkit-panel-window';

async function getPanelStore() {
    try {
        const result = await chrome.storage.local.get([PANEL_STORE_KEY]);
        if (result[PANEL_STORE_KEY]) {
            return JSON.parse(result[PANEL_STORE_KEY]);
        }
    } catch (e) {
        console.error('Error reading panel window state:', e);
    }
    return {};
}

async function setPanelStore(store) {
    try {
        await chrome.storage.local.set({ [PANEL_STORE_KEY]: JSON.stringify(store) });
    } catch (e) {
        console.error('Error saving panel window state:', e);
    }
}

// Open the popup-window fallback, restoring its last size/position and reusing
// an already-open window instead of spawning a duplicate.
async function openPanelPopup() {
    const store = await getPanelStore();

    // If a panel window is already open, just focus it.
    if (store.id != null) {
        try {
            await chrome.windows.get(store.id);
            await chrome.windows.update(store.id, { focused: true });
            return;
        } catch (e) {
            // Stored window no longer exists; fall through to create a new one.
        }
    }

    const bounds = store.bounds || {};
    const createOptions = {
        url: chrome.runtime.getURL('sidepanel.html'),
        type: 'popup',
        focused: true,
        width: Number.isInteger(bounds.width) ? bounds.width : 400,
        height: Number.isInteger(bounds.height) ? bounds.height : 720
    };
    if (Number.isInteger(bounds.left)) createOptions.left = bounds.left;
    if (Number.isInteger(bounds.top)) createOptions.top = bounds.top;

    try {
        const win = await chrome.windows.create(createOptions);
        store.id = win.id;
        await setPanelStore(store);
    } catch (e) {
        console.error('Could not open popup window, opening a tab instead:', e);
        chrome.tabs.create({ url: chrome.runtime.getURL('sidepanel.html') });
    }
}

// Remember the panel window's size/position as the user moves or resizes it.
// onBoundsChanged is Chromium-only (covers Opera); harmless to skip elsewhere.
if (chrome.windows.onBoundsChanged) {
    chrome.windows.onBoundsChanged.addListener(async (win) => {
        const store = await getPanelStore();
        if (store.id === win.id) {
            store.bounds = {
                width: win.width,
                height: win.height,
                left: win.left,
                top: win.top
            };
            await setPanelStore(store);
        }
    });
}

// Open the panel when the toolbar icon is clicked. Engines differ, so cascade:
//   - Chrome / newer Chromium: native docked side panel (chrome.sidePanel)
//   - Opera / Opera GX: no sidePanel API -> fall back to a popup window
chrome.action.onClicked.addListener(async (tab) => {
    // Chrome and Chromium builds with the Side Panel API.
    if (chrome.sidePanel && chrome.sidePanel.open) {
        try {
            await chrome.sidePanel.open({ windowId: tab.windowId });
            return;
        } catch (e) {
            console.error('sidePanel.open failed, falling back:', e);
        }
    }

    // Fallback for Opera / Opera GX and anything without a panel API.
    await openPanelPopup();
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

// Clear the stored panel window id when it closes (keep its bounds for next time).
chrome.windows.onRemoved.addListener(async (windowId) => {
    const store = await getPanelStore();
    if (store.id === windowId) {
        store.id = null;
        await setPanelStore(store);
    }
});
