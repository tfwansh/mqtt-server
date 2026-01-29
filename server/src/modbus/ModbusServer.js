import ModbusRTU from 'modbus-serial';
import { logger } from '../utils/logger.js';
import config from '../config/index.js';

/**
 * Modbus Register Map
 * Base: 40001 (Holding Registers)
 * 
 * 40001-40006: ADC channels 1-6 (uint16, 0-4095)
 * 40010-40011: DAC channels 1-2 (uint16, 0-4095, read/write)
 * 40020: LED6 status (uint16, 0 or 1)
 * 40030: Temperature x10 (int16)
 * 40031: Humidity x10 (int16)
 * 40040: Latency ms (uint16)
 * 40100: Status flags (bit-packed)
 */

const REGISTER_MAP = {
    ADC_START: 0,      // Register 40001 (0-based)
    ADC_END: 5,        // Register 40006
    DAC_START: 9,      // Register 40010
    DAC_END: 10,       // Register 40011
    LED6: 19,          // Register 40020
    TEMP: 29,          // Register 40030
    HUMID: 30,         // Register 40031
    LATENCY: 39,       // Register 40040
    STATUS: 99,        // Register 40100
};

/**
 * ModbusServer - Exposes board state via Modbus TCP
 */
export class ModbusServer {
    constructor(stateManager, mqttHandler) {
        this.stateManager = stateManager;
        this.mqttHandler = mqttHandler;
        this.server = null;
        this.defaultBoardId = 'stm32-01'; // Default board for Modbus access

        // Initialize holding registers (200 registers)
        this.holdingRegisters = new Array(200).fill(0);

        // Initialize coils (100 coils)
        this.coils = new Array(100).fill(false);
    }

    /**
     * Start Modbus TCP server
     */
    async start() {
        if (!config.modbus.enabled) {
            logger.info('Modbus server disabled');
            return;
        }

        return new Promise((resolve, reject) => {
            this.server = new ModbusRTU.ServerTCP({
                getHoldingRegister: (addr, unitID, callback) => {
                    this.handleReadHoldingRegister(addr, unitID, callback);
                },
                setHoldingRegister: (addr, value, unitID, callback) => {
                    this.handleWriteHoldingRegister(addr, value, unitID, callback);
                },
                getCoil: (addr, unitID, callback) => {
                    this.handleReadCoil(addr, unitID, callback);
                },
                setCoil: (addr, value, unitID, callback) => {
                    this.handleWriteCoil(addr, value, unitID, callback);
                },
                getInputRegister: (addr, unitID, callback) => {
                    // Input registers mirror holding registers for read-only access
                    this.handleReadHoldingRegister(addr, unitID, callback);
                },
                getDiscreteInput: (addr, unitID, callback) => {
                    // Discrete inputs mirror coils for read-only access
                    this.handleReadCoil(addr, unitID, callback);
                },
            }, {
                host: '0.0.0.0',
                port: config.modbus.port,
                debug: config.nodeEnv === 'development',
            });

            this.server.on('socketError', (err) => {
                logger.error('Modbus socket error:', err);
            });

            // Listen for state updates to refresh registers
            this.setupStateListeners();

            logger.info(`Modbus TCP server listening on port ${config.modbus.port}`);
            resolve();
        });
    }

    /**
     * Set up state manager listeners to update registers
     */
    setupStateListeners() {
        this.stateManager.on('stateUpdate', ({ boardId }) => {
            if (boardId === this.defaultBoardId) {
                this.updateRegistersFromState(boardId);
            }
        });

        this.stateManager.on('telemetryUpdate', ({ boardId }) => {
            if (boardId === this.defaultBoardId) {
                this.updateRegistersFromState(boardId);
            }
        });
    }

    /**
     * Update Modbus registers from board state
     */
    updateRegistersFromState(boardId) {
        const state = this.stateManager.getModbusState(boardId);
        if (!state) return;

        // Update ADC registers (40001-40006)
        for (let i = 0; i < 6; i++) {
            this.holdingRegisters[REGISTER_MAP.ADC_START + i] = state.adc[i] || 0;
        }

        // Update DAC registers (40010-40011)
        this.holdingRegisters[REGISTER_MAP.DAC_START] = state.dac.dac1 || 0;
        this.holdingRegisters[REGISTER_MAP.DAC_START + 1] = state.dac.dac2 || 0;

        // Update LED6 (40020)
        this.holdingRegisters[REGISTER_MAP.LED6] = state.actuators.led6 ? 1 : 0;
        this.coils[0] = !!state.actuators.led6;

        // Update temperature (40030) - scaled x10
        this.holdingRegisters[REGISTER_MAP.TEMP] = Math.round((state.temp || 0) * 10);

        // Update humidity (40031) - scaled x10
        this.holdingRegisters[REGISTER_MAP.HUMID] = Math.round((state.humid || 0) * 10);

        // Update latency (40040)
        this.holdingRegisters[REGISTER_MAP.LATENCY] = state.latency_ms || 1000;

        // Update status flags (40100)
        let statusFlags = 0;
        if (state.online) statusFlags |= 0x01;
        this.holdingRegisters[REGISTER_MAP.STATUS] = statusFlags;

        logger.debug('Modbus registers updated from state');
    }

    /**
     * Handle reading holding registers
     */
    handleReadHoldingRegister(addr, unitID, callback) {
        // Refresh state before reading
        this.updateRegistersFromState(this.defaultBoardId);

        if (addr >= 0 && addr < this.holdingRegisters.length) {
            callback(null, this.holdingRegisters[addr]);
        } else {
            callback(new Error('Invalid address'));
        }
    }

    /**
     * Handle writing holding registers
     */
    handleWriteHoldingRegister(addr, value, unitID, callback) {
        logger.info(`Modbus write: register ${addr + 40001}, value ${value}`);

        // Handle DAC writes
        if (addr === REGISTER_MAP.DAC_START || addr === REGISTER_MAP.DAC_START + 1) {
            const dacNum = addr === REGISTER_MAP.DAC_START ? 1 : 2;
            const dacValue = Math.max(0, Math.min(4095, value));

            this.sendCommand(`DAC${dacNum}`, dacValue)
                .then(() => {
                    this.holdingRegisters[addr] = dacValue;
                    callback(null);
                })
                .catch((err) => {
                    logger.error('Modbus DAC write failed:', err);
                    callback(err);
                });
            return;
        }

        // Handle LED write
        if (addr === REGISTER_MAP.LED6) {
            const ledValue = value !== 0;

            this.sendCommand('LED6', ledValue)
                .then(() => {
                    this.holdingRegisters[addr] = ledValue ? 1 : 0;
                    this.coils[0] = ledValue;
                    callback(null);
                })
                .catch((err) => {
                    logger.error('Modbus LED write failed:', err);
                    callback(err);
                });
            return;
        }

        // Handle latency write
        if (addr === REGISTER_MAP.LATENCY) {
            const latencyValue = Math.max(100, Math.min(60000, value));

            this.sendCommand('LATENCY', latencyValue)
                .then(() => {
                    this.holdingRegisters[addr] = latencyValue;
                    callback(null);
                })
                .catch((err) => {
                    logger.error('Modbus latency write failed:', err);
                    callback(err);
                });
            return;
        }

        // Read-only registers
        callback(new Error('Register is read-only'));
    }

    /**
     * Handle reading coils
     */
    handleReadCoil(addr, unitID, callback) {
        if (addr >= 0 && addr < this.coils.length) {
            callback(null, this.coils[addr]);
        } else {
            callback(new Error('Invalid address'));
        }
    }

    /**
     * Handle writing coils
     */
    handleWriteCoil(addr, value, unitID, callback) {
        logger.info(`Modbus coil write: address ${addr}, value ${value}`);

        // Handle LED6 coil (address 0)
        if (addr === 0) {
            this.sendCommand('LED6', value)
                .then(() => {
                    this.coils[addr] = value;
                    this.holdingRegisters[REGISTER_MAP.LED6] = value ? 1 : 0;
                    callback(null);
                })
                .catch((err) => {
                    logger.error('Modbus LED coil write failed:', err);
                    callback(err);
                });
            return;
        }

        callback(new Error('Coil is read-only'));
    }

    /**
     * Send command via MQTT
     */
    async sendCommand(cmd, value) {
        const command = {
            cmd,
            value,
            origin: 'modbus',
            reqId: `modbus-${Date.now()}`,
            ts: Date.now(),
        };

        await this.mqttHandler.publishCommand(this.defaultBoardId, command);
        this.stateManager.updateLastCommand(this.defaultBoardId, command);
    }

    /**
     * Set the default board ID for Modbus access
     */
    setDefaultBoardId(boardId) {
        this.defaultBoardId = boardId;
        this.updateRegistersFromState(boardId);
    }

    /**
     * Stop Modbus server
     */
    async stop() {
        if (this.server) {
            this.server.close();
            logger.info('Modbus server stopped');
        }
    }
}

export default ModbusServer;
