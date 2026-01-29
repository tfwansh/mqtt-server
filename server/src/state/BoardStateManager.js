import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';
import config from '../config/index.js';

/**
 * BoardStateManager - Maintains authoritative state for all connected boards
 * Handles online/offline detection, state caching, and telemetry tracking
 */
export class BoardStateManager extends EventEmitter {
    constructor() {
        super();
        this.boards = new Map(); // boardId -> BoardState
        this.timeoutCheckers = new Map(); // boardId -> timeoutId
    }

    /**
     * Get or create board state entry
     */
    getOrCreateBoard(boardId) {
        if (!this.boards.has(boardId)) {
            this.boards.set(boardId, {
                boardId,
                online: false,
                lastState: null,
                lastTelemetry: null,
                lastCmd: null,
                lastSeen: null,
                clients: new Set(),
                metadata: {},
            });
            logger.info(`New board registered: ${boardId}`);
        }
        return this.boards.get(boardId);
    }

    /**
     * Get board state (read-only copy)
     */
    getBoard(boardId) {
        const board = this.boards.get(boardId);
        if (!board) return null;

        return {
            ...board,
            clients: board.clients.size,
        };
    }

    /**
     * Get all boards (read-only copies)
     */
    getAllBoards() {
        const result = {};
        for (const [boardId, board] of this.boards) {
            result[boardId] = {
                ...board,
                clients: board.clients.size,
            };
        }
        return result;
    }

    /**
     * Update board state from MQTT state message
     */
    updateState(boardId, stateMsg) {
        const board = this.getOrCreateBoard(boardId);

        board.lastState = stateMsg;
        board.lastSeen = Date.now();

        // Update online status from state message
        if (typeof stateMsg.online === 'boolean') {
            const wasOnline = board.online;
            board.online = stateMsg.online;

            if (wasOnline !== board.online) {
                logger.info(`Board ${boardId} status changed: ${board.online ? 'ONLINE' : 'OFFLINE'}`);
                this.emit('statusChange', { boardId, online: board.online });
            }
        }

        // Reset timeout checker
        this.resetTimeoutChecker(boardId);

        logger.debug(`State updated for board ${boardId}`, { state: stateMsg });
        this.emit('stateUpdate', { boardId, state: board });

        return board;
    }

    /**
     * Update board telemetry from MQTT telemetry message
     */
    updateTelemetry(boardId, telemetryMsg) {
        const board = this.getOrCreateBoard(boardId);

        board.lastTelemetry = telemetryMsg;
        board.lastSeen = Date.now();

        // If we receive telemetry, board is online
        if (!board.online) {
            board.online = true;
            logger.info(`Board ${boardId} detected as online via telemetry`);
            this.emit('statusChange', { boardId, online: true });
        }

        // Reset timeout checker
        this.resetTimeoutChecker(boardId);

        this.emit('telemetryUpdate', { boardId, telemetry: telemetryMsg });

        return board;
    }

    /**
     * Record last command sent to board
     */
    updateLastCommand(boardId, cmdData) {
        const board = this.getOrCreateBoard(boardId);
        board.lastCmd = cmdData;
        this.emit('commandUpdate', { boardId, lastCmd: cmdData });
        return board;
    }

    /**
     * Mark board as offline (e.g., from LWT or timeout)
     */
    markOffline(boardId, reason = 'timeout') {
        const board = this.boards.get(boardId);
        if (!board) return;

        if (board.online) {
            board.online = false;
            logger.warn(`Board ${boardId} marked OFFLINE (reason: ${reason})`);
            this.emit('statusChange', { boardId, online: false, reason });
        }

        // Clear timeout checker
        this.clearTimeoutChecker(boardId);
    }

    /**
     * Reset the timeout checker for a board
     */
    resetTimeoutChecker(boardId) {
        this.clearTimeoutChecker(boardId);

        const timeoutId = setTimeout(() => {
            this.markOffline(boardId, 'timeout');
        }, config.board.timeoutMs);

        this.timeoutCheckers.set(boardId, timeoutId);
    }

    /**
     * Clear timeout checker for a board
     */
    clearTimeoutChecker(boardId) {
        const existing = this.timeoutCheckers.get(boardId);
        if (existing) {
            clearTimeout(existing);
            this.timeoutCheckers.delete(boardId);
        }
    }

    /**
     * Add client to board's client set
     */
    addClient(boardId, clientId) {
        const board = this.getOrCreateBoard(boardId);
        board.clients.add(clientId);
        logger.debug(`Client ${clientId} joined board ${boardId}`);
    }

    /**
     * Remove client from board's client set
     */
    removeClient(boardId, clientId) {
        const board = this.boards.get(boardId);
        if (board) {
            board.clients.delete(clientId);
            logger.debug(`Client ${clientId} left board ${boardId}`);
        }
    }

    /**
     * Remove client from all boards
     */
    removeClientFromAll(clientId) {
        for (const board of this.boards.values()) {
            board.clients.delete(clientId);
        }
    }

    /**
     * Get state for Modbus register mapping
     */
    getModbusState(boardId) {
        const board = this.boards.get(boardId);
        if (!board) return null;

        const state = board.lastState || {};
        const telemetry = board.lastTelemetry || {};

        return {
            online: board.online,
            adc: telemetry.adc || [0, 0, 0, 0, 0, 0],
            dac: state.dac || { dac1: 0, dac2: 0 },
            actuators: state.actuators || {},
            temp: telemetry.temp || 0,
            humid: telemetry.humid || 0,
            latency_ms: state.latency_ms || 1000,
        };
    }

    /**
     * Clean up resources
     */
    destroy() {
        for (const timeoutId of this.timeoutCheckers.values()) {
            clearTimeout(timeoutId);
        }
        this.timeoutCheckers.clear();
        this.boards.clear();
        this.removeAllListeners();
    }
}

export default BoardStateManager;
