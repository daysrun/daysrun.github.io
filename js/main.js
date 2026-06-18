import Logger from './logger.js';
import MapMenu from './mapMenu.js';
import TrackManager from './trackManager.js';
import TrackView from './trackView.js';
import NavDashboard from './navDashboard.js';
import Settings from './settings.js';


// module-level singletons (created in main.js)
let map = null;
let trackManager = null;
let menu = null;
const activeTrackViews = new Map(); // trackId -> { trackView, unregister }
let initialTrackActivated = false;

/**
 * Factory to create and register a TrackView for a specific track.
 * @param {string} trackId - ID of the track to display
 * @param {string} trackColour - Color for the track
 * @param {boolean} centerMap - Whether to center the map on the first point
 * @returns {Promise<Object>} Promise of { trackView, trackId, unregister }
 */
async function createTrackView(trackId, trackColour, centerMap = false, dashboard, onBoundsChange = null, settings = null) {
    if (!map) {
        throw new Error('createTrackView called before map initialization; call after initMap completes');
    }
    if (!trackManager) {
        throw new Error('createTrackView called before TrackManager initialization');
    }

    const tv = new TrackView(map, trackColour, centerMap, dashboard, onBoundsChange, settings, trackId);

    // Add to activeTrackViews first so it's included if callback fires during registerListener
    // Create a placeholder entry that will be updated with unregister function
    const entry = { trackView: tv, unregister: null };
    activeTrackViews.set(trackId, entry);

    // Register a listener so TrackView receives initial and subsequent updates
    const unregister = await trackManager.registerListener(trackId, (points) => {
        tv.processPoints(points);
    });

    // Update the entry with the unregister function
    entry.unregister = unregister;

    return { trackView: tv, trackId, unregister };
}

async function initMap(settings = null) {
    // Request libraries when needed, not in the script tag.
    // Load required Google Maps libraries (symbols are used via global google namespace)
    await google.maps.importLibrary("core");
    await google.maps.importLibrary("maps");
    await google.maps.importLibrary("marker");

    const position = { lat: 44.74979194815116, lng: -79.8512010048997 };    // Wye Heritage Marina

    // Determine color scheme based on theme setting
    let colorScheme = google.maps.ColorScheme.FOLLOW_SYSTEM;
    if (settings) {
        const theme = settings.get('theme');
        colorScheme = theme === 'dark' ? google.maps.ColorScheme.DARK : google.maps.ColorScheme.LIGHT;
    }

    // The map, centered at position
    return new google.maps.Map(document.getElementById("map"), {
        zoom: 12,
        center: position,
        mapId: "d79157190202fad31292f2ce",
        colorScheme: colorScheme,
        disableDefaultUI: true,
        mapTypeId: 'terrain',
        gestureHandling: 'greedy', // allow scrolling on map without ctrl/meta key or double-tap on mobile
    });
}

/**
 * Reinitialize the map with a new color scheme. Since colorScheme cannot be
 * changed dynamically on an existing map, we must create a new map instance
 * and restore the state (zoom level, center, active tracks) from the old one.
 * @param {Object} oldMap - The existing map to replace
 * @param {Object} settings - Settings object for reading configuration
 * @returns {Promise<Object>} The new map instance
 */
async function reinitializeMapForTheme(oldMap, settings) {
    if (!oldMap) return null;

    // Preserve the current state
    const zoom = oldMap.getZoom();
    const center = oldMap.getCenter();
    const bounds = oldMap.getBounds();

    // const { ColorScheme } = await google.maps.importLibrary("core");
    const theme = settings.get('theme');
    const colorScheme = theme === 'dark' ? google.maps.ColorScheme.DARK : google.maps.ColorScheme.LIGHT;

    // Create new map with new color scheme
    const newMap = new google.maps.Map(document.getElementById("map"), {
        zoom: zoom,
        center: center,
        mapId: "d79157190202fad31292f2ce",
        colorScheme: colorScheme,
        disableDefaultUI: true,
        mapTypeId: 'terrain',
        gestureHandling: 'greedy', // allow scrolling on map without ctrl/meta key or double-tap on mobile
    });

    return newMap;
}

async function initTrackManager() {
    const { dataUrl, pollInterval, logger } = getRuntimeConfig();
    trackManager = new TrackManager(dataUrl, pollInterval, logger);

    // Start polling tracks.json globally
    await trackManager.startPollingTracks();
}

// Small helper to configure runtime (data URL, poll interval, logger)
function getRuntimeConfig() {
    const isProd = window.location.href.includes('https://daysrun.github.io');
    const urlParams = new URLSearchParams(window.location.search);
    const param = urlParams.get('branch');
    const branch = param ? param : 'main';
    return {
        dataUrl: isProd ? `https://daysrun.github.io/shipslog/${branch}` : `shipslog`,
        pollInterval: isProd ? 60000 : 5000,
        logger: new Logger(isProd ? Logger.ENVIRONMENTS.PROD : Logger.ENVIRONMENTS.DEV, 'TrackManager'),
    };
}

// Initialize the application
// Create Settings instance first so it can be passed to initMap
const settings = new Settings();
settings.applySettings();

initMap(settings).then(async (m) => {
    // assign module-level singleton map
    map = m;
    map.addListener('idle', () => {
        // Update marker visibility for all TrackViews
        activeTrackViews.forEach(entry => entry.trackView.updateMarkers());
    });
    // Close any open info window when clicking on the map
    map.addListener('click', () => {
        activeTrackViews.forEach(entry => {
            if (entry.trackView.infoWindow) {
                entry.trackView.infoWindow.close();
            }
        });
    });

    // Register listener to update map theme when settings change
    settings.addListener('theme', async () => {
        const newMap = await reinitializeMapForTheme(map, settings);
        if (newMap) {
            map = newMap;
            // Re-attach event listeners to the new map instance
            map.addListener('idle', () => {
                activeTrackViews.forEach(entry => entry.trackView.updateMarkers());
            });
            map.addListener('click', () => {
                activeTrackViews.forEach(entry => {
                    if (entry.trackView.infoWindow) {
                        entry.trackView.infoWindow.close();
                    }
                });
            });
            // Update all active TrackViews to use the new map
            activeTrackViews.forEach(entry => {
                entry.trackView.setMap(newMap);
            });
            // Update menu with new map
            if (menu) {
                menu.setMap(newMap);
            }
        }
    });

    // Initialize TrackManager and create initial TrackView
    await initTrackManager();

    // Create a NavDashboard instance and initialize it. We'll pass this
    // instance into TrackView when following the live track so TrackView
    // can update tiles / wind instruments.
    const navDashboard = new NavDashboard();
    navDashboard.init();

    const liveTrackColour = "#ff9000";
    const trackColours = [
        "#5aff1a",
        "#d21aff",
        "#ffb31a",
        "#1a5aff",
        "#aaff1a",
        "#7a1aff",
        "#ff7a1a",
        "#1aff4c",
        "#ff1a1a",
        "#1affd2",
        "#ff1aa6",
        "#ffd21a",
        "#1aaaff",
        "#ff1a5a",
        "#1aff7a",
        "#ff4c1a"
    ];
    const trackColourCache = new Map(); // trackId -> colour

    // Helper: compute or return cached colour for a track
    const getTrackColour = (trackId) => {
        if (trackId === trackManager.getLiveTrackId()) return liveTrackColour;
        if (trackColourCache.has(trackId)) return trackColourCache.get(trackId);
        // Derive section (year) from trackId format YYYYMMDD-HHmm
        let idx = -1;
        if (trackId && typeof trackId === 'string' && trackId.length >= 4) {
            const year = trackId.slice(0,4);
            const section = trackManager.getTracks(year);
            idx = section.findIndex(t => t.id === trackId);
            idx += (year * 3); // offset by year to vary colours more
        }
        const colour = trackColours[(idx >= 0 ? idx : 0) % trackColours.length];
        trackColourCache.set(trackId, colour);
        return colour;
    };

    // Callback to fit map bounds to all active tracks and update total selected distance
    const fitAllActiveTracks = () => {
        const bounds = new google.maps.LatLngBounds();
        let totalDistance = 0.0;
        activeTrackViews.forEach((value, key) => {
            bounds.union(value.trackView.bounds);
            totalDistance += value.trackView.distance;
        });
        if (!bounds.isEmpty()) {
            const mapDiv = map.getDiv();
            const padding = Math.floor(Math.min(mapDiv.clientWidth, mapDiv.clientHeight) * 0.1);
            map.fitBounds(bounds, padding);
            map.setZoom(Math.min(map.getZoom(), 15)); // limit max zoom when fitting
        }
        menu.setSelectedDistance(totalDistance);
    };

    // Helpers to activate/deactivate a track view and keep menu swatch in sync
    const activateTrack = async (trackId, explicitColour, centerMap, dashboard=null) => {
        if (!trackId || activeTrackViews.has(trackId)) return;
        const colour = explicitColour || getTrackColour(trackId);
        await createTrackView(trackId, colour, centerMap, dashboard, fitAllActiveTracks, settings);
        menu.setTrackSwatch(trackId, colour);
        menu.setChecked(trackId, true);
        if (dashboard && typeof dashboard.hide === 'function') {
            // Register a listener for live track updates to hide the dashboard when deactivated
            trackManager.registerLiveTrackListener((liveTrackId) => {
                if (liveTrackId === null) {
                    dashboard.hide();
                }
            });
        }
    };
    const deactivateTrack = (trackId) => {
        if (!trackId) return;
        const entry = activeTrackViews.get(trackId);
        if (!entry) return;
        entry.unregister();
        entry.trackView.destroy();
        activeTrackViews.delete(trackId);
        menu.removeTrackSwatch(trackId);
        menu.setChecked(trackId, false);
        fitAllActiveTracks();
    };
    // Create the map menu UI and populate with tracks
    menu = new MapMenu(
        map,
        async (trackId, checked) => {
            try {
                if (checked) {
                    await activateTrack(trackId, null, activeTrackViews.size === 0);
                } else {
                    deactivateTrack(trackId);
                }
            } catch (err) {
                console.error('Error handling menu change:', err);
            }
        },
        {
            hasLiveTrack: trackManager.hasLiveTrack(),
            liveTrackId: trackManager.getLiveTrackId(),
            settings: settings,
            trackManager: trackManager,
            onLiveTrackFollowChange: async (checked) => {
                const liveTrackId = trackManager.getLiveTrackId();
                if (!liveTrackId) return;
                try {
                    if (checked) {
                        // Live track always centers map on activation; pass the NavDashboard
                        // instance so the TrackView can update dashboard tiles and wind.
                        await activateTrack(liveTrackId, liveTrackColour, true, navDashboard);
                    } else {
                        deactivateTrack(liveTrackId);
                        navDashboard.hide();
                    }
                } catch (err) {
                    console.error('Error handling live track follow change:', err);
                }
            },
            onUnitsChanged: async () => {
                // Reload all active tracks when units change
                const trackIds = Array.from(activeTrackViews.keys());
                for (const trackId of trackIds) {
                    const colour = getTrackColour(trackId);
                    const isLive = trackId === trackManager.getLiveTrackId();
                    // Deactivate and reactivate to force reload with new units
                    deactivateTrack(trackId);
                    await activateTrack(trackId, colour, false, isLive ? navDashboard : null);
                }
            }
        }
    );

    // Register tracks listener: TrackManager will call listeners with (sectionId, tracks)
    // Each call updates the named section in the menu. If the section doesn't exist
    // MapMenu.updateSection will create it (using sectionId as title).
    trackManager.registerTracksListener((sectionId, tracks) => {
        try {
            // If tracks is falsy or empty, remove the section; otherwise update/create it.
            if (!tracks || !Array.isArray(tracks) || tracks.length === 0) {
                menu.removeSection(sectionId);
            } else {
                menu.updateSection(sectionId, tracks);
            }
        } catch (err) {
            console.error('Error updating menu section from tracks listener:', err);
        }
    });

    // Keep the menu in sync with live track changes
    trackManager.registerLiveTrackListener((liveTrackId) => {
        menu.setLiveTrack(liveTrackId !== null, liveTrackId);
    });

    const activateLatestFilteredTrack = async () => {
        if (initialTrackActivated) return;
        if (trackManager.hasLiveTrack()) return;
        if (activeTrackViews.size > 0) return;

        let latestTrack = null;
        if (trackManager.tracks instanceof Map) {
            for (const tracks of trackManager.tracks.values()) {
                if (!Array.isArray(tracks)) continue;
                for (const track of tracks) {
                    if (!track || !track.id) continue;
                    if (!latestTrack || track.id > latestTrack.id) {
                        latestTrack = track;
                    }
                }
            }
        } else if (Array.isArray(trackManager.tracks)) {
            for (const track of trackManager.tracks) {
                if (!track || !track.id) continue;
                if (!latestTrack || track.id > latestTrack.id) {
                    latestTrack = track;
                }
            }
        }

        if (latestTrack && latestTrack.id) {
            initialTrackActivated = true;
            try {
                await activateTrack(latestTrack.id, null, activeTrackViews.size === 0);
            } catch (err) {
                console.error('Error activating latest filtered track:', err);
            }
        }
    };

    if (settings.get('autoActivateLatestTrack')) {
        activateLatestFilteredTrack();
    }
});
