import UnitManager from './unitManager.js';
import RoutePlanner from './routePlanner.js';

// MapMenu: overlay control with two collapsible sections - Live Track and Log
export default class MapMenu {
    /**
     * @param {google.maps.Map} map
     * @param {Function} onChange - Callback (trackId, checked) when checkbox toggled
     * @param {Object} options - {hasLiveTrack: boolean, liveTrackId: string|null, settings: Settings, onUnitsChanged: Function, trackManager: TrackManager}
     */
    constructor(map, onChange = () => {}, options = {}) {
        this.map = map;
        this.onChange = onChange;
        this.onLiveTrackFollowChange = options.onLiveTrackFollowChange || (() => {});
        this.onUnitsChanged = options.onUnitsChanged || (() => {});
        this.settings = options.settings || null;
        this.trackManager = options.trackManager || null;
        this.container = document.createElement('div');
        this.container.className = 'map-menu-container';
        this.swatchColours = new Map();
        this.hasLiveTrack = options.hasLiveTrack || false;
        this.liveTrackId = options.liveTrackId || null;

        // Main header / hamburger button
        this.header = document.createElement('div');
        this.header.className = 'map-menu-header';
        this.hamburger = document.createElement('div');
        this.hamburger.className = 'map-menu-hamburger';
        this.hamburger.innerHTML = '&#9776;';
        this.header.appendChild(this.hamburger);
        this.container.appendChild(this.header);

        // Body containing both sections
        this.body = document.createElement('div');
        this.body.className = 'map-menu-body';
        this.container.appendChild(this.body);

        // Persistent footer area (always visible) to show selected distance
        this.footer = document.createElement('div');
        this.footer.className = 'map-menu-footer';
        const footerLabel = document.createElement('span');
        footerLabel.className = 'map-menu-footer-label';
        footerLabel.textContent = 'Selected distance:';
        this.selectedDistanceValue = document.createElement('span');
        this.selectedDistanceValue.className = 'map-menu-footer-value';
        this.selectedDistanceValue.textContent = '';
        this.footer.appendChild(footerLabel);
        this.footer.appendChild(this.selectedDistanceValue);
        this.container.appendChild(this.footer);

        // Live Track Section
        this.liveSection = this._createSection('Live Track', 'live-track');
        this.liveFollowCheckbox = document.createElement('input');
        this.liveFollowCheckbox.type = 'checkbox';
        this.liveFollowCheckbox.className = 'map-menu-checkbox';
        this.liveFollowLabel = document.createElement('label');
        this.liveFollowLabel.textContent = 'Follow live track';
        this.liveFollowLabel.className = 'map-menu-label';
        this.liveFollowLabel.addEventListener('click', () => this.liveFollowCheckbox.click());
        this.liveFollowCheckbox.addEventListener('change', (ev) => {
            try {
                this.onLiveTrackFollowChange(ev.target.checked);
            } catch (err) {
                console.error('Error in live track follow handler:', err);
            }
        });
        const liveRow = document.createElement('div');
        liveRow.className = 'map-menu-row';
        liveRow.appendChild(this.liveFollowCheckbox);
        liveRow.appendChild(this.liveFollowLabel);
        const liveContent = document.createElement('div');
        liveContent.className = 'map-menu-list';
        liveContent.appendChild(liveRow);
        this.liveSection.content.appendChild(liveContent);
        this.body.appendChild(this.liveSection.container);

        // Create Boats section
        this.boatsSection = this._createSection('Boat Filter', 'boats');
        this._populateBoatsSection();
        this.body.appendChild(this.boatsSection.container);

        // Sections map: sectionId -> { section, list, title }

        // Sections (including any 'Log'-like groups) must be added explicitly via addSection()
        this.sections = new Map();

        // Create Settings section (if settings instance provided)
        if (this.settings) {
            this.settingsSection = this._createSection('⚙ Settings', 'settings');
            this._populateSettingsSection();
            this.body.appendChild(this.settingsSection.container);
        }

        // Route Planning section (toggle)
        this.routePlanner = null;
        this.routeSection = this._createSection('Route Planning', 'route-planning');
        const rpRow = document.createElement('div');
        rpRow.className = 'map-menu-row';
        this.routeToggle = document.createElement('input');
        this.routeToggle.type = 'checkbox';
        this.routeToggle.className = 'map-menu-checkbox';
        this.routeToggle.id = 'menu-route-toggle';
        const rpLabel = document.createElement('label');
        rpLabel.textContent = 'Enable route planning';
        rpLabel.className = 'map-menu-label';
        rpLabel.addEventListener('click', () => this.routeToggle.click());
        this.routeToggle.addEventListener('change', (ev) => this._toggleRoutePlanning(ev.target.checked));
        rpRow.appendChild(this.routeToggle);
        rpRow.appendChild(rpLabel);
        const rpContent = document.createElement('div');
        rpContent.className = 'map-menu-list';
        rpContent.appendChild(rpRow);
        this.routeSection.content.appendChild(rpContent);
        this.body.appendChild(this.routeSection.container);

        // Toggle main body visibility when header clicked
        this.header.addEventListener('click', () => {
            this.container.classList.toggle('open');
        });

        // Insert into map controls
        this.map.controls[google.maps.ControlPosition.TOP_LEFT].push(this.container);

        // Map of trackId -> input element (a track appears in exactly one section)
        this.checkboxes = new Map();
        this._updateLiveTrackSection();

        // Register listeners for unit changes
        if (this.settings) {
            this.settings.addListener('speedUnit', () => this._handleUnitsChanged());
            this.settings.addListener('depthUnit', () => this._handleUnitsChanged());
            this.settings.addListener('distanceUnit', () => this._handleUnitsChanged());
        }

        // Register listener for boats changes
        if (this.trackManager) {
            this.trackManager.registerBoatsListener((boats) => {
                this._updateBoatsSection(boats);
            });
            // Register listener for tracks changes
            this.trackManager.registerTracksListener((sectionId, tracks) => {
                this.updateSection(sectionId, tracks);
            });
        }

        // Default: open menu on load
        this.container.classList.add('open');
    }

    /**
     * Create a collapsible section with header and content
     * @param {string} title
     * @param {string} id
     * @returns {Object} {container, header, content, isOpen}
     */
    _createSection(title, id) {
        const container = document.createElement('div');
        container.className = 'map-menu-section';
        container.dataset.sectionId = id;

        const header = document.createElement('div');
        header.className = 'map-menu-section-header';
        const arrow = document.createElement('span');
        arrow.className = 'map-menu-section-arrow';
        arrow.textContent = '▶';
        const titleEl = document.createElement('span');
        titleEl.textContent = title;
        header.appendChild(arrow);
        header.appendChild(titleEl);

        const content = document.createElement('div');
        content.className = 'map-menu-section-content';

        const section = {
            container,
            header,
            content,
            arrow,
            isOpen: false
        };

        header.addEventListener('click', () => this._toggleSection(section));

        container.appendChild(header);
        container.appendChild(content);

        return section;
    }

    /**
     * Toggle a section open/closed
     * @param {Object} section
     */
    _toggleSection(section) {
        section.isOpen = !section.isOpen;
        if (section.isOpen) {
            section.container.classList.add('open');
            section.arrow.textContent = '▼';
        } else {
            section.container.classList.remove('open');
            section.arrow.textContent = '▶';
        }
    }

    /**
     * Update the live track section state based on hasLiveTrack
     */
    _updateLiveTrackSection() {
        if (this.hasLiveTrack) {
            this.liveSection.container.classList.remove('disabled');
            // If live track exists, open live section and check "Follow live track"
            if (!this.liveSection.isOpen) {
                this._toggleSection(this.liveSection);
            }
            const wasChecked = this.liveFollowCheckbox.checked;
            this.liveFollowCheckbox.checked = true;
            // Trigger the callback if the state changed
            if (!wasChecked) {
                try {
                    this.onLiveTrackFollowChange(true);
                } catch (err) {
                    console.error('Error in live track follow handler:', err);
                }
            }
            // Close other sections when live track enabled
            for (const [sid, entry] of this.sections) {
                if (sid === 'live-track') continue;
                if (entry.section.isOpen) {
                    this._toggleSection(entry.section);
                }
            }
        } else {
            this.liveSection.container.classList.add('disabled');
            // Collapse live section when disabled
            if (this.liveSection.isOpen) {
                this._toggleSection(this.liveSection);
            }
            const wasChecked = this.liveFollowCheckbox.checked;
            this.liveFollowCheckbox.checked = false;
            // Trigger the callback if the state changed
            if (wasChecked) {
                try {
                    this.onLiveTrackFollowChange(false);
                } catch (err) {
                    console.error('Error in live track follow handler:', err);
                }
            }
            // Open all sections with checked tracks when live track disabled
            for (const [sid, entry] of this.sections) {
                const inputs = Array.from(entry.list.querySelectorAll('input[type="checkbox"]'));
                const anyChecked = inputs.some(input => input.checked);
                if (anyChecked && !entry.section.isOpen) {
                    this._toggleSection(entry.section);
                }
            }
        }
    }

    /**
     * Toggle Route Planning mode on/off
     * @param {boolean} enabled
     */
    _toggleRoutePlanning(enabled) {
        if (enabled) {
            if (this.routePlanner) return;
            try {
                this._lastRouteMeters = 0;
                this.routePlanner = new RoutePlanner(this.map, {
                    settings: this.settings,
                    onRouteChanged: (meters) => { this._lastRouteMeters = meters; }
                });

            } catch (err) {
                console.error('Failed to start RoutePlanner', err);
                this.routeToggle.checked = false;
            }
        } else {
            if (this.routePlanner) {
                try { this.routePlanner.destroy(); } catch (e) {}
                this.routePlanner = null;
            }
        }
    }

    /**
     * Set whether there is a live track
     * @param {boolean} hasLiveTrack
     * @param {string|null} liveTrackId
     */
    setLiveTrack(hasLiveTrack, liveTrackId = null) {
        this.hasLiveTrack = hasLiveTrack;
        this.liveTrackId = liveTrackId;
        this._updateLiveTrackSection();
    }

    /**
     * Internal helper to create and append a track row into a list container.
     * Ensures the checkbox is registered in this.checkboxes (Set per track id).
     * @param {Element} listContainer
     * @param {Object} track
     * @param {Set} previouslySelected
     */
    _addTrackRow(listContainer, track) {
        if (track.pointCount === 0) return; // skip empty tracks
        const row = document.createElement('div');
        row.className = 'map-menu-row';

        const input = document.createElement('input');
        input.type = 'checkbox';
        input.dataset.trackId = track.id;
        input.dataset.trackDistance = track.Distance || 0; // Store distance for later updates
        input.className = 'map-menu-checkbox';

        const label = document.createElement('label');
        const targetUnit = this.settings ? this.settings.get('distanceUnit') : 'nm';
        const distance = UnitManager.convertValue('Distance', track.Distance || 0, targetUnit);
        label.textContent = `${MapMenu.beautifyTrackId(track.id)} (${distance.value} ${distance.unit})`;
        label.className = 'map-menu-label';

        input.addEventListener('change', (ev) => {
            const checked = ev.target.checked;
            const trackId = ev.target.dataset.trackId;
            try {
                this.onChange(trackId, checked);
            } catch (err) {
                console.error('Error in MapMenu onChange handler:', err);
            }
        });

        // clicking label toggles checkbox
        label.addEventListener('click', () => input.click());

        row.appendChild(input);
        row.appendChild(label);
        listContainer.appendChild(row);

        // store input in map (single input per track id)
        this.checkboxes.set(track.id, input);

        // If we already have a swatch colour for this track, apply it now
        const colour = this.swatchColours.get(track.id);
        if (colour) {
            input.checked = true;
            try { this.setTrackSwatch(track.id, colour); } catch (e) { /* ignore */ }
        }
    }

    /**
     * Set or update the colour swatch for a given track row
     * @param {string} trackId
     * @param {string} colour - CSS colour string (e.g., '#ff9000' or 'rgb(...)')
     */
    setTrackSwatch(trackId, colour) {
        this.swatchColours.set(trackId, colour);
        // Try to find the row label for this track
        const input = this.checkboxes.get(trackId);
        if (input && input.parentElement) {
            const row = input.parentElement;
            const label = row.querySelector('.map-menu-label');
            if (label) {
                let swatch = label.querySelector('.map-menu-swatch');
                if (!swatch) {
                    swatch = document.createElement('span');
                    swatch.className = 'map-menu-swatch';
                    label.appendChild(swatch);
                }
                swatch.style.backgroundColor = colour;
                swatch.title = `Colour: ${colour}`;
                return;
            }
        }
        // Fallback: if this is the current live track, use the live track label
        if (this.liveTrackId && trackId === this.liveTrackId) {
            let swatch = this.liveFollowLabel.querySelector('.map-menu-swatch');
            if (!swatch) {
                swatch = document.createElement('span');
                swatch.className = 'map-menu-swatch';
                this.liveFollowLabel.appendChild(swatch);
            }
            swatch.style.backgroundColor = colour;
            swatch.title = `Colour: ${colour}`;
        }
    }

    /**
     * Remove the colour swatch for a given track and clear its stored colour
     * @param {string} trackId
     */
    removeTrackSwatch(trackId) {
        // Clear stored swatch colour so it won't be reapplied
        this.swatchColours.delete(trackId);
        // Remove swatch from the track's row (if present)
        const input = this.checkboxes.get(trackId);
        if (input && input.parentElement) {
            const row = input.parentElement;
            const label = row.querySelector('.map-menu-label');
            if (label) {
                const swatch = label.querySelector('.map-menu-swatch');
                if (swatch && swatch.parentElement === label) label.removeChild(swatch);
            }
        }
        // Also remove from live follow label if present
        if (this.liveTrackId && trackId === this.liveTrackId) {
            const swatch = this.liveFollowLabel.querySelector('.map-menu-swatch');
            if (swatch && swatch.parentElement === this.liveFollowLabel) this.liveFollowLabel.removeChild(swatch);
        }
    }

    /**
     * Programmatically set checkbox state for a track
     * @param {string} trackId
     * @param {boolean} checked
     */
    setChecked(trackId, checked) {
        const input = this.checkboxes.get(trackId);
        if (!input) return;
        input.checked = !!checked;
    }

    /**
     * Sets the content for the selected distance footer value.
     * If passed a number, it will be treated as meters and formatted via UnitManager.
     * Otherwise the value is coerced to string and displayed as-is.
     * @param {number|string|null} value
     */
    setSelectedDistance(value) {
        if (!this.selectedDistanceValue) return;
        if (value === null || value === undefined || value === '') {
            this.selectedDistanceValue.textContent = '';
            return;
        }
        if (typeof value === 'number' && isFinite(value)) {
            // Assume meters input
            const targetUnit = this.settings ? this.settings.get('distanceUnit') : 'nm';
            const converted = UnitManager.convertValue('Distance', value, targetUnit);
            this.selectedDistanceValue.textContent = `${converted.value} ${converted.unit}`;
        } else {
            this.selectedDistanceValue.textContent = `${value}`;
        }
    }

    /**
     * Handle unit changes by updating track distances and reloading active tracks
     */
    _handleUnitsChanged() {
        // Update all track distances in the menu labels
        this.checkboxes.forEach((input, trackId) => {
            const label = input.parentElement?.querySelector('.map-menu-label');
            const distanceMeters = parseFloat(input.dataset.trackDistance) || 0;
            if (label && distanceMeters && this.settings) {
                const targetUnit = this.settings.get('distanceUnit');
                const distance = UnitManager.convertValue('Distance', distanceMeters, targetUnit);
                // Preserve the swatch if present
                const swatch = label.querySelector('.map-menu-swatch');
                const beautifiedId = MapMenu.beautifyTrackId(trackId);
                label.textContent = `${beautifiedId} (${distance.value} ${distance.unit})`;
                // Re-append swatch if it existed
                if (swatch) {
                    label.appendChild(swatch);
                }
            }
        });

        // Update section title with total distance if it's a Log section (identified by sectionId not being
        // 'live-track' or 'boats' or 'settings')
        this.sections.forEach((entry, sectionId) => {
            if (['live-track', 'boats', 'settings'].includes(sectionId)) return;
            const { section, list, title } = entry;
            // Sum distances of all tracks in this section
            let totalDistanceMeters = 0;
            const inputs = list.querySelectorAll('input[data-track-distance]');
            inputs.forEach(input => {
                const dist = parseFloat(input.dataset.trackDistance);
                if (!isNaN(dist)) totalDistanceMeters += dist;
            });
            const targetUnit = this.settings ? this.settings.get('distanceUnit') : 'nm';
            const totalDistance = UnitManager.convertValue('Distance', totalDistanceMeters, targetUnit);
            const newTitle = `${title} \u2014 ${totalDistance.value} ${totalDistance.unit}`;
            section.header.querySelector('span:last-child').textContent = newTitle;
        });

        // Refresh route planner display (marker titles) if active
        if (this.routePlanner && typeof this.routePlanner.refreshDisplay === 'function') {
            try { this.routePlanner.refreshDisplay(); } catch (e) { /* ignore */ }
        }

        // Notify main.js to reload all active tracks so markers show correct units
        try {
            this.onUnitsChanged();
        } catch (err) {
            console.error('Error in onUnitsChanged handler:', err);
        }
    }

    /**
     * Clean up and remove the menu from the map
     */
    destroy() {
        try {
            // Remove from map controls
            const controls = this.map.controls[google.maps.ControlPosition.TOP_LEFT];
            for (let i = 0; i < controls.getLength(); i++) {
                if (controls.getAt(i) === this.container) {
                    controls.removeAt(i);
                    break;
                }
            }
            // Unregister settings listeners
            if (this.settings) {
                this.settings.removeListener('speedUnit', () => this._handleUnitsChanged());
                this.settings.removeListener('depthUnit', () => this._handleUnitsChanged());
                this.settings.removeListener('distanceUnit', () => this._handleUnitsChanged());
            }
            // Destroy route planner if present
            if (this.routePlanner) {
                try { this.routePlanner.destroy(); } catch (e) {}
                this.routePlanner = null;
            }
        } catch (err) {
            // ignore
        }
    }

    /**
     * Attach the menu to a new map instance (e.g., when reinitializing for theme change)
     * @param {google.maps.Map} newMap - The new map to attach to
     */
    setMap(newMap) {
        if (!newMap) return;

        // Remove from old map if it exists
        if (this.map) {
            try {
                const controls = this.map.controls[google.maps.ControlPosition.TOP_LEFT];
                for (let i = 0; i < controls.getLength(); i++) {
                    if (controls.getAt(i) === this.container) {
                        controls.removeAt(i);
                        break;
                    }
                }
            } catch (err) {
                // ignore
            }
        }

        // Update to new map and re-attach
        this.map = newMap;
        this.map.controls[google.maps.ControlPosition.TOP_LEFT].push(this.container);

        // If route planner was active, re-create it bound to new map
        if (this.routeToggle && this.routeToggle.checked) {
            try {
                // destroy any existing planner
                if (this.routePlanner) { this.routePlanner.destroy(); this.routePlanner = null; }
                // create a fresh one for the new map
                this._lastRouteMeters = 0;
                this.routePlanner = new RoutePlanner(this.map, {
                    settings: this.settings,
                    onRouteChanged: (meters) => { this._lastRouteMeters = meters; this.setSelectedDistance(meters); }
                });
            } catch (err) {
                console.error('Failed to re-create RoutePlanner on new map', err);
            }
        }
    }

    static beautifyTrackId(trackId) {
        // Example: convert "20240615-1234" to "2024-06-15"
        const match = trackId.match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})$/);
        if (match) {
            const [, year, month, day, hour, minute] = match;
            return `${year}-${month}-${day}`;
        }
        // Fallback: do nothing
        return trackId;
    }

    /**
     * Add a new Log section with the given title and initial tracks.
     * Returns the generated sectionId.
     */
    addSection(sectionId, tracks = []) {
        // Get the total distance for the section by summing track distances
        const totalDistanceMeters = tracks.reduce((sum, t) => sum + (t.Distance || 0), 0);
        const targetUnit = this.settings ? this.settings.get('distanceUnit') : 'nm';
        const totalDistance = UnitManager.convertValue('Distance', totalDistanceMeters, targetUnit);
        const titleWithDistance = `${sectionId} \u2014 ${totalDistance.value} ${totalDistance.unit}`;
        const section = this._createSection(titleWithDistance, sectionId);
        const list = document.createElement('div');
        list.className = 'map-menu-list';
        section.content.appendChild(list);

        // Insert into body keeping sections sorted by title in reverse alphabetical order
        const newTitle = String(sectionId);
        let inserted = false;
        // Find existing section containers (excluding liveSection) in DOM order
        const existing = Array.from(this.body.querySelectorAll('.map-menu-section')).filter(el => el.dataset.sectionId !== 'live-track');
        for (const el of existing) {
            const sid = el.dataset.sectionId;
            const entry = this.sections.get(sid);
            const existingTitle = entry ? entry.title : el.querySelector('.map-menu-section-header span:last-child')?.textContent || '';
            // If newTitle > existingTitle lexicographically, insert before (reverse alphabetical)
            if (newTitle.localeCompare(existingTitle) > 0) {
                this.body.insertBefore(section.container, el);
                inserted = true;
                break;
            }
        }
        if (!inserted) {
            // append after existing sections; insert before settings section if it exists
            if (this.settingsSection && this.settingsSection.container.parentElement === this.body) {
                this.body.insertBefore(section.container, this.settingsSection.container);
            } else {
                this.body.appendChild(section.container);
            }
        }

        this.sections.set(sectionId, { section, list, title: newTitle });

        // Populate tracks into the section
        for (const t of tracks) this._addTrackRow(list, t);

        return sectionId;
    }

    /**
     * Update an existing section's tracks, or create the section if it doesn't exist.
     * If the section is created via this call the sectionId is used as the title.
     * @param {string} sectionId
     * @param {Array} tracks
     */
    updateSection(sectionId, tracks = []) {
        const entry = this.sections.get(sectionId);
        if (!entry) {
            // Create a new section with title == sectionId
            this.addSection(sectionId, tracks, sectionId);
            return;
        }
        const { list } = entry;

        // Remove existing inputs for this list from the checkboxes map
        const existingInputs = Array.from(list.querySelectorAll('input[data-track-id]'));
        for (const input of existingInputs) {
            const id = input.dataset.trackId;
            if (this.checkboxes.get(id) === input) this.checkboxes.delete(id);
        }

        // Clear and populate
        list.innerHTML = '';
        for (const t of tracks) this._addTrackRow(list, t);
    }

    /**
     * Remove a previously added section by id.
     * @param {string} sectionId
     */
    removeSection(sectionId) {
        const entry = this.sections.get(sectionId);
        if (!entry) return;
        const { section, list } = entry;
        // Remove any inputs from checkboxes map
        const inputs = Array.from(list.querySelectorAll('input[data-track-id]'));
        for (const input of inputs) {
            const id = input.dataset.trackId;
            if (this.checkboxes.get(id) === input) this.checkboxes.delete(id);
        }
        // Remove DOM
        if (section && section.container && section.container.parentElement) {
            section.container.parentElement.removeChild(section.container);
        }
        this.sections.delete(sectionId);
    }

    /**
     * Populate the settings section with configuration options
     */
    _populateSettingsSection() {
        if (!this.settings || !this.settingsSection) return;

        const content = document.createElement('div');
        content.className = 'map-menu-settings-content';

        // Distance units setting
        content.appendChild(this._createSettingGroup(
            'Distance Units',
            'distanceUnit',
            [
                { value: 'km', label: 'Kilometers' },
                { value: 'nm', label: 'Nautical Miles' },
                { value: 'm', label: 'Meters' }
            ]
        ));

        // Speed units setting
        content.appendChild(this._createSettingGroup(
            'Speed Units',
            'speedUnit',
            [
                { value: 'km/h', label: 'km/h' },
                { value: 'knots', label: 'Knots' },
                { value: 'm/s', label: 'm/s' }
            ]
        ));

        // Depth units setting
        content.appendChild(this._createSettingGroup(
            'Depth Units',
            'depthUnit',
            [
                { value: 'feet', label: 'Feet' },
                { value: 'm', label: 'Meters' }
            ]
        ));

        // Theme setting
        content.appendChild(this._createSettingGroup(
            'Theme',
            'theme',
            [
                { value: 'light', label: 'Light' },
                { value: 'dark', label: 'Dark' }
            ]
        ));

        // Page Load Options group containing both auto-activate and map type settings
        const pageLoadGroup = document.createElement('div');
        pageLoadGroup.className = 'map-menu-setting-group';
        const pageLoadLabel = document.createElement('div');
        pageLoadLabel.className = 'map-menu-setting-label';
        pageLoadLabel.textContent = 'Page Load Options';
        pageLoadGroup.appendChild(pageLoadLabel);

        // Auto-activate latest track checkbox
        const autoActivateRow = document.createElement('div');
        autoActivateRow.className = 'map-menu-setting-option';
        const autoActivateCheckbox = document.createElement('input');
        autoActivateCheckbox.type = 'checkbox';
        autoActivateCheckbox.checked = !!this.settings.get('autoActivateLatestTrack');
        autoActivateCheckbox.className = 'map-menu-radio';
        autoActivateCheckbox.addEventListener('change', (ev) => {
            this.settings.set('autoActivateLatestTrack', !!ev.target.checked);
        });
        const autoActivateLabel = document.createElement('label');
        autoActivateLabel.textContent = 'Auto-activate latest track';
        autoActivateLabel.className = 'map-menu-label';
        autoActivateLabel.addEventListener('click', () => autoActivateCheckbox.click());
        autoActivateRow.appendChild(autoActivateCheckbox);
        autoActivateRow.appendChild(autoActivateLabel);
        pageLoadGroup.appendChild(autoActivateRow);

        // Map Type dropdown
        const mapTypeRow = document.createElement('div');
        mapTypeRow.className = 'map-menu-setting-option';
        const mapTypeLabel = document.createElement('label');
        mapTypeLabel.textContent = 'Map Type';
        mapTypeLabel.className = 'map-menu-label';
        const mapTypeSelect = document.createElement('select');
        mapTypeSelect.className = 'map-menu-select';
        mapTypeSelect.addEventListener('change', (ev) => {
            this.settings.set('mapType', ev.target.value);
        });
        const mapTypeOptions = [
            { value: 'roadmap', label: 'Roadmap' },
            { value: 'satellite', label: 'Satellite' },
            { value: 'hybrid', label: 'Hybrid' },
            { value: 'terrain', label: 'Terrain' }
        ];
        mapTypeOptions.forEach(option => {
            const optionElement = document.createElement('option');
            optionElement.value = option.value;
            optionElement.textContent = option.label;
            mapTypeSelect.appendChild(optionElement);
        });
        mapTypeSelect.value = this.settings.get('mapType') || 'terrain';
        mapTypeRow.appendChild(mapTypeLabel);
        mapTypeRow.appendChild(mapTypeSelect);
        pageLoadGroup.appendChild(mapTypeRow);

        content.appendChild(pageLoadGroup);

        this.settingsSection.content.appendChild(content);
    }

    /**
     * Populate the boats section with boat selection checkboxes
     */
    _populateBoatsSection() {
        if (!this.trackManager) return;

        const boats = this.trackManager.getAllBoats();
        this._populateBoatsSectionWithBoats(boats);
    }

    /**
     * Update the boats section with a new list of boats
     * @param {Array} boats - Array of boat names
     */
    _updateBoatsSection(boats) {
        if (!this.boatsSection) return;

        // Clear existing content
        this.boatsSection.content.innerHTML = '';

        // Re-populate with new boats
        this._populateBoatsSectionWithBoats(boats);
    }

    /**
     * Populate the boats section content with the given boats
     * @param {Array} boats - Array of boat names
     */
    _populateBoatsSectionWithBoats(boats) {
        if (!this.trackManager) return;

        const content = document.createElement('div');
        content.className = 'map-menu-boats-content';

        const selectedBoats = new Set(this.trackManager.getSelectedBoats());

        boats.forEach(boatName => {
            const row = document.createElement('div');
            row.className = 'map-menu-row';

            const input = document.createElement('input');
            input.type = 'checkbox';
            input.dataset.boatName = boatName;
            input.className = 'map-menu-checkbox';
            input.checked = selectedBoats.has(boatName);

            const label = document.createElement('label');
            label.textContent = boatName;
            label.className = 'map-menu-label';

            input.addEventListener('change', (ev) => {
                const checked = ev.target.checked;
                const boatName = ev.target.dataset.boatName;
                this._handleBoatSelectionChange(boatName, checked);
            });

            // clicking label toggles checkbox
            label.addEventListener('click', () => input.click());

            row.appendChild(input);
            row.appendChild(label);
            content.appendChild(row);
        });

        this.boatsSection.content.appendChild(content);
    }

    /**
     * Handle boat selection change
     */
    _handleBoatSelectionChange(boatName, checked) {
        const selectedBoats = new Set(this.trackManager.getSelectedBoats());
        if (checked) {
            selectedBoats.add(boatName);
        } else {
            selectedBoats.delete(boatName);
        }
        this.trackManager.setBoatSelection(Array.from(selectedBoats));
    }

    /**
     * Refresh the boats section (useful if boats are loaded after menu creation)
     */
    refreshBoatsSection() {
        if (!this.trackManager || !this.boatsSection) return;

        const boats = this.trackManager.getAllBoats();
        this._updateBoatsSection(boats);
    }

    /**
     * Create a setting group with radio buttons
     * @param {string} label - Group label
     * @param {string} settingName - Setting key
     * @param {Array} options - Array of {value, label}
     * @returns {HTMLElement}
     */
    _createSettingGroup(label, settingName, options) {
        const group = document.createElement('div');
        group.className = 'map-menu-setting-group';

        const groupLabel = document.createElement('div');
        groupLabel.className = 'map-menu-setting-label';
        groupLabel.textContent = label;
        group.appendChild(groupLabel);

        const currentValue = this.settings.get(settingName);

        options.forEach(option => {
            const optionRow = document.createElement('div');
            optionRow.className = 'map-menu-setting-option';

            const radio = document.createElement('input');
            radio.type = 'radio';
            radio.name = `menu-${settingName}`;
            radio.value = option.value;
            radio.checked = currentValue === option.value;
            radio.className = 'map-menu-radio';
            radio.addEventListener('change', () => {
                if (radio.checked) {
                    this.settings.set(settingName, option.value);
                }
            });

            const optionLabel = document.createElement('label');
            optionLabel.textContent = option.label;
            optionLabel.className = 'map-menu-label';
            optionLabel.addEventListener('click', () => radio.click());

            optionRow.appendChild(radio);
            optionRow.appendChild(optionLabel);
            group.appendChild(optionRow);
        });

        return group;
    }

    /**
     * Create a setting group with a single checkbox.
     * @param {string} label - Group label
     * @param {string} settingName - Setting key
     * @returns {HTMLElement}
     */
    _createCheckboxSettingGroup(grouplabel, settingLabel, settingName) {
        const group = document.createElement('div');
        group.className = 'map-menu-setting-group';

        const groupLabel = document.createElement('div');
        groupLabel.className = 'map-menu-setting-label';
        groupLabel.textContent = grouplabel;
        group.appendChild(groupLabel);

        const currentValue = !!this.settings.get(settingName);

        const row = document.createElement('div');
        row.className = 'map-menu-setting-option';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = currentValue;
        checkbox.className = 'map-menu-radio';
        checkbox.addEventListener('change', (ev) => {
            this.settings.set(settingName, !!ev.target.checked);
        });

        const optionLabel = document.createElement('label');
        optionLabel.textContent = settingLabel;
        optionLabel.className = 'map-menu-label';
        optionLabel.addEventListener('click', () => checkbox.click());

        // Single element order: checkbox followed by its label
        row.appendChild(checkbox);
        row.appendChild(optionLabel);
        group.appendChild(row);


        return group;
    }
}
