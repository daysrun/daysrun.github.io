// Settings: manages application settings with a popup modal

export default class Settings {
    constructor() {
        this.settings = this.loadSettings();
        this.overlay = null;
        this.modal = null;
        this.listeners = new Map(); // settingName -> Set of callbacks
    }

    /**
     * Load settings from localStorage or use defaults
     * @returns {Object} Settings object
     */
    loadSettings() {
        const defaultSettings = {
            speedUnit: 'knots',
            distanceUnit: 'nm',
            depthUnit: 'feet',
            theme: 'light',
            autoActivateLatestTrack: true,
            mapType: 'terrain'
        };

        try {
            const stored = localStorage.getItem('daysrun-settings');
            if (stored) {
                const parsed = JSON.parse(stored);
                return { ...defaultSettings, ...parsed };
            }
        } catch (err) {
            console.warn('Failed to load settings from localStorage:', err);
        }

        return defaultSettings;
    }

    /**
     * Save settings to localStorage
     */
    saveSettings() {
        try {
            localStorage.setItem('daysrun-settings', JSON.stringify(this.settings));
        } catch (err) {
            console.error('Failed to save settings to localStorage:', err);
        }
    }

    /**
     * Get a specific setting value
     * @param {string} name - Setting name
     * @returns {*} Setting value
     */
    get(name) {
        return this.settings[name];
    }

    /**
     * Set a specific setting value and notify listeners
     * @param {string} name - Setting name
     * @param {*} value - Setting value
     */
    set(name, value) {
        if (this.settings[name] === value) return;
        this.settings[name] = value;
        this.saveSettings();
        this.notifyListeners(name, value);
        this.applySettings();
    }

    /**
     * Register a listener for setting changes
     * @param {string} settingName - Name of setting to listen for
     * @param {Function} callback - Callback function (value) => {}
     */
    addListener(settingName, callback) {
        if (!this.listeners.has(settingName)) {
            this.listeners.set(settingName, new Set());
        }
        this.listeners.get(settingName).add(callback);
    }

    /**
     * Remove a listener
     * @param {string} settingName
     * @param {Function} callback
     */
    removeListener(settingName, callback) {
        if (this.listeners.has(settingName)) {
            this.listeners.get(settingName).delete(callback);
        }
    }

    /**
     * Notify all listeners for a specific setting
     * @param {string} settingName
     * @param {*} value
     */
    notifyListeners(settingName, value) {
        if (this.listeners.has(settingName)) {
            this.listeners.get(settingName).forEach(callback => {
                try {
                    callback(value);
                } catch (err) {
                    console.error(`Error in settings listener for ${settingName}:`, err);
                }
            });
        }
    }

    /**
     * Apply current settings to the application
     */
    applySettings() {
        // Apply theme
        const theme = this.settings.theme;
        if (theme === 'dark') {
            document.body.classList.add('dark-theme');
        } else {
            document.body.classList.remove('dark-theme');
        }
    }
}
