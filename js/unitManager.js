// UnitManager: centralizes unit conversion logic used across the app.
// Keep this file small and focused; additional unit-related helpers can be
// added here if needed (formatting, locale-aware units, etc.).

export class UnitManager {
	/**
	 * Convert a named telemetry value into a display-friendly value + unit.
	 * Input: key (string), value (number or other), and targetUnit.
	 * Output: { value: displayValue, unit: string, unitSpace: string }
	 */
	static convertValue(key, value, targetUnit) {
		switch (key) {
			case 'Depth':
				// Depth conversion
				if (value === undefined || value === null || isNaN(value) || value >= 42000000) {
					return { value: '--', unit: targetUnit || 'm', unitSpace: ' ' };
				}
				if (targetUnit === 'feet') {
					return {
						value: (value * 3.28084).toFixed(value > 3 ? 0 : 1),
						unit: 'ft',
						unitSpace: ' '
					};
				} else {
					return {
						value: value.toFixed(value > 3 ? 0 : 1),
						unit: 'm',
						unitSpace: ' '
					};
				}
			case 'AWA':
				// Apparent wind angle (radians) -> degrees, indicate side
				return {
                    value: (Math.abs(value) * (180 / Math.PI)).toFixed(0),
                    unit: `° ${value < 0 ? 'port' : 'starboard'}`,
                    unitSpace: ''
                };
			case 'AWS':
			case 'SOG':
				// Speed conversion
                if (value === undefined || value === null || isNaN(value)) {
                    return { value: '--', unit: targetUnit || 'knots', unitSpace: ' ' };
                }
				if (targetUnit === 'knots') {
					const knots = value * 1.94384;
					return {
						value: knots.toFixed(knots === 0 ? 0 : knots < 9.999 ? 1 : 0),
						unit: 'knots',
						unitSpace: ' '
					};
				} else if (targetUnit === 'km/h') {
					const kmh = value * 3.6;
					return {
						value: kmh.toFixed(kmh === 0 ? 0 : kmh < 9.999 ? 1 : 0),
						unit: 'km/h',
						unitSpace: ' '
					};
				} else { // m/s
					return {
						value: value.toFixed(value === 0 ? 0 : value < 9.999 ? 1 : 0),
						unit: 'm/s',
						unitSpace: ' '
					};
				}
			case 'COG':
				// Course over ground in radians -> degrees True
				return {
                    value: (value * (180 / Math.PI)).toFixed(0),
                    unit: '° T',
                    unitSpace: ''
                };
			case 'Distance':
				// Distance conversion
				if (targetUnit === 'nm') {
					// Meters -> nautical miles
					return {
						value: (value * 0.000539957).toFixed(1),
						unit: 'nm',
						unitSpace: ' '
					};
				} else if (targetUnit === 'km') {
					// Meters -> kilometers
					return {
						value: (value / 1000).toFixed(1),
						unit: 'km',
						unitSpace: ' '
					};
				} else {
					// Meters (no conversion)
					return {
						value: value.toFixed(value > 100 ? 0 : 1),
						unit: 'm',
						unitSpace: ' '
					};
				}
			default:
				return { value: value, unit: '', unitSpace: '' };
		}
	}

    static convertWindAngle(angleRadians) {
        if (angleRadians === undefined || angleRadians === null || isNaN(angleRadians)) {
            return { value: 0, unit: '°', unitSpace: '' };
        }
        let angleDegrees = angleRadians * (180 / Math.PI);
        return { value: angleDegrees, unit: '°', unitSpace: '' };
    }

    static toRadians(degrees) {
        return degrees * (Math.PI / 180);
    }

    static toDegrees(radians) {
        return radians * (180 / Math.PI);
    }
}

export default UnitManager;
