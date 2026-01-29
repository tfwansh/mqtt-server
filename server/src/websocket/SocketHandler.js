import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { logger, logCommandAudit } from '../utils/logger.js';
import config from '../config/index.js';

/**
 * SocketHandler - Manages WebSocket connections and client communication
 */
export class SocketHandler {
    constructor(httpServer, stateManager, mqttHandler) {
        this.stateManager = stateManager;
        this.mqttHandler = mqttHandler;
        this.io = null;
        this.clientRateLimits = new Map(); // socketId -> { count, resetTime }

        this.initializeServer(httpServer);
        this.setupStateListeners();
    }

    /**
     * Initialize Socket.io server
     */
    initializeServer(httpServer) {
        this.io = new Server(httpServer, {
            path: '/ws',
            cors: {
                origin: config.corsOrigins,
                methods: ['GET', 'POST'],
                credentials: true,
            },
            pingTimeout: 60000,
            pingInterval: 25000,
        });

        // Authentication middleware (optional - can be disabled in dev)
        if (config.nodeEnv === 'production') {
            this.io.use((socket, next) => {
                this.authenticateSocket(socket, next);
            });
        }

        this.io.on('connection', (socket) => {
            this.handleConnection(socket);
        });

        logger.info('Socket.io server initialized');
    }

    /**
     * Authenticate socket connection
     */
    authenticateSocket(socket, next) {
        const token = socket.handshake.auth?.token || socket.handshake.query?.token;

        if (!token) {
            // Allow connection without token in dev mode
            if (config.nodeEnv !== 'production') {
                socket.user = { id: 'anonymous', role: 'user' };
                return next();
            }
            return next(new Error('Authentication required'));
        }

        try {
            const decoded = jwt.verify(token, config.jwt.secret);
            socket.user = decoded;
            next();
        } catch (err) {
            logger.warn('Socket authentication failed:', err.message);
            next(new Error('Invalid token'));
        }
    }

    /**
     * Handle new socket connection
     */
    handleConnection(socket) {
        logger.info(`Client connected: ${socket.id}`);

        // Set up event handlers
        socket.on('join', (data) => this.handleJoin(socket, data));
        socket.on('leave', (data) => this.handleLeave(socket, data));
        socket.on('command', (data) => this.handleCommand(socket, data));
        socket.on('getState', (data) => this.handleGetState(socket, data));
        socket.on('listBoards', () => this.handleListBoards(socket));
        socket.on('disconnect', () => this.handleDisconnect(socket));
    }

    /**
     * Handle join room request
     */
    handleJoin(socket, { boardId }) {
        if (!boardId) {
            socket.emit('error', { message: 'boardId is required' });
            return;
        }

        // Join socket.io room for this board
        socket.join(boardId);

        // Track client in state manager
        this.stateManager.addClient(boardId, socket.id);

        // Store board association on socket
        if (!socket.boards) socket.boards = new Set();
        socket.boards.add(boardId);

        // Send current state immediately
        const board = this.stateManager.getBoard(boardId);
        socket.emit('state', {
            boardId,
            online: board?.online || false,
            lastState: board?.lastState || null,
            lastTelemetry: board?.lastTelemetry || null,
            lastCmd: board?.lastCmd || null,
        });

        logger.debug(`Client ${socket.id} joined board ${boardId}`);
    }

    /**
     * Handle leave room request
     */
    handleLeave(socket, { boardId }) {
        if (!boardId) return;

        socket.leave(boardId);
        this.stateManager.removeClient(boardId, socket.id);

        if (socket.boards) {
            socket.boards.delete(boardId);
        }

        logger.debug(`Client ${socket.id} left board ${boardId}`);
    }

    /**
     * Handle command request with rate limiting
     */
    async handleCommand(socket, { boardId, cmd, value, origin, reqId }) {
        logger.info(`[COMMAND] Received from client ${socket.id}: boardId=${boardId}, cmd=${cmd}, value=${value}`);

        // Validate required fields
        if (!boardId || !cmd) {
            logger.warn(`[COMMAND] Missing required fields: boardId=${boardId}, cmd=${cmd}`);
            socket.emit('error', { message: 'boardId and cmd are required' });
            return;
        }

        // Rate limiting
        if (!this.checkRateLimit(socket.id)) {
            logger.warn(`[COMMAND] Rate limit exceeded for client ${socket.id}`);
            socket.emit('error', { message: 'Rate limit exceeded' });
            return;
        }

        // Generate reqId if not provided
        const commandReqId = reqId || uuidv4();
        const commandOrigin = origin || socket.user?.id || `client:${socket.id.slice(0, 8)}`;

        // Build command payload
        const command = {
            cmd,
            value,
            origin: commandOrigin,
            reqId: commandReqId,
            ts: Date.now(),
        };

        logger.debug(`[COMMAND] Built command payload:`, command);

        // Validate command
        const validationError = this.validateCommand(command);
        if (validationError) {
            logger.warn(`[COMMAND] Validation failed: ${validationError}`);
            socket.emit('command_ack', { reqId: commandReqId, ok: false, error: validationError });
            return;
        }

        try {
            // Publish to MQTT
            logger.info(`[COMMAND] Publishing to MQTT topic stm32/${boardId}/commands`);
            await this.mqttHandler.publishCommand(boardId, command);
            logger.info(`[COMMAND] Successfully published to MQTT`);

            // Update state manager
            this.stateManager.updateLastCommand(boardId, command);

            // Log audit entry
            logCommandAudit({
                reqId: commandReqId,
                boardId,
                cmd,
                value,
                origin: commandOrigin,
                ts: command.ts,
                result: 'published',
            });

            // Acknowledge to sender
            socket.emit('command_ack', { reqId: commandReqId, ok: true, ts: command.ts });
            logger.debug(`[COMMAND] ACK sent to client`);

            // Broadcast command update to all clients in the room
            this.io.to(boardId).emit('command_update', {
                boardId,
                lastCmd: command,
            });

            logger.info(`[COMMAND] ✓ Command sent to ${boardId}: ${cmd}=${value}`);
        } catch (err) {
            logger.error(`[COMMAND] ✗ Failed to send command:`, err);
            socket.emit('command_ack', { reqId: commandReqId, ok: false, error: 'publish_failed' });

            logCommandAudit({
                reqId: commandReqId,
                boardId,
                cmd,
                value,
                origin: commandOrigin,
                ts: command.ts,
                result: 'failed',
            });
        }
    }

    /**
     * Validate command data
     */
    validateCommand(command) {
        const { cmd, value } = command;

        // Validate command type
        const validCommands = ['DAC1', 'DAC2', 'LED6', 'LATENCY'];

        if (!validCommands.includes(cmd.toUpperCase())) {
            return `Invalid command: ${cmd}`;
        }

        // Validate value ranges
        if (cmd.toUpperCase().startsWith('DAC')) {
            if (typeof value !== 'number' || value < 0 || value > 4095) {
                return 'DAC value must be 0-4095';
            }
        }

        if (cmd.toUpperCase() === 'LED6') {
            if (typeof value !== 'boolean' && value !== 0 && value !== 1) {
                return 'LED value must be boolean or 0/1';
            }
        }

        if (cmd.toUpperCase() === 'LATENCY') {
            if (typeof value !== 'number' || value < 100 || value > 60000) {
                return 'Latency must be 100-60000 ms';
            }
        }

        return null;
    }

    /**
     * Rate limiting check
     */
    checkRateLimit(socketId) {
        const now = Date.now();
        let limit = this.clientRateLimits.get(socketId);

        if (!limit || now > limit.resetTime) {
            limit = {
                count: 0,
                resetTime: now + config.rateLimit.windowMs,
            };
        }

        limit.count++;
        this.clientRateLimits.set(socketId, limit);

        return limit.count <= config.rateLimit.maxRequests;
    }

    /**
     * Handle get state request
     */
    handleGetState(socket, { boardId }) {
        const board = this.stateManager.getBoard(boardId);
        socket.emit('state', {
            boardId,
            online: board?.online || false,
            lastState: board?.lastState || null,
            lastTelemetry: board?.lastTelemetry || null,
            lastCmd: board?.lastCmd || null,
        });
    }

    /**
     * Handle list boards request
     */
    handleListBoards(socket) {
        const boards = this.stateManager.getAllBoards();
        socket.emit('boards', boards);
    }

    /**
     * Handle socket disconnect
     */
    handleDisconnect(socket) {
        // Remove from all boards
        this.stateManager.removeClientFromAll(socket.id);

        // Clean up rate limit entry
        this.clientRateLimits.delete(socket.id);

        logger.info(`Client disconnected: ${socket.id}`);
    }

    /**
     * Set up state manager event listeners
     */
    setupStateListeners() {
        this.stateManager.on('stateUpdate', ({ boardId, state }) => {
            this.io.to(boardId).emit('state', {
                boardId,
                online: state.online,
                lastState: state.lastState,
                lastTelemetry: state.lastTelemetry,
                lastCmd: state.lastCmd,
            });
        });

        this.stateManager.on('telemetryUpdate', ({ boardId, telemetry }) => {
            this.io.to(boardId).emit('telemetry', { boardId, telemetry });
        });

        this.stateManager.on('statusChange', ({ boardId, online, reason }) => {
            this.io.to(boardId).emit('status', { boardId, online, reason });
        });

        this.stateManager.on('commandUpdate', ({ boardId, lastCmd }) => {
            this.io.to(boardId).emit('command_update', { boardId, lastCmd });
        });
    }

    /**
     * Get connection statistics
     */
    getStats() {
        return {
            connectedClients: this.io.engine.clientsCount,
            rooms: this.io.sockets.adapter.rooms.size,
        };
    }

    /**
     * Clean up resources
     */
    async close() {
        return new Promise((resolve) => {
            this.io.close(() => {
                logger.info('Socket.io server closed');
                resolve();
            });
        });
    }
}

export default SocketHandler;
