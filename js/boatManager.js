// BoatManager module: manages boat metadata and selection state.
//
// Behavior notes:
// - BoatManager loads boats from boats.ndjson and maintains selection state.
// - Selection is persisted in cookies and defaults to all boats selected.
// - BoatManager polls update.json to detect when boats.ndjson has been updated.
// - When boats are updated, listeners are notified with the new boat list.
export default class BoatManager {
    constructor(baseUrl, logger) {
        // base URL provided by TrackManager
        this.baseUrl = baseUrl?.replace(/\/$/, '') || '';
        this.logger = logger;
        // Boat selection state
        this.selectedBoats = new Set();
        this.allBoats = new Set();
        this.boatsLoaded = false;
        // Boats last-edited timestamp cache
        this.boatsTimestamp = new Date(0);
        // listeners for boats changes
        this.boatsListeners = new Set();
    }

    /**
     * Clean up resources
     */
    destroy() {
        // Unregister all listeners
        this.boatsListeners.clear();
    }

    /**
     * Load boats from boats.ndjson and initialize selection
     */
    async loadBoats() {
        if (this.boatsLoaded) return;

        try {
            const boats = await this._fetchNdjsonOrJson('boats', null);
            this.allBoats = new Set(boats.map(boat => boat.name));
            // Load selection from cookie, default to all selected
            this.selectedBoats = this.loadBoatSelectionFromCookie();
            if (this.selectedBoats.size === 0) {
                this.selectedBoats = new Set(this.allBoats);
                this.saveBoatSelectionToCookie();
            }
            this.boatsLoaded = true;
            this.logger.debug('Boats loaded:', Array.from(this.allBoats));
        } catch (e) {
            this.logger.error('Failed to load boats:', e);
            // Fallback: assume no boat filtering
            this.allBoats = new Set();
            this.selectedBoats = new Set();
            this.boatsLoaded = true;
        }
    }

    /**
     * Get all available boats
     */
    getAllBoats() {
        return Array.from(this.allBoats).sort();
    }

    /**
     * Get currently selected boats
     */
    getSelectedBoats() {
        return Array.from(this.selectedBoats);
    }

    /**
     * Set boat selection
     */
    setBoatSelection(selectedBoats) {
        this.selectedBoats = new Set(selectedBoats);
        this.saveBoatSelectionToCookie();
    }

    /**
     * Load boat selection from cookie
     */
    loadBoatSelectionFromCookie() {
        try {
            const cookieValue = document.cookie
                .split('; ')
                .find(row => row.startsWith('selectedBoats='));
            if (cookieValue) {
                const selected = JSON.parse(decodeURIComponent(cookieValue.split('=')[1]));
                return new Set(selected);
            }
        } catch (e) {
            this.logger.error('Failed to load boat selection from cookie:', e);
        }
        return new Set();
    }

    /**
     * Save boat selection to cookie
     */
    saveBoatSelectionToCookie() {
        try {
            const selectedArray = Array.from(this.selectedBoats);
            document.cookie = `selectedBoats=${encodeURIComponent(JSON.stringify(selectedArray))}; path=/; max-age=31536000`; // 1 year
        } catch (e) {
            this.logger.error('Failed to save boat selection to cookie:', e);
        }
    }

    /**
     * Filter tracks based on selected boats
     * @param {Array} tracks - Array of track objects
     * @param {string|null} liveTrackId - Current live track ID to always include
     */
    filterTracksByBoats(tracks, liveTrackId = null) {
        if (this.allBoats.size === 0) {
            return tracks; // No filtering if no boats loaded
        }
        return tracks.filter(track =>
            // Always include the live track, regardless of boat selection
            track.id === liveTrackId || (track.boatName && this.selectedBoats.has(track.boatName))
        );
    }

    /**
     * Register a listener for boats changes
     * @param {Function} listener - Function(boatsArray: Array) called when boats list changes
     * @returns {Function} Unregister function
     */
    registerBoatsListener(listener) {
        this.boatsListeners.add(listener);
        // Immediately call with current boats
        try {
            listener(Array.from(this.allBoats));
        } catch (e) {
            this.logger.error('boats listener immediate call failed', e);
        }
        return () => { this.boatsListeners.delete(listener); };
    }

    /**
     * Check for boats updates from update.json
     * @param {Object} updateData - The update.json data
     */
    async checkForBoatsUpdates(updateData) {
        if (!updateData.boats) return;

        const boatsEditedIso = updateData.boats.edited;
        let boatsEditedTs = null;
        if (boatsEditedIso) {
            try { boatsEditedTs = new Date(boatsEditedIso); } catch (e) { boatsEditedTs = null; }
        }

        if (boatsEditedTs && boatsEditedTs > this.boatsTimestamp) {
            // Boats file updated — reload it
            try {
                const boats = await this._fetchNdjsonOrJson('boats', null);
                const newBoatsSet = new Set(boats.map(boat => boat.name));

                // Check if boats list has changed
                const boatsChanged = !this._setsEqual(this.allBoats, newBoatsSet);

                if (boatsChanged) {
                    this.allBoats = newBoatsSet;
                    // Update selected boats to include any new boats
                    const updatedSelectedBoats = new Set(this.selectedBoats);
                    for (const boatName of this.allBoats) {
                        if (!this.selectedBoats.has(boatName)) {
                            updatedSelectedBoats.add(boatName);
                        }
                    }
                    this.selectedBoats = updatedSelectedBoats;
                    this.saveBoatSelectionToCookie();

                    // Notify that boats have changed
                    this._safeNotify(this.boatsListeners, 'boats', Array.from(this.allBoats));

                    this.logger.info('Boats list updated');
                }

                // Update timestamp cache
                this.boatsTimestamp = boatsEditedTs;
            } catch (e) {
                this.logger.error('Failed to reload boats:', e);
            }
        }
    }

    /**
     * Helper method to check if two sets are equal
     * @param {Set} setA
     * @param {Set} setB
     * @returns {boolean}
     */
    _setsEqual(setA, setB) {
        if (setA.size !== setB.size) return false;
        for (const item of setA) {
            if (!setB.has(item)) return false;
        }
        return true;
    }

    /**
     * Safely notify a set of listeners with the provided args. Errors are logged and do not stop the loop.
     * @param {Set<Function>} listeners
     * @param {string} label - descriptive label for error logging context
     * @param {...*} args - arguments to pass to each listener
     */
    _safeNotify(listeners, label, ...args) {
        if (!listeners || listeners.size === 0) return;
        listeners.forEach(fn => {
            try {
                fn(...args);
            } catch (e) {
                this.logger.error(`Error in ${label} listener:`, e);
            }
        });
    }

    /**
     * Fetch and parse JSON from a relative path under baseUrl
     * @param {string} relativePath
     */
    async _fetchJson(relativePath) {
        // Add timestamp to prevent caching
        const cacheBuster = `?_=${Date.now()}`;
        const response = await fetch(`${this.baseUrl}/${relativePath}${cacheBuster}`);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        return response.json();
    }

    /**
     * Internal helper to fetch data in NDJSON or JSON format.
     * Supports both standard JSON format (with optional property wrapper) and NDJSON format
     * (one JSON object per line with no property wrapper).
     * Tries to fetch .ndjson file first, falls back to .json if not found.
     * @param {string} filename - Base filename without extension (e.g., 'boats')
     * @param {string} jsonProperty - Property name to extract from JSON format, or null for no wrapper
     * @returns {Promise<Array>}
     */
    async _fetchNdjsonOrJson(filename, jsonProperty = null) {
        this.logger.debug(`Fetching ${filename}...`);
        // Add timestamp to prevent caching
        const cacheBuster = `?_=${Date.now()}`;

        // Try to fetch NDJSON format first
        try {
            const ndjsonResponse = await fetch(`${this.baseUrl}/${filename}.ndjson${cacheBuster}`);
            if (ndjsonResponse.ok) {
                const text = await ndjsonResponse.text();
                const lines = text.split('\n');
                const items = [];
                for (const line of lines) {
                    if (line.trim()) {
                        items.push(JSON.parse(line));
                    }
                }
                return items;
            } else {
                this.logger.debug(`NDJSON file not found (status: ${ndjsonResponse.status}), falling back to JSON`);
            }
        } catch (e) {
            this.logger.debug(`Failed to fetch NDJSON file: ${e.message}`);
        }

        // Fall back to standard JSON format
        const response = await fetch(`${this.baseUrl}/${filename}.json${cacheBuster}`);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const data = await response.json();
        return jsonProperty ? (data[jsonProperty] || []) : data;
    }
}