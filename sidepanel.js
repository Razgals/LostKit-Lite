// Maps the hiscores API stat "type" to a display name and skill icon.
// Mirrors the LostKit (Electron) hiscores logic; icons live in skillicons/.
const SKILL_MAP = {
    0: { name: 'Overall', icon: 'stats.webp' },
    1: { name: 'Attack', icon: 'attack.webp' },
    2: { name: 'Defence', icon: 'defence.webp' },
    3: { name: 'Strength', icon: 'strength.webp' },
    4: { name: 'Hitpoints', icon: 'hitpoints.webp' },
    5: { name: 'Ranged', icon: 'ranged.webp' },
    6: { name: 'Prayer', icon: 'prayer.webp' },
    7: { name: 'Magic', icon: 'magic.webp' },
    8: { name: 'Cooking', icon: 'cooking.webp' },
    9: { name: 'Woodcutting', icon: 'woodcutting.webp' },
    10: { name: 'Fletching', icon: 'fletching.webp' },
    11: { name: 'Fishing', icon: 'fishing.webp' },
    12: { name: 'Firemaking', icon: 'firemaking.webp' },
    13: { name: 'Crafting', icon: 'crafting.webp' },
    14: { name: 'Smithing', icon: 'smithing.webp' },
    15: { name: 'Mining', icon: 'mining.webp' },
    16: { name: 'Herblore', icon: 'herblore.webp' },
    17: { name: 'Agility', icon: 'agility.webp' },
    18: { name: 'Thieving', icon: 'thieving.webp' },
    21: { name: 'Runecraft', icon: 'runecraft.webp' }
};

const SKILL_ORDER = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 21];
const MAX_LEVEL = 99;

// Cumulative XP required to reach each level (index = level), using the
// standard RuneScape XP formula. XP_TABLE[1] = 0, XP_TABLE[99] = 13,034,431.
const XP_TABLE = (() => {
    const table = [0, 0];
    let points = 0;
    for (let level = 1; level < MAX_LEVEL; level++) {
        points += Math.floor(level + 300 * Math.pow(2, level / 7));
        table[level + 1] = Math.floor(points / 4);
    }
    return table;
})();

// Percent progress from the current level toward the next, for a given xp value.
// Returns 100 at max level. Clamped to [0, 100].
function progressToNextLevel(level, xp) {
    if (level >= MAX_LEVEL) return 100;
    const startXp = XP_TABLE[level];
    const nextXp = XP_TABLE[level + 1];
    if (!(nextXp > startXp)) return 0;
    const percent = ((xp - startXp) / (nextXp - startXp)) * 100;
    return Math.max(0, Math.min(100, percent));
}

class LostKitLite {
    constructor() {
        this.externalWindows = true;
        this.ircWindowId = null;
        this.windowSettings = {};
        this.currentView = 'tools'; // 'tools', 'worlds' or 'hiscores'
        this.worldsData = [];
        this.currentWorldUrl = '';
        this.isHighDetail = true;
        this.lastPlayer = '';

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
                this.lastPlayer = settings.lastPlayer || '';
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
        this.lastPlayer = '';
    }

    async saveSettings() {
        const settings = {
            externalWindows: this.externalWindows,
            windowSettings: this.windowSettings,
            ircWindowId: this.ircWindowId,
            isHighDetail: this.isHighDetail,
            lastPlayer: this.lastPlayer
        };
        
        try {
            await chrome.storage.local.set({ 'lostkit-settings': JSON.stringify(settings) });
        } catch (error) {
            console.error('Error saving settings:', error);
        }
    }

    // Find the active Lost City game tab. In a docked side panel (Chrome) the
    // active tab of the current window is the game tab. In the Opera popup-window
    // fallback it is not, so search all windows for a Lost City tab as a fallback.
    async getActiveGameTab() {
        try {
            const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (active && active.url && active.url.includes('lostcity.rs')) {
                return active;
            }
        } catch (error) {
            // ignore and fall through to the cross-window lookup
        }

        try {
            const matches = await chrome.tabs.query({ url: '*://*.lostcity.rs/*' });
            if (matches && matches.length) {
                return matches.find(tab => tab.active) || matches[0];
            }
        } catch (error) {
            console.error('Error querying game tabs:', error);
        }

        return null;
    }

    async detectCurrentWorld() {
        try {
            const tab = await this.getActiveGameTab();
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

        // Highscores button
        document.getElementById('hiscoresBtn').addEventListener('click', () => {
            this.showHiscores();
        });

        // Back to tools button (in highscores view)
        document.getElementById('backFromHiscoresBtn').addEventListener('click', () => {
            this.showToolsPanel();
        });

        // Lookup button + Enter key in player name input
        document.getElementById('lookupBtn').addEventListener('click', () => {
            this.lookupPlayer();
        });
        document.getElementById('playerName').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.lookupPlayer();
            }
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
        document.getElementById('hiscoresPanel').style.display = 'none';
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
        document.getElementById('hiscoresPanel').style.display = 'none';
        document.getElementById('toolsPanel').style.display = 'flex';
    }

    showHiscores() {
        this.currentView = 'hiscores';
        document.getElementById('toolsPanel').style.display = 'none';
        document.getElementById('worldsPanel').style.display = 'none';
        document.getElementById('hiscoresPanel').style.display = 'flex';

        // Prefill and focus the input, restoring the last looked-up name.
        const input = document.getElementById('playerName');
        if (this.lastPlayer && !input.value) {
            input.value = this.lastPlayer;
        }
        input.focus();
    }

    async lookupPlayer() {
        const input = document.getElementById('playerName');
        const playerName = input.value.trim();

        const loading = document.getElementById('hiscoresLoading');
        const error = document.getElementById('hiscoresError');
        const statsGrid = document.getElementById('statsGrid');

        if (!playerName) {
            return;
        }

        statsGrid.innerHTML = '';
        error.style.display = 'none';
        loading.style.display = 'block';

        try {
            const response = await fetch(
                `https://2004.lostcity.rs/api/hiscores/player/${encodeURIComponent(playerName)}`
            );

            if (!response.ok) {
                throw new Error('Player not found');
            }

            const data = await response.json();
            this.lastPlayer = playerName;
            this.saveSettings();
            this.displayPlayerStats(data);
        } catch (err) {
            console.error('Error fetching player data:', err);
            error.style.display = 'block';
        } finally {
            loading.style.display = 'none';
        }
    }

    displayPlayerStats(statsData) {
        const statsGrid = document.getElementById('statsGrid');
        statsGrid.innerHTML = '';

        // Index the returned stats by their type for quick lookup.
        const statsByType = {};
        statsData.forEach(stat => {
            statsByType[stat.type] = stat;
        });

        SKILL_ORDER.forEach(skillType => {
            const stat = statsByType[skillType];
            const skill = SKILL_MAP[skillType];
            if (!stat || !skill) return;

            const level = stat.level;
            const xp = Math.floor(stat.value / 10);
            const isOverall = skillType === 0;

            const row = document.createElement('div');
            row.className = 'stat-row';

            // Only individual skills get a progress bar; Overall has no "next level".
            let progressHtml = '';
            if (!isOverall) {
                const percent = progressToNextLevel(level, xp);
                const label = level >= MAX_LEVEL
                    ? 'Max level'
                    : `${percent.toFixed(1)}% to ${level + 1}`;
                progressHtml = `
                    <div class="progress-track">
                        <div class="progress-fill" style="width: ${percent}%"></div>
                    </div>
                    <div class="progress-label">${label}</div>
                `;
            }

            row.innerHTML = `
                <img src="skillicons/${skill.icon}" alt="${skill.name}" class="stat-icon">
                <div class="stat-info">
                    <div class="stat-top">
                        <span class="stat-name">${skill.name}</span>
                        <span class="stat-level">Lv ${level.toLocaleString()}</span>
                    </div>
                    <div class="stat-sub">
                        <span class="stat-xp">${xp.toLocaleString()} xp</span>
                        <span class="stat-rank">Rank ${stat.rank.toLocaleString()}</span>
                    </div>
                    ${progressHtml}
                </div>
            `;

            statsGrid.appendChild(row);
        });
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
            const tab = await this.getActiveGameTab();

            // Check if we found a game world tab to update
            const isGameWorld = tab && tab.url && tab.url.includes('2004.lostcity.rs');

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

                // Persist size/position where the onBoundsChanged event is available.
                if (chrome.windows.onBoundsChanged) {
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
                }

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

                // Persist size/position where the onBoundsChanged event is available.
                if (chrome.windows.onBoundsChanged) {
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
                }

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