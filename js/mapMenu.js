import UnitManager from './unitManager.js';

// MapMenu: overlay control with two collapsible sections - Live Track and Log
export default class MapMenu {
    /**
     * @param {google.maps.Map} map
     * @param {Function} onChange - Callback (trackId, checked) when checkbox toggled
     * @param {Object} options - {hasLiveTrack: boolean, liveTrackId: string|null, settings: Settings, onUnitsChanged: Function}
     */
    constructor(map, onChange = () => {}, options = {}) {
        this.map = map;
        this.onChange = onChange;
        this.onLiveTrackFollowChange = options.onLiveTrackFollowChange || (() => {});
        this.onUnitsChanged = options.onUnitsChanged || (() => {});
        this.settings = options.settings || null;
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

        // Sections map: sectionId -> { section, list, title }
        // Sections (including any 'Log'-like groups) must be added explicitly via addSection()
        this.sections = new Map();

        // Create Settings section (if settings instance provided)
        if (this.settings) {
            this.settingsSection = this._createSection('⚙ Settings', 'settings');
            this._populateSettingsSection();
            this.body.appendChild(this.settingsSection.container);
        }

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

        // Update selected distance in footer
        // This will be automatically updated when tracks are reloaded

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
        const section = this._createSection(sectionId, sectionId);
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

        this.settingsSection.content.appendChild(content);
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
}
