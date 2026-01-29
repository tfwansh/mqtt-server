/**
 * Unit tests for ON/OFF control algorithm
 */

describe('ON/OFF Control Algorithm', () => {
    /**
     * Compute ON/OFF output based on hysteresis algorithm
     * @param {number} pv - Process value (0-100%)
     * @param {number} sp - Setpoint (0-100%)
     * @param {number} hyst - Hysteresis band (0-100%)
     * @param {number} prevOut - Previous output (0 or 100)
     * @returns {number} - Output (0 or 100)
     */
    function computeOnOff(pv, sp, hyst, prevOut) {
        const halfH = hyst / 2;
        if (pv >= sp + halfH) return 0;
        if (pv <= sp - halfH) return 100;
        return prevOut;
    }

    /**
     * Convert ADC raw value to percentage
     */
    function adcToPercent(raw) {
        return (raw / 4095) * 100;
    }

    /**
     * Convert percentage to DAC value
     */
    function percentToDac(percent) {
        return Math.round((percent / 100) * 4095);
    }

    describe('computeOnOff', () => {
        const sp = 50; // 50% setpoint
        const hyst = 10; // 10% hysteresis band

        it('should return 0 (OFF) when PV >= SP + halfH', () => {
            // PV at or above high threshold (55%)
            expect(computeOnOff(55, sp, hyst, 100)).toBe(0);
            expect(computeOnOff(60, sp, hyst, 100)).toBe(0);
            expect(computeOnOff(100, sp, hyst, 100)).toBe(0);
        });

        it('should return 100 (ON) when PV <= SP - halfH', () => {
            // PV at or below low threshold (45%)
            expect(computeOnOff(45, sp, hyst, 0)).toBe(100);
            expect(computeOnOff(40, sp, hyst, 0)).toBe(100);
            expect(computeOnOff(0, sp, hyst, 0)).toBe(100);
        });

        it('should maintain previous output in deadband', () => {
            // PV in deadband (45% < PV < 55%)
            expect(computeOnOff(50, sp, hyst, 0)).toBe(0);
            expect(computeOnOff(50, sp, hyst, 100)).toBe(100);
            expect(computeOnOff(48, sp, hyst, 0)).toBe(0);
            expect(computeOnOff(52, sp, hyst, 100)).toBe(100);
        });

        it('should handle edge cases at thresholds', () => {
            // Exactly at thresholds
            expect(computeOnOff(55, sp, hyst, 100)).toBe(0); // At high, turns off
            expect(computeOnOff(45, sp, hyst, 0)).toBe(100); // At low, turns on
        });

        it('should work with different setpoints', () => {
            expect(computeOnOff(80, 70, 10, 0)).toBe(0); // PV >= 75, OFF
            expect(computeOnOff(60, 70, 10, 100)).toBe(100); // PV <= 65, ON
        });

        it('should work with zero hysteresis', () => {
            // No hysteresis = bang-bang at setpoint
            expect(computeOnOff(51, 50, 0, 100)).toBe(0);
            expect(computeOnOff(49, 50, 0, 0)).toBe(100);
            expect(computeOnOff(50, 50, 0, 100)).toBe(0); // At SP, OFF
        });

        it('should work with large hysteresis', () => {
            // 50% hysteresis around 50% setpoint = 25-75% band
            expect(computeOnOff(80, 50, 50, 100)).toBe(0);
            expect(computeOnOff(20, 50, 50, 0)).toBe(100);
            expect(computeOnOff(50, 50, 50, 0)).toBe(0); // Deadband
        });
    });

    describe('Heating/Cooling Simulation', () => {
        it('should simulate heating cycle correctly', () => {
            const sp = 50;
            const hyst = 10;
            let output = 0;
            const history = [];

            // Simulate temperature rising and falling
            const pvSequence = [30, 35, 40, 45, 50, 55, 60, 55, 50, 45, 40];

            for (const pv of pvSequence) {
                output = computeOnOff(pv, sp, hyst, output);
                history.push({ pv, output });
            }

            // Verify behavior
            expect(history[0].output).toBe(100); // PV 30 < 45, heat ON
            expect(history[5].output).toBe(0);   // PV 55 >= 55, heat OFF
            expect(history[6].output).toBe(0);   // PV 60, stay OFF
            expect(history[9].output).toBe(100); // PV 45 <= 45, heat ON
        });
    });

    describe('ADC/DAC Conversions', () => {
        it('should convert ADC to percentage correctly', () => {
            expect(adcToPercent(0)).toBe(0);
            expect(adcToPercent(4095)).toBe(100);
            expect(adcToPercent(2048)).toBeCloseTo(50.01, 1);
        });

        it('should convert percentage to DAC correctly', () => {
            expect(percentToDac(0)).toBe(0);
            expect(percentToDac(100)).toBe(4095);
            expect(percentToDac(50)).toBe(2048);
        });

        it('should round trip correctly', () => {
            const original = 2048;
            const percent = adcToPercent(original);
            const backToDac = percentToDac(percent);
            expect(backToDac).toBe(original);
        });
    });

    describe('Full Control Loop', () => {
        it('should compute correct DAC output from ADC input', () => {
            const adcRaw = 1843; // ~45%
            const sp = 50;
            const hyst = 10;
            const prevOutput = 0;

            const pvPercent = adcToPercent(adcRaw);
            const outputPercent = computeOnOff(pvPercent, sp, hyst, prevOutput);
            const dacValue = percentToDac(outputPercent);

            expect(pvPercent).toBeCloseTo(45, 0);
            expect(outputPercent).toBe(100); // Below low threshold, ON
            expect(dacValue).toBe(4095);
        });
    });
});
