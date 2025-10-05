class LostKitLite {
    constructor() {
        this.externalWindows = true;
        this.ircWindowId = null;
        this.windowSettings = {};
        this.currentView = 'tools'; // 'tools' or 'worlds'
        this.worldsData = [];
        this.currentWorldUrl = '';
        this.isHighDetail = true;
        
        this.loadSettings();
        this.initializeEventListeners();
        this.applySettings();
        this.checkIRCWindow();
        this.detectCurrentWorld();
    }

    async loadSettings() {
        try {
            const result = await chrome.storage.local.get(['lostkit-settings']);
            const savedSettings = result['lostkit-settings'];
            
            if (savedSettings) {
                const settings = JSON.parse(savedSettings);
                this.externalWindows = settings.externalWindows !== undefined ? settings.externalWindows : true;
                this.windowSettings = settings.windowSettings || {};
                this.ircWindowId = settings.ircWindowId || null;
                this.isHighDetail = settings.isHighDetail !== undefined ? settings.isHighDetail : true;
            } else {
                this.setDefaultSettings();
            }
        } catch (error) {
            console.error('Error loading settings:', error);
            this.setDefaultSettings();
        }
    }

    setDefaultSettings() {
        this.externalWindows = true;
        this.windowSettings = {};
        this.ircWindowId = null;
        this.isHighDetail = true;
    }

    async saveSettings() {
        const settings = {
            externalWindows: this.externalWindows,
            windowSettings: this.windowSettings,
            ircWindowId: this.ircWindowId,
            isHighDetail: this.isHighDetail
        };
        
        try {
            await chrome.storage.local.set({ 'lostkit-settings': JSON.stringify(settings) });
        } catch (error) {
            console.error('Error saving settings:', error);
        }
    }

    async detectCurrentWorld() {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tab && tab.url) {
                const worldMatch = tab.url.match(/w(\d+)-2004\.lostcity\.rs/);
                if (worldMatch) {
                    this.currentWorldUrl = tab.url;
                    this.isHighDetail = this.detectDetailMode(tab.url);
                }
            }
        } catch (error) {
            console.error('Error detecting current world:', error);
        }
    }

    detectDetailMode(url) {
        if (!url) return true;
        const urlLower = url.toLowerCase();
        if (urlLower.includes('lowmem=0')) return true;
        if (urlLower.includes('lowmem=1')) return false;
        return true;
    }

    extractWorldNumber(url) {
        if (!url) return null;
        const match = url.match(/world[=:](\d+)/i);
        return match ? match[1] : null;
    }

    async fetchWorldsData() {
        try {
            const response = await fetch('https://2004.losthq.rs/pages/api/worlds.php');
            const data = await response.json();
            
            // Ensure all worlds have both hd and ld URLs
            data.forEach(world => {
                if (!world.hd) {
                    world.hd = `https://w${world.world}-2004.lostcity.rs/rs2.cgi?plugin=0&world=${world.world}&lowmem=0`;
                }
                if (!world.ld) {
                    world.ld = `https://w${world.world}-2004.lostcity.rs/rs2.cgi?plugin=0&world=${world.world}&lowmem=1`;
                }
            });
            
            this.worldsData = data;
            console.log(`Loaded ${data.length} worlds`);
        } catch (error) {
            console.error('Error fetching worlds data:', error);
            this.worldsData = [];
        }
    }

    initializeEventListeners() {
        // External windows checkbox
        document.getElementById('externalWindows').addEventListener('change', (e) => {
            this.externalWindows = e.target.checked;
            this.saveSettings();
        });

        // Tool buttons
        document.querySelectorAll('.tool-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                this.openTool(e.target.closest('.tool-btn'));
            });
        });

        // IRC toggle button
        document.getElementById('ircToggleBtn').addEventListener('click', () => {
            this.toggleIRCWindow();
        });

        // World switcher button
        document.getElementById('worldSwitcherBtn').addEventListener('click', () => {
            this.toggleWorldSwitcher();
        });

        // Back to tools button (in world switcher view)
        document.getElementById('backToToolsBtn').addEventListener('click', () => {
            this.showToolsPanel();
        });

        // Detail mode checkbox
        document.getElementById('detailCheckbox').addEventListener('change', (e) => {
            this.isHighDetail = e.target.checked;
            this.saveSettings();
            this.displayWorlds();
        });

        // Refresh button
        document.getElementById('refreshWorldsBtn').addEventListener('click', () => {
            this.refreshWorlds();
        });
    }

    applySettings() {
        document.getElementById('externalWindows').checked = this.externalWindows;
        document.getElementById('detailCheckbox').checked = this.isHighDetail;
        this.updateIRCButton();
    }

    async toggleWorldSwitcher() {
        if (this.currentView === 'tools') {
            await this.showWorldSwitcher();
        } else {
            this.showToolsPanel();
        }
    }

    async showWorldSwitcher() {
        this.currentView = 'worlds';
        document.getElementById('toolsPanel').style.display = 'none';
        document.getElementById('worldsPanel').style.display = 'flex';
        
        if (this.worldsData.length === 0) {
            await this.fetchWorldsData();
        }
        
        await this.detectCurrentWorld();
        this.displayWorlds();
    }

    showToolsPanel() {
        this.currentView = 'tools';
        document.getElementById('worldsPanel').style.display = 'none';
        document.getElementById('toolsPanel').style.display = 'flex';
    }

    displayWorlds() {
        const container = document.getElementById('worldsList');
        container.innerHTML = '';
        
        const currentWorld = this.extractWorldNumber(this.currentWorldUrl);
        const currentDetail = this.detectDetailMode(this.currentWorldUrl);
        
        this.worldsData.forEach(world => {
            const btn = document.createElement('button');
            btn.className = 'world-btn';
            
            const isCurrent = (String(world.world) === currentWorld && this.isHighDetail === currentDetail);
            if (isCurrent) {
                btn.classList.add('current-world');
            }
            
            const detailText = this.isHighDetail ? 'HD' : 'LD';
            const flagFile = this.getFlagFilename(world.location);
            
            btn.innerHTML = `
                <img src="images/${flagFile}" alt="${world.location}" class="world-flag">
                <span class="world-info">
                    <span class="world-number">World ${world.world}</span>
                    <span class="world-details">${world.count} players - ${world.location} (${detailText})</span>
                </span>
            `;
            
            btn.addEventListener('click', () => {
                this.switchWorld(world);
            });
            
            container.appendChild(btn);
        });
    }

    getFlagFilename(location) {
        const flagMap = {
            'US (Central)': 'us.svg',
            'US (West)': 'us.svg',
            'US (East)': 'us.svg',
            'Finland': 'fin.svg',
            'Australia': 'aus.svg',
            'Japan': 'jp.svg',
            'Singapore': 'sg.svg'
        };
        return flagMap[location] || 'us.svg';
    }

    async switchWorld(world) {
        const currentWorld = this.extractWorldNumber(this.currentWorldUrl);
        const currentDetail = this.detectDetailMode(this.currentWorldUrl);
        
        // Don't switch if same world and same detail mode
        if (String(world.world) === currentWorld && this.isHighDetail === currentDetail) {
            return;
        }
        
        const worldUrl = this.isHighDetail ? world.hd : world.ld;
        
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            
            // Check if current tab is a game world
            const isGameWorld = tab.url && tab.url.includes('2004.lostcity.rs');
            
            if (isGameWorld) {
                // Update current tab
                await chrome.tabs.update(tab.id, { url: worldUrl });
                this.currentWorldUrl = worldUrl;
                this.displayWorlds();
                console.log(`Switched to World ${world.world} (${this.isHighDetail ? 'HD' : 'LD'})`);
            } else {
                // Open in new tab if not currently on game world
                await chrome.tabs.create({ url: worldUrl });
                this.currentWorldUrl = worldUrl;
            }
        } catch (error) {
            console.error('Error switching world:', error);
        }
    }

    async refreshWorlds() {
        const btn = document.getElementById('refreshWorldsBtn');
        btn.textContent = 'Refreshing...';
        btn.disabled = true;
        
        await this.fetchWorldsData();
        this.displayWorlds();
        
        btn.textContent = 'Refresh';
        btn.disabled = false;
    }

    async checkIRCWindow() {
        if (this.ircWindowId) {
            try {
                const window = await chrome.windows.get(this.ircWindowId);
                if (!window) {
                    this.ircWindowId = null;
                    this.updateIRCButton();
                    this.saveSettings();
                }
            } catch (error) {
                this.ircWindowId = null;
                this.updateIRCButton();
                this.saveSettings();
            }
        }
    }

    updateIRCButton() {
        const ircBtn = document.getElementById('ircToggleBtn');
        
        if (this.ircWindowId) {
            ircBtn.classList.add('active');
            ircBtn.style.backgroundColor = '#4a6a4a';
        } else {
            ircBtn.classList.remove('active');
            ircBtn.style.backgroundColor = '#8b4a4a';
        }
    }

    async toggleIRCWindow() {
        if (this.ircWindowId) {
            try {
                await chrome.windows.remove(this.ircWindowId);
                this.ircWindowId = null;
            } catch (error) {
                console.error('Error closing IRC window:', error);
                this.ircWindowId = null;
            }
        } else {
            const windowSettings = this.windowSettings.irc || {
                width: 800,
                height: 600,
                left: Math.round(screen.width / 2 - 400),
                top: Math.round(screen.height / 2 - 300)
            };

            try {
                const window = await chrome.windows.create({
                    url: 'https://irc.losthq.rs',
                    type: 'popup',
                    width: windowSettings.width,
                    height: windowSettings.height,
                    left: windowSettings.left,
                    top: windowSettings.top,
                    focused: true
                });
                
                this.ircWindowId = window.id;
                
                chrome.windows.onRemoved.addListener((windowId) => {
                    if (windowId === this.ircWindowId) {
                        this.ircWindowId = null;
                        this.updateIRCButton();
                        this.saveSettings();
                    }
                });

                chrome.windows.onBoundsChanged.addListener((window) => {
                    if (window.id === this.ircWindowId) {
                        this.windowSettings.irc = {
                            width: window.width,
                            height: window.height,
                            left: window.left,
                            top: window.top
                        };
                        this.saveSettings();
                    }
                });

            } catch (error) {
                console.error('Error opening IRC window:', error);
            }
        }
        
        this.updateIRCButton();
        this.saveSettings();
    }

    async openTool(button) {
        const url = button.dataset.url;
        const name = button.dataset.name;

        if (this.externalWindows) {
            const windowKey = name.toLowerCase().replace(/\s+/g, '_');
            const windowSettings = this.windowSettings[windowKey] || {
                width: 1000,
                height: 800,
                left: Math.round(screen.width / 2 - 500),
                top: Math.round(screen.height / 2 - 400)
            };

            try {
                const window = await chrome.windows.create({
                    url: url,
                    type: 'popup',
                    width: windowSettings.width,
                    height: windowSettings.height,
                    left: windowSettings.left,
                    top: windowSettings.top
                });

                chrome.windows.onBoundsChanged.addListener((updatedWindow) => {
                    if (updatedWindow.id === window.id) {
                        this.windowSettings[windowKey] = {
                            width: updatedWindow.width,
                            height: updatedWindow.height,
                            left: updatedWindow.left,
                            top: updatedWindow.top
                        };
                        this.saveSettings();
                    }
                });

            } catch (error) {
                console.error('Error opening window:', error);
                chrome.tabs.create({ url: url });
            }
        } else {
            chrome.tabs.create({ url: url });
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new LostKitLite();
});