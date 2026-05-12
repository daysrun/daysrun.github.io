// TrackManager module: manages track metadata and per-track point listeners.
//
// Behavior notes:
// - The TrackManager polls `update.json` and `[year].json` to detect changes.
// - When `[year].json` changes, TrackManager groups the tracks into sections
//   (by year derived from the first 4 characters of the track id) and notifies
//   registered tracks listeners once per section with the signature
//   `(sectionId, tracksArray)`.
// - Per-track listeners registered via registerListener(trackId, listener)
//   receive the full points array on registration and incremental point arrays
//   (deltas) when new points are appended.
import BoatManager from './boatManager.js';

export default class TrackManager {
    constructor(baseUrl, pollInterval, logger) {
        // Map: sectionId (e.g., year) -> Array<track metadata>
        this.tracks = new Map();
        // Map: trackId -> { points: Array, listeners: Set<Function> }
        this.trackData = new Map();
        // timer for polling [year].json files
        this.tracksPollTimer = null;
        // listeners for full tracks list changes
        this.tracksListeners = new Set();
        // listeners for live track changes
        this.liveTrackListeners = new Set();
        // base URL provided by main.js
        this.baseUrl = baseUrl?.replace(/\/$/, '') || '';
        this.pollInterval = pollInterval;
        this.logger = logger;
        this.lastTracksUpdate = new Date(0);
        this.liveTrackId = null;
        // Cache of sectionId -> tracks array (for yearly files)
        this.sectionTracks = new Map();
        // Per-section (year) last-edited timestamps cache
        this.sectionTimestamps = new Map();
        // Boat manager instance
        this.boatManager = new BoatManager(baseUrl, logger);
    }

    /**
     * Load boats from boats.ndjson and initialize selection
     */
    async loadBoats() {
        return this.boatManager.loadBoats();
    }

    /**
     * Get all available boats
     */
    getAllBoats() {
        return this.boatManager.getAllBoats();
    }

    /**
     * Get currently selected boats
     */
    getSelectedBoats() {
        return this.boatManager.getSelectedBoats();
    }

    /**
     * Set boat selection
     */
    setBoatSelection(selectedBoats) {
        this.boatManager.setBoatSelection(selectedBoats);
        // Re-filter all existing tracks
        this._refilterAllTracks();
    }

    /**
     * Register a listener for boats changes
     * @param {Function} listener - Function(boatsArray: Array) called when boats list changes
     * @returns {Function} Unregister function
     */
    registerBoatsListener(listener) {
        return this.boatManager.registerBoatsListener(listener);
    }

    /**
     * Filter tracks based on selected boats
     */
    _filterTracksByBoats(tracks) {
        return this.boatManager.filterTracksByBoats(tracks, this.liveTrackId);
    }

    /**
     * Re-filter all cached tracks and notify listeners
     */
    _refilterAllTracks() {
        for (const [sectionId, jsonStr] of this.sectionTracks.entries()) {
            try {
                const allTracks = JSON.parse(jsonStr);
                const filteredTracks = this._filterTracksByBoats(allTracks);
                this.tracks.set(sectionId, filteredTracks);
                this._safeNotify(this.tracksListeners, 'tracks refilter', sectionId, filteredTracks);
            } catch (e) {
                this.logger.error(`Failed to refilter tracks for section ${sectionId}:`, e);
            }
        }
    }

    /**
     * Check if there is currently a live track
     * @returns {boolean}
     */
    hasLiveTrack() {
        return this.liveTrackId !== null;
    }

    /**
     * Get the current live track ID
     * @returns {string|null}
     */
    getLiveTrackId() {
        return this.liveTrackId;
    }

    /**
     * Clean up resources
     */
    destroy() {
        this.trackData.clear();
        if (this.tracksPollTimer) {
            clearInterval(this.tracksPollTimer);
            this.tracksPollTimer = null;
        }
        // Unregister all listeners
        this.tracksListeners.clear();
        this.liveTrackListeners.clear();
        // Clean up boat manager
        if (this.boatManager) {
            this.boatManager.destroy();
        }
    }

    /**
     * Register a listener for a track's points.
     * Listener is invoked with the full points array on register and when the count increases.
     * When the last listener is removed, cached points are cleared.
     * @param {string} trackId
     * @param {(points: Array) => void} listener
     * @returns {Function} unregister function
     */
    async registerListener(trackId, listener) {
        let data = this.trackData.get(trackId);
        if (!data) {
            data = { points: [], listeners: new Set() };
            this.trackData.set(trackId, data);
        }
        data.listeners.add(listener);

        if (data.points.length > 0) {
            try { listener(data.points); } catch (e) { this.logger.error('Listener error:', e); }
        } else {
            try {
                const points = await this._fetchNdjsonOrJson(trackId, 'points');
                data.points = points;
                try { listener(points); } catch (e) { this.logger.error('Listener error:', e); }
            } catch (e) {
                this.logger.error(`Failed to fetch initial points for ${trackId}:`, e);
            }
        }

        return () => {
            const d = this.trackData.get(trackId);
            if (!d) return;
            d.listeners.delete(listener);
            if (d.listeners.size === 0) {
                this.trackData.delete(trackId);
                this.logger.debug(`No listeners remain for ${trackId}; cache cleared.`);
            }
        };
    }

    /**
     * Get metadata for a section's tracks
     * @param {string} sectionId - section id (e.g., year like "2025"). If omitted, returns empty array.
     * @returns {Array} Array of track metadata objects for the section
     */
    getTracks(sectionId) {
        if (!sectionId) return [];
        if (this.tracks instanceof Map) {
            const list = this.tracks.get(String(sectionId));
            return Array.isArray(list) ? list : [];
        }
        // Fallback for older shape where this.tracks might be an array: filter by derived year
        if (Array.isArray(this.tracks)) {
            return this.tracks.filter(t => (typeof t.id === 'string' && t.id.slice(0,4) === String(sectionId)));
        }
        return [];
    }

    /**
     * Register a listener for changes to the tracks index.
     * Listeners will be invoked once per section with the signature: (sectionId, tracksArray).
     * The TrackManager groups the full tracks index into sections (by year derived from track id)
     * and notifies listeners for each section when [year].json changes. On registration the
     * listener is immediately invoked for existing sections.
     * @param {Function} listener - Function(sectionId: string, tracksArray: Array)
     * @returns {Function} Unregister function
     */
    registerTracksListener(listener) {
        // Add to set and immediately invoke listener for cached yearly sections
        this.tracksListeners.add(listener);
        try {
            for (const [sectionId, jsonStr] of this.sectionTracks.entries()) {
                try {
                    const rawTracks = jsonStr ? JSON.parse(jsonStr) : null;
                    const tracks = rawTracks ? this._filterTracksByBoats(rawTracks) : null;
                    console.log(`Immediate tracks listener call for section ${sectionId}:`, tracks);
                    if (tracks && tracks.length > 0) listener(sectionId, tracks);
                } catch (e) {
                    this.logger.error('tracks listener immediate call failed for section ' + sectionId, e);
                }
            }
        } catch (e) {
            this.logger.error('tracks listener immediate grouping failed', e);
        }
        return () => { this.tracksListeners.delete(listener); };
    }

    /**
     * Check if there is currently a live track
     * @returns {boolean}
     */
    hasLiveTrack() {
        return this.liveTrackId !== null;
    }

    /**
     * Get the current live track ID
     * @returns {string|null}
     */
    getLiveTrackId() {
        return this.liveTrackId;
    }

    /**
     * Register a listener for live track changes
     * @param {Function} listener - Function(liveTrackId: string|null) called when live track changes
     * @returns {Function} Unregister function
     */
    registerLiveTrackListener(listener) {
        this.liveTrackListeners.add(listener);
        // Immediately call with current live track
        try {
            listener(this.liveTrackId);
        } catch (e) {
            this.logger.error('live track listener immediate call failed', e);
        }
        return () => { this.liveTrackListeners.delete(listener); };
    }

    /**
     * Register a listener for boats changes
     * @param {Function} listener - Function(boatsArray: Array) called when boats list changes
     * @returns {Function} Unregister function
     */
    registerBoatsListener(listener) {
        return this.boatManager.registerBoatsListener(listener);
    }

    /**
     * Start polling update.json and [year].json to detect when new tracks are added
     * and when track point counts increase for tracks with listeners.
     */
    async startPollingTracks() {
        // Load boats first
        await this.loadBoats();

        if (this.tracksPollTimer) {
            clearInterval(this.tracksPollTimer);
            this.tracksPollTimer = null;
        }
        const poll = async () => {
            this.logger.debug(`Polling update.json for latest track index timestamps...`);
            try {
                // Fetch update.json to check for tracks.json and live track updates
                const updateData = await this._fetchJson('update.json');

                // Check for per-section entries listed in update.json. The update.json file
                // contains section ids (years like "2025") with an { edited: ISO } field
                // for each yearly tracks file that is available. Iterate the year keys found
                // in update.json and fetch the yearly file if its edited timestamp is newer
                // than our cache. Also remove any cached sections that are no longer present
                // in update.json.
                const updateKeys = Object.keys(updateData).filter(k => /^\d{4}$/.test(k)).sort();
                const seenUpdateKeys = new Set(updateKeys);

                // Process each key found in update.json
                for (const yearKey of updateKeys) {
                    const yearMeta = updateData[yearKey];
                    const editedIso = yearMeta?.edited;
                    let editedTs = null;
                    if (editedIso) {
                        try { editedTs = new Date(editedIso); } catch (e) { editedTs = null; }
                    }

                    const prevTs = this.sectionTimestamps.get(yearKey) || new Date(0);

                    if (editedTs && editedTs > prevTs) {
                        // Yearly file updated — fetch it
                        try {
                            const tracksForYear = await this._fetchNdjsonOrJson(yearKey, 'tracks');
                            tracksForYear.sort((a, b) => (a.id < b.id ? 1 : -1));
                            if (tracksForYear.length > 0) {
                                const filteredTracks = this._filterTracksByBoats(tracksForYear);
                                const nextJson = JSON.stringify(tracksForYear);
                                const prevJson = this.sectionTracks.get(yearKey);
                                if (!prevJson || prevJson !== nextJson) {
                                    this.sectionTracks.set(yearKey, nextJson);
                                    this._safeNotify(this.tracksListeners, 'tracks', yearKey, filteredTracks);
                                }
                                // Update timestamp cache
                                this.sectionTimestamps.set(yearKey, editedTs);
                                // Ensure the per-section tracks Map is updated
                                this.tracks.set(yearKey, filteredTracks);
                                // continue to next key
                                continue;
                            }
                            // File fetched but contains no tracks — remove section if present
                            if (this.sectionTracks.has(yearKey)) {
                                this.sectionTracks.delete(yearKey);
                                this.sectionTimestamps.delete(yearKey);
                                this._safeNotify(this.tracksListeners, 'tracks', yearKey, null);
                                // Remove from per-section tracks Map
                                this.tracks.delete(yearKey);
                            }
                        } catch (e) {
                            // Fetch failure — remove existing section if any
                            if (this.sectionTracks.has(yearKey)) {
                                this.sectionTracks.delete(yearKey);
                                this.sectionTimestamps.delete(yearKey);
                                this._safeNotify(this.tracksListeners, 'tracks', yearKey, null);
                                // Remove from per-section tracks Map
                                this.tracks.delete(yearKey);
                            }
                        }
                    } else if (!editedTs) {
                        // No edited timestamp for this key — treat as removal
                        if (this.sectionTracks.has(yearKey)) {
                            this.sectionTracks.delete(yearKey);
                            this.sectionTimestamps.delete(yearKey);
                            this._safeNotify(this.tracksListeners, 'tracks', yearKey, null);
                            // Remove from per-section tracks Map
                            this.tracks.delete(yearKey);
                        }
                    } else {
                        // Key exists in update.json but timestamp not newer than cached; ensure cached section is loaded
                        const prevJson = this.sectionTracks.get(yearKey);
                        if (prevJson) {
                            try {
                                const allTracks = JSON.parse(prevJson);
                                const filteredTracks = this._filterTracksByBoats(allTracks);
                                // Ensure per-section tracks Map contains the filtered cached list
                                this.tracks.set(yearKey, filteredTracks);
                            } catch (e) {
                                // ignore parse errors here
                            }
                        }
                    }
                }

                // Remove any previously-cached sections that are no longer present in update.json
                for (const existingKey of Array.from(this.sectionTracks.keys())) {
                    if (!seenUpdateKeys.has(existingKey)) {
                        this.sectionTracks.delete(existingKey);
                        this.sectionTimestamps.delete(existingKey);
                        this.tracks.delete(existingKey);
                        this._safeNotify(this.tracksListeners, 'tracks', existingKey, null);
                    }
                }

                // Check for boats updates
                await this.boatManager.checkForBoatsUpdates(updateData);

                // Check for live track updates (if applicable)
                const liveTrackId = updateData.live?.id || null;
                if (liveTrackId !== this.liveTrackId) {
                    // Track identity changed; update metadata and notify listeners
                    if (liveTrackId) {
                        this.logger.info(`Live track updated to ${liveTrackId}`);
                    } else {
                        this.logger.info(`Live track cleared`);
                    }
                    this.liveTrackId = liveTrackId;
                    this._safeNotify(this.liveTrackListeners, 'live track', this.liveTrackId);
                    // Re-filter tracks since live track should always be included
                    this._refilterAllTracks();
                }
                if (liveTrackId) {
                    const liveCount = updateData.live.pointCount || 0;
                    await this._refreshIfIncreased(liveTrackId, liveCount);
                }
            } catch (err) {
                this.logger.error('Error polling track indices:', err);
            }
        };
        // Initial poll immediately
        poll();
        // Schedule periodic polls
        this.tracksPollTimer = setInterval(poll, this.pollInterval);
    }

    /**
     * Internal helper to fetch data in NDJSON or JSON format.
     * Supports both standard JSON format (with optional property wrapper) and NDJSON format
     * (one JSON object per line with no property wrapper).
     * Tries to fetch .ndjson file first, falls back to .json if not found.
     * @param {string} filename - Base filename without extension (e.g., 'trackId' or '2025')
     * @param {string} jsonProperty - Property name to extract from JSON format (e.g., 'points' or 'tracks'), or null for no wrapper
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

    /**
     * Notify tracks list listeners and update internal list cache
     * @param {Array} nextTracks
     */
    _notifyTracksList(nextTracks) {
        // Group tracks into sections by year derived from track id and notify listeners per section
        const groups = new Map();
        for (const t of nextTracks) {
            const year = (typeof t.id === 'string' && t.id.length >= 4) ? t.id.slice(0, 4) : 'other';
            if (!groups.has(year)) groups.set(year, []);
            groups.get(year).push(t);
        }
        // Replace internal tracks Map with grouped sections
        this.tracks = groups;
        for (const [sectionId, list] of groups.entries()) {
            this._safeNotify(this.tracksListeners, 'tracks', sectionId, list);
        }
    }

    /**
     * Refresh a specific track if the reported newCount exceeds cached length.
     * Notifies that track's listeners with only the delta points.
     * @param {string} trackId
     * @param {number} newCount
     */
    async _refreshIfIncreased(trackId, newCount) {
        const d = this.trackData.get(trackId);
        if (!d || !d.listeners || d.listeners.size === 0) return;
        const oldCount = d.points?.length || 0;
        if (newCount <= oldCount) return;
        try {
            const points = await this._fetchNdjsonOrJson(trackId, 'points');
            const newPoints = points.slice(oldCount);
            d.points = points;
            if (newPoints.length > 0) this._safeNotify(d.listeners, `track ${trackId}`, newPoints);
        } catch (e) {
            this.logger.error(`Failed to refresh points for ${trackId}:`, e);
        }
    }

    /**
     * Safely notify a set of listeners with the provided args. Errors are logged and do not stop the loop.
     * Listeners may be called with multiple arguments depending on the event (for example
     * tracks listeners are called as `(sectionId, tracksArray)`).
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
     * Helper to register a simple listener set that should be invoked immediately with current value.
     * Returns an unregister function.
     * @param {Set<Function>} listenersSet
     * @param {Function} getCurrentValue - () => any
     * @param {string} label
     * @param {Function} listener
     */
    _registerAndCall(listenersSet, getCurrentValue, label, listener) {
        listenersSet.add(listener);
        try {
            listener(getCurrentValue());
        } catch (e) {
            this.logger.error(`${label} listener immediate call failed`, e);
        }
        return () => { listenersSet.delete(listener); };
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
}
