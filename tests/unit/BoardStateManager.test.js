/**
 * Unit tests for BoardStateManager
 */

import { jest } from '@jest/globals';

// Mock the logger
jest.unstable_mockModule('../src/utils/logger.js', () => ({
    logger: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
    },
    default: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
    },
}));

// Mock the config
jest.unstable_mockModule('../src/config/index.js', () => ({
    default: {
        board: {
            timeoutMs: 10000,
        },
    },
    config: {
        board: {
            timeoutMs: 10000,
        },
    },
}));

const { BoardStateManager } = await import('../src/state/BoardStateManager.js');

describe('BoardStateManager', () => {
    let manager;

    beforeEach(() => {
        jest.useFakeTimers();
        manager = new BoardStateManager();
    });

    afterEach(() => {
        manager.destroy();
        jest.useRealTimers();
    });

    describe('getOrCreateBoard', () => {
        it('should create a new board entry', () => {
            const board = manager.getOrCreateBoard('test-board');

            expect(board).toBeDefined();
            expect(board.boardId).toBe('test-board');
            expect(board.online).toBe(false);
            expect(board.clients).toBeInstanceOf(Set);
        });

        it('should return existing board', () => {
            const board1 = manager.getOrCreateBoard('test-board');
            board1.online = true;

            const board2 = manager.getOrCreateBoard('test-board');

            expect(board2.online).toBe(true);
            expect(board1).toBe(board2);
        });
    });

    describe('updateState', () => {
        it('should update board state', () => {
            const stateMsg = {
                board_id: 'test-board',
                online: true,
                dac: { dac1: 2048, dac2: 1024 },
            };

            manager.updateState('test-board', stateMsg);
            const board = manager.getBoard('test-board');

            expect(board.online).toBe(true);
            expect(board.lastState).toEqual(stateMsg);
        });

        it('should emit stateUpdate event', () => {
            const listener = jest.fn();
            manager.on('stateUpdate', listener);

            manager.updateState('test-board', { online: true });

            expect(listener).toHaveBeenCalled();
        });

        it('should emit statusChange on online status change', () => {
            const listener = jest.fn();
            manager.on('statusChange', listener);

            manager.updateState('test-board', { online: true });
            manager.updateState('test-board', { online: false });

            expect(listener).toHaveBeenCalledTimes(2);
        });
    });

    describe('updateTelemetry', () => {
        it('should update telemetry data', () => {
            const telemetry = {
                adc: [100, 200, 300, 400, 500, 600],
                temp: 25.5,
            };

            manager.updateTelemetry('test-board', telemetry);
            const board = manager.getBoard('test-board');

            expect(board.lastTelemetry).toEqual(telemetry);
            expect(board.online).toBe(true);
        });

        it('should mark board online if receiving telemetry', () => {
            manager.updateTelemetry('test-board', { adc: [0] });
            const board = manager.getBoard('test-board');

            expect(board.online).toBe(true);
        });
    });

    describe('markOffline', () => {
        it('should mark board as offline', () => {
            manager.updateState('test-board', { online: true });
            manager.markOffline('test-board', 'timeout');

            const board = manager.getBoard('test-board');
            expect(board.online).toBe(false);
        });

        it('should emit statusChange event', () => {
            const listener = jest.fn();
            manager.on('statusChange', listener);

            manager.updateState('test-board', { online: true });
            manager.markOffline('test-board', 'lwt');

            expect(listener).toHaveBeenCalledWith(
                expect.objectContaining({ online: false, reason: 'lwt' })
            );
        });
    });

    describe('timeout detection', () => {
        it('should mark offline after timeout', () => {
            manager.updateTelemetry('test-board', { adc: [0] });

            expect(manager.getBoard('test-board').online).toBe(true);

            jest.advanceTimersByTime(10001);

            expect(manager.getBoard('test-board').online).toBe(false);
        });

        it('should reset timeout on new telemetry', () => {
            manager.updateTelemetry('test-board', { adc: [0] });

            jest.advanceTimersByTime(5000);
            manager.updateTelemetry('test-board', { adc: [1] });
            jest.advanceTimersByTime(5000);

            expect(manager.getBoard('test-board').online).toBe(true);
        });
    });

    describe('client management', () => {
        it('should add clients to board', () => {
            manager.addClient('test-board', 'client-1');
            manager.addClient('test-board', 'client-2');

            const board = manager.getBoard('test-board');
            expect(board.clients).toBe(2);
        });

        it('should remove client from board', () => {
            manager.addClient('test-board', 'client-1');
            manager.removeClient('test-board', 'client-1');

            const board = manager.getBoard('test-board');
            expect(board.clients).toBe(0);
        });

        it('should remove client from all boards', () => {
            manager.addClient('board-1', 'client-1');
            manager.addClient('board-2', 'client-1');

            manager.removeClientFromAll('client-1');

            expect(manager.getBoard('board-1').clients).toBe(0);
            expect(manager.getBoard('board-2').clients).toBe(0);
        });
    });

    describe('getModbusState', () => {
        it('should return formatted state for Modbus', () => {
            manager.updateState('test-board', {
                online: true,
                dac: { dac1: 2048, dac2: 1024 },
                actuators: { led6: true },
                latency_ms: 500,
            });
            manager.updateTelemetry('test-board', {
                adc: [100, 200, 300, 400, 500, 600],
                temp: 25.5,
                humid: 50,
            });

            const modbusState = manager.getModbusState('test-board');

            expect(modbusState).toEqual({
                online: true,
                adc: [100, 200, 300, 400, 500, 600],
                dac: { dac1: 2048, dac2: 1024 },
                actuators: { led6: true },
                temp: 25.5,
                humid: 50,
                latency_ms: 500,
            });
        });

        it('should return null for unknown board', () => {
            expect(manager.getModbusState('unknown')).toBeNull();
        });
    });
});
