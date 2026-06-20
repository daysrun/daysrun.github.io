// RoutePlanner: lightweight route planning helper for Google Maps
export default class RoutePlanner {
    /**
     * @param {google.maps.Map} map
     * @param {Object} options - {onRouteChanged: Function(totalMeters)}
     */
    constructor(map, options = {}) {
        this.map = map;
        this.onRouteChanged = options.onRouteChanged || (() => {});
        this.markers = [];
        this.polyline = new google.maps.Polyline({
            map: this.map,
            path: [],
            strokeColor: '#ff6600',
            strokeOpacity: 0.9,
            strokeWeight: 3
        });

        this.infoWindow = new google.maps.InfoWindow();

        this._mapClickListener = this.map.addListener('click', (ev) => {
            this.addWaypoint(ev.latLng);
        });

        // Long-press on polyline to offer insert waypoint between neighbouring points
        this._polyMouseDownTimer = null;
        this._polyMouseDownListener = this.polyline.addListener('mousedown', (ev) => {
            // start long-press timer
            if (this._polyMouseDownTimer) clearTimeout(this._polyMouseDownTimer);
            this._polyMouseDownTimer = setTimeout(() => {
                this._openInsertMenu(ev.latLng);
                this._polyMouseDownTimer = null;
            }, 650);
        });
        this._polyMouseUpListener = this.polyline.addListener('mouseup', () => {
            if (this._polyMouseDownTimer) { clearTimeout(this._polyMouseDownTimer); this._polyMouseDownTimer = null; }
        });
        this._polyMouseOutListener = this.polyline.addListener('mouseout', () => {
            if (this._polyMouseDownTimer) { clearTimeout(this._polyMouseDownTimer); this._polyMouseDownTimer = null; }
        });
        // right-click to immediately open insert menu
        this._polyRightClickListener = this.polyline.addListener('rightclick', (ev) => this._openInsertMenu(ev.latLng));
    }

    addWaypoint(latLng, insertIndex = null) {
        const marker = this._createMarker(latLng);
        if (typeof insertIndex === 'number' && insertIndex >= 0 && insertIndex <= this.markers.length) {
            this.markers.splice(insertIndex, 0, marker);
        } else {
            this.markers.push(marker);
        }
        this._updateRoute();
        return marker;
    }

    _createMarker(latLng) {
        const marker = new google.maps.Marker({
            position: latLng,
            map: this.map,
            draggable: true,
            title: 'Waypoint',
            icon: {
                path: google.maps.SymbolPath.CIRCLE,
                scale: 6,
                fillColor: '#ff6600',
                fillOpacity: 1,
                strokeColor: '#ffffff',
                strokeWeight: 1
            },
            optimized: false
        });
        const cleanup = { longPressTimer: null };
        marker.addListener('drag', () => this._updateRoute());
        marker.addListener('dragend', () => this._updateRoute());
        marker.addListener('mousedown', () => {
            cleanup.longPressTimer = setTimeout(() => this._openDeleteMenu(marker), 650);
        });
        marker.addListener('mouseup', () => {
            if (cleanup.longPressTimer) { clearTimeout(cleanup.longPressTimer); cleanup.longPressTimer = null; }
        });
        marker.addListener('mouseout', () => {
            if (cleanup.longPressTimer) { clearTimeout(cleanup.longPressTimer); cleanup.longPressTimer = null; }
        });
        marker.addListener('touchstart', () => {
            cleanup.longPressTimer = setTimeout(() => this._openDeleteMenu(marker), 650);
        });
        marker.addListener('touchend', () => {
            if (cleanup.longPressTimer) { clearTimeout(cleanup.longPressTimer); cleanup.longPressTimer = null; }
        });
        marker.addListener('rightclick', () => this._openDeleteMenu(marker));
        return marker;
    }

    _openDeleteMenu(marker) {
        const content = document.createElement('div');
        const btn = document.createElement('button');
        btn.textContent = 'Delete waypoint';
        btn.style.cursor = 'pointer';
        btn.addEventListener('click', () => {
            this.removeWaypoint(marker);
            this.infoWindow.close();
        });
        content.appendChild(btn);
        this.infoWindow.setContent(content);
        this.infoWindow.open(this.map, marker);
    }

    _openInsertMenu(latLng) {
        // create a simple menu offering to insert a waypoint here
        const content = document.createElement('div');
        const btn = document.createElement('button');
        btn.textContent = 'Add waypoint here';
        btn.style.cursor = 'pointer';
        btn.addEventListener('click', () => {
            this._insertWaypointAtLocation(latLng);
            this.infoWindow.close();
        });
        content.appendChild(btn);
        this.infoWindow.setContent(content);
        // position the infoWindow at the clicked location
        this.infoWindow.setPosition(latLng);
        this.infoWindow.open(this.map);
    }

    _insertWaypointAtLocation(latLng) {
        if (this.markers.length < 2) {
            // no segment to insert between; append
            this.addWaypoint(latLng);
            return;
        }
        const idx = this._findBestSegmentIndex(latLng);
        // insert after idx (between idx and idx+1)
        this.addWaypoint(latLng, idx + 1);
    }

    _findBestSegmentIndex(latLng) {
        // Find segment i..i+1 which minimizes extra distance: d(a,p)+d(p,b)-d(a,b)
        let bestIdx = 0;
        let bestVal = Infinity;
        const path = this.markers.map(m => m.getPosition());
        for (let i = 0; i < path.length - 1; i++) {
            const a = path[i];
            const b = path[i+1];
            const d1 = this._computeDistanceMeters(a, latLng);
            const d2 = this._computeDistanceMeters(latLng, b);
            const dab = this._computeDistanceMeters(a, b);
            const extra = (d1 + d2) - dab;
            if (extra < bestVal) { bestVal = extra; bestIdx = i; }
        }
        return bestIdx;
    }

    removeWaypoint(marker) {
        const idx = this.markers.indexOf(marker);
        if (idx === -1) return;
        // remove marker
        marker.setMap(null);
        this.markers.splice(idx, 1);
        this._updateRoute();
    }

    _computeDistanceMeters(a, b) {
        try {
            if (google && google.maps && google.maps.geometry && google.maps.geometry.spherical) {
                return google.maps.geometry.spherical.computeDistanceBetween(a, b);
            }
        } catch (e) {
            // fallthrough to haversine
        }
        // fallback haversine: a and b are LatLng
        const toRad = v => v * Math.PI / 180;
        const R = 6371000; // meters
        const lat1 = a.lat(); const lat2 = b.lat();
        const dLat = toRad(lat2 - lat1);
        const dLon = toRad(b.lng() - a.lng());
        const x1 = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2) * Math.sin(dLon/2);
        const c = 2 * Math.atan2(Math.sqrt(x1), Math.sqrt(1-x1));
        return R * c;
    }

    _updateRoute() {
        const path = this.markers.map(m => m.getPosition());
        this.polyline.setPath(path);

        let total = 0;
        for (let i = 1; i < path.length; i++) {
            total += this._computeDistanceMeters(path[i-1], path[i]);
        }

        try { this.onRouteChanged(total); } catch (e) { console.error('RoutePlanner onRouteChanged error', e); }
    }

    exportGPX(filename = 'route.gpx') {
        if (!this.markers.length) return null;
        const coordToPt = (m) => ({ lat: m.getPosition().lat(), lon: m.getPosition().lng() });
        const pts = this.markers.map(coordToPt);

        const gpxParts = [];
        gpxParts.push('<?xml version="1.0" encoding="UTF-8"?>');
        gpxParts.push('<gpx version="1.1" creator="RoutePlanner">');
        gpxParts.push('<rte>');
        for (const p of pts) {
            gpxParts.push(`  <rtept lat="${p.lat}" lon="${p.lon}"></rtept>`);
        }
        gpxParts.push('</rte>');
        gpxParts.push('</gpx>');

        const blob = new Blob([gpxParts.join('\n')], { type: 'application/gpx+xml' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        return true;
    }

    clear() {
        // remove all markers and polyline
        for (const m of this.markers) m.setMap(null);
        this.markers = [];
        this.polyline.setPath([]);
        try { this.onRouteChanged(0); } catch (e) {}
    }

    destroy() {
        if (this._mapClickListener) google.maps.event.removeListener(this._mapClickListener);
        if (this._polyMouseDownListener) google.maps.event.removeListener(this._polyMouseDownListener);
        if (this._polyMouseUpListener) google.maps.event.removeListener(this._polyMouseUpListener);
        if (this._polyMouseOutListener) google.maps.event.removeListener(this._polyMouseOutListener);
        if (this._polyRightClickListener) google.maps.event.removeListener(this._polyRightClickListener);
        if (this._polyMouseDownTimer) { clearTimeout(this._polyMouseDownTimer); this._polyMouseDownTimer = null; }
        this.clear();
        if (this.polyline) { this.polyline.setMap(null); this.polyline = null; }
        if (this.infoWindow) { this.infoWindow.close(); this.infoWindow = null; }
    }
}
