import UnitManager from './unitManager.js';

// TrackView module: handles rendering polyline and markers on a Google Map.
export default class TrackView {

    static domParser = new DOMParser();
    static circleDiameterPixels = 32;
    static arrowSvgCache = null;

    static async loadArrowSvg(colour) {
        if (!TrackView.arrowSvgCache) {
            try {
                const response = await fetch('images/arrow_up.svg');
                TrackView.arrowSvgCache = await response.text();
            } catch (error) {
                console.error('Failed to load arrow_up.svg:', error);
                // Fallback to a simple arrow
                TrackView.arrowSvgCache = `
                    <svg xmlns="http://www.w3.org/2000/svg" width="${TrackView.circleDiameterPixels}" height="${TrackView.circleDiameterPixels}" viewBox="0 0 128 128">
                        <polygon points="64,8 120,120 8,120" fill="FILL_COLOR"/>
                    </svg>
                `;
            }
        }
        // Replace FILL_COLOR placeholder with actual color
        return TrackView.arrowSvgCache.replace(/FILL_COLOR/g, colour);
    }

    constructor(map, trackColour, centerMap, dashboard=null, onBoundsChange=null, settings=null, trackId=null) {
        this.map = map;
        this.trackColour = trackColour;
        this.startTime = null;
        this.endTime = null;
        this.trackPoints = [];
        this.infoWindow = new google.maps.InfoWindow();
        this.markers = [];
        this.dashboard = dashboard;
        this.bounds = new google.maps.LatLngBounds();
        this.distance = 0;
        this.onBoundsChange = onBoundsChange;
        this.settings = settings;
        this.trackId = trackId;
        this.trackData = null; // cache for track data
        // If a NavDashboard instance was provided, ensure it's visible so TrackView
        // can update tiles immediately. The dashboard instance is expected to have
        // been initialized by the caller (main.js).
        try {
            if (this.dashboard && typeof this.dashboard.show === 'function') {
                this.dashboard.show(true);
            }
        } catch (err) {
            // ignore any errors to avoid breaking TrackView creation
            console.error('Error showing NavDashboard from TrackView:', err);
        }
        this.prevPointData = null;
        this.centerMap = centerMap;

        // create the polyline
        this.track = new google.maps.Polyline({
            geodesic: true,
            clickable: true,
            strokeColor: trackColour,
            strokeOpacity: 1.0,
            strokeWeight: 6,
        });
        this.track.setMap(this.map);

        // Add click listener for track data popup
        this.track.addListener('click', (event) => {
            this.handleTrackClick(event);
        });
    }

    async handleTrackClick(event) {
        if (!this.trackId) return;

        // Fetch track data if not already cached
        if (this.trackData === null) {
            this.trackData = await this.fetchTrackData();
        }

        // Close any open info window
        if (this.infoWindow) {
            this.infoWindow.close();
        }

        const boatName = this.trackData !== null ? this.trackData.boatName || 'Unknown' : 'Unknown';
        const dateStr = this.trackId ? `${this.trackId.slice(0,4)}-${this.trackId.slice(4,6)}-${this.trackId.slice(6,8)}` : 'N/A';

        const metaLines = [];

        // Track distance may be in meta or top-level Distance property; prefer top-level if available
        const trackDistance = this.distance || this.trackData.Distance || 0;
        const convertedDistance = UnitManager.convertValue('Distance', trackDistance, this._getTargetUnit('Distance'));
        metaLines.push(`<strong>Distance:</strong> ${convertedDistance.value}${convertedDistance.unitSpace}${convertedDistance.unit}`);

        // Compute track time and average speed from distance and the timestamps of the first and last points if possible
        if (this.trackPoints.length >= 2) {
            if (this.startTime && this.endTime && this.endTime > this.startTime) {
                const timeSeconds = (this.endTime - this.startTime) / 1000;
                const speed = trackDistance / timeSeconds; // distance per second
                const convertedSpeed = UnitManager.convertValue('SOG', speed, this._getTargetUnit('SOG'));
                metaLines.push(`<strong>Average Speed:</strong> ${convertedSpeed.value}${convertedSpeed.unitSpace}${convertedSpeed.unit}`);
                metaLines.push(`<strong>Track Time:</strong> ${Math.floor(timeSeconds / 3600)}h ${Math.floor((timeSeconds % 3600) / 60)}m ${Math.floor(timeSeconds % 60)}s`);
            }
        }

        if (this.trackData && this.trackData.meta) {
            // Format meta data for display
            // Sample meta: {"maxSpeed":5.0}
            if (this.trackData.meta.maxSpeed !== undefined) {
                const converted = UnitManager.convertValue('SOG', this.trackData.meta.maxSpeed, this._getTargetUnit('SOG'));
                metaLines.push(`<strong>Max Speed:</strong> ${converted.value}${converted.unitSpace}${converted.unit}`);
            }

            // Include any other meta fields that may be present
            for (const key in this.trackData.meta) {
                if (['maxSpeed'].includes(key)) continue; // already handled or not to show
                metaLines.push(`<strong>${key}:</strong> ${this.trackData.meta[key]}`);
            }
        }

        // Point count
        metaLines.push(`<strong>Point Count:</strong> ${this.trackPoints.length}`);

        // Get theme from settings
        const isDarkTheme = this.settings && this.settings.get('theme') === 'dark';
        this.infoWindow.setContent(`
            <div class="info-window-content${isDarkTheme ? '-dark' : ''}">
                <span style="font-weight: bold; font-size: 1.2em;">${boatName} - ${dateStr}</span><br><br>
                ${metaLines.join('<br>')}
            </div>
        `);
        this.infoWindow.setPosition(event.latLng);
        this.infoWindow.open(this.map);
    }

    async fetchTrackData() {
        if (!this.trackId || this.trackId.length < 4) return null;

        const year = this.trackId.slice(0, 4);
        const dataUrl = this.getDataUrl();
        const url = `${dataUrl}/${year}.ndjson`;

        try {
            const response = await fetch(url);
            if (!response.ok) return null;

            const text = await response.text();
            const lines = text.trim().split('\n');
            for (const line of lines) {
                try {
                    const entry = JSON.parse(line);
                    if (entry.id === this.trackId) {
                        return entry;
                    }
                } catch (e) {
                    // ignore parse errors
                }
            }
        } catch (error) {
            console.error('Error fetching meta data:', error);
        }
        return null;
    }

    getDataUrl() {
        // This should match the logic in main.js getRuntimeConfig
        const isProd = window.location.href.includes('https://daysrun.github.io');
        const urlParams = new URLSearchParams(window.location.search);
        const param = urlParams.get('branch');
        const branch = param ? param : 'main';
        return isProd ? `https://daysrun.github.io/shipslog/${branch}` : `shipslog`;
    }

    placeMarker(pointData, svg) {
        const pointElement = TrackView.domParser.parseFromString(svg, 'image/svg+xml').documentElement;

        // Set dimensions for the arrow
        pointElement.setAttribute('width', TrackView.circleDiameterPixels);
        pointElement.setAttribute('height', TrackView.circleDiameterPixels);

        // Rotate the arrow around its center if COG (radians) is present
        let angle = null;
        if (typeof pointData.COG === 'number' && isFinite(pointData.COG)) {
            angle = (UnitManager.toDegrees(pointData.COG) + 360) % 360;
        } else {
            if (this.prevPointData && this.prevPointData.position) {
                // Fallback: compute bearing from previous point to current point
                const lat1 = UnitManager.toRadians(this.prevPointData.position.lat);
                const lat2 = UnitManager.toRadians(pointData.position.lat);
                const dLon = UnitManager.toRadians(pointData.position.lng - this.prevPointData.position.lng);
                const cosLat2 = Math.cos(lat2);
                const y = Math.sin(dLon) * cosLat2;
                const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * cosLat2 * Math.cos(dLon);
                angle = (UnitManager.toDegrees(Math.atan2(y, x)) + 360) % 360;
            }
        }
        if (angle !== null) {
            // Prefer transforming the outer <g> that contains the geometry
            const outerGroup = pointElement.querySelector('g');
            if (outerGroup) {
                const existing = outerGroup.getAttribute('transform') || '';
                const rotateStr = ` rotate(${angle} 64 64)`; // viewBox center
                outerGroup.setAttribute('transform', `${existing}${rotateStr}`.trim());
            } else {
                // Fallback: use CSS transform on the root SVG
                pointElement.style.transformBox = 'fill-box';
                pointElement.style.transformOrigin = '50% 50%';
                pointElement.style.transform = `rotate(${angle}deg)`;
            }
        }

        const marker = new google.maps.marker.AdvancedMarkerElement({
            map: this.getMapForMarker(pointData.position),
            position: pointData.position,
            title: pointData.timestamp || '',
            content: pointElement,
            anchorLeft: '-50%',
            anchorTop: '-50%',
            gmpClickable: true,
        });
        this.setMarkerDiameter(marker, TrackView.getMarkerDiameter(this.map.getZoom()));
        marker.addEventListener("gmp-click", () => {
            if (this.infoWindow.anchor === marker) {
                this.infoWindow.close();
            } else {
                const ts = pointData.timestamp ? new Date(pointData.timestamp).toUTCString() : 'No timestamp';
                const metadataLines = [];
                for (const key in pointData) {
                    if (key !== 'position' && key !== 'timestamp' && pointData[key] !== undefined) {
                        const targetUnit = this._getTargetUnit(key);
                        const convertedValue = UnitManager.convertValue(key, pointData[key], targetUnit);
                        metadataLines.push(
                            `<strong>${key}:</strong> ${convertedValue.value}${convertedValue.unitSpace}${convertedValue.unit}`
                        );
                    }
                }

                // Get theme from settings to apply appropriate styles
                const isDarkTheme = this.settings && this.settings.get('theme') === 'dark';
                this.infoWindow.setContent(`
                    <div class="info-window-content${isDarkTheme ? '-dark' : ''}">
                        <strong>${ts}</strong><br>
                        ${metadataLines.join('<br>')}
                    </div>
                `);
                this.infoWindow.open(marker.map, marker);
            }
        });

        return marker;
    }

    /**
     * Process an array of point objects from the data source and render any new points
     */
    async processPoints(points) {
        if (!points || points.length === 0) return;

        if (points.length >= 1) {
            this.startTime = points[0].timestamp ? new Date(points[0].timestamp) : null;
            this.endTime = points[points.length - 1].timestamp ? new Date(points[points.length - 1].timestamp) : null;
        }

        // Load arrow SVG once
        const arrowSvg = await TrackView.loadArrowSvg(this.trackColour);

        // Treat incoming points as a delta to append
        points.forEach(element => {
            this.bounds.extend(element.position);
            this.trackPoints.push(element.position);
            this.track.setPath(this.trackPoints);
            this.distance = element.Distance;
            // If the point doesn't have SOG, skip placing a marker
            if (element.SOG !== undefined) {
                this.markers.push(this.placeMarker(element, arrowSvg));
                if (this.dashboard) {
                    this.dashboard.setWind(
                        UnitManager.convertWindAngle(element.AWA),
                        UnitManager.convertValue('AWS', element.AWS, this._getTargetUnit('AWS'))
                    );
                    this.dashboard.setSOG(UnitManager.convertValue('SOG', element.SOG, this._getTargetUnit('SOG')));
                    this.dashboard.setDepth(UnitManager.convertValue('Depth', element.Depth, this._getTargetUnit('Depth')));
                    this.dashboard.setDistance(UnitManager.convertValue('Distance', element.Distance, this._getTargetUnit('Distance')));
                }
            }
            this.prevPointData = element;
        });

        this.updateMarkers();

        if (this.onBoundsChange && typeof this.onBoundsChange === 'function') {
            this.onBoundsChange();
        }
    }

    updateMarkers() {
        const zoom = this.map.getZoom();
        const diameter = TrackView.getMarkerDiameter(zoom);
        this.markers.forEach(element => {
            const svg = element.content;
            this.setMarkerDiameter(element, diameter);
            element.setMap(this.getMapForMarker(element.position));
        });
    }

    setMarkerDiameter(marker, diameter) {
        const svg = marker.content;
        svg.setAttribute('width', diameter);
        svg.setAttribute('height', diameter);
    }

    getMapForMarker(position) {
        const zoom = this.map.getZoom();
        const bounds = this.map.getBounds();
        if (bounds.contains(position) && zoom >= 13) {
            return this.map;
        } else {
            return null;
        }
    }

    static getMarkerDiameter(zoom) {
        return TrackView.circleDiameterPixels * (zoom / 20);
    }

    _getTargetUnit(key) {
        if (!this.settings) return null;
        if (key === 'Depth') {
            return this.settings.get('depthUnit');
        } else if (key === 'AWS' || key === 'SOG') {
            return this.settings.get('speedUnit');
        } else if (key === 'Distance') {
            return this.settings.get('distanceUnit');
        }
        return null;
    }

    // Remove all visuals from the map and clear internal state to allow GC
    destroy() {
        try {
            // remove markers
            if (this.markers && this.markers.length) {
                this.markers.forEach(m => {
                    try { m.setMap(null); } catch (e) { /* ignore */ }
                });
                this.markers.length = 0;
            }
            // remove polyline
            if (this.track) {
                try { this.track.setMap(null); } catch (e) { /* ignore */ }
                this.track = null;
            }
            // close this instance's info window
            if (this.infoWindow) {
                try { this.infoWindow.close(); } catch (e) { /* ignore */ }
                this.infoWindow = null;
            }
            // clear other references
            this.trackPoints = [];
            this.prevPointData = null;
            this.map = null;
            this.dashboard = null;
        } catch (err) {
            console.error('Error destroying TrackView:', err);
        }
    }

    /**
     * Set a new map and re-attach all polylines and markers.
     * Used when the map needs to be reinitialized (e.g., for theme changes).
     * @param {google.maps.Map} newMap - The new map instance
     */
    setMap(newMap) {
        if (!newMap) return;
        this.map = newMap;
        // Re-attach the polyline to the new map
        this.track.setMap(this.map);
        // Re-attach all markers to the new map
        this.markers.forEach(marker => {
            marker.setMap(this.map);
        });
    }
}
