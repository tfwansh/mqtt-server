import express from 'express';
import http from 'http';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { fileURLToPath } from 'url';

import config from './config/index.js';
import { logger } from './utils/logger.js';
import { BoardStateManager } from './state/BoardStateManager.js';
import { MqttHandler } from './mqtt/MqttHandler.js';
import { SocketHandler } from './websocket/SocketHandler.js';
import { ModbusServer } from './modbus/ModbusServer.js';
import { createRouter } from './api/routes.js';
import { metrics } from './metrics/prometheus.js';

// ES module dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Main application class
 */
class BridgeServer {
    constructor() {
        this.app = express();
        this.server = http.createServer(this.app);
        this.stateManager = new BoardStateManager();
        this.mqttHandler = new MqttHandler(this.stateManager);
        this.socketHandler = null;
        this.modbusServer = null;
    }

    /**
     * Configure Express middleware
     */
    configureExpress() {
        // CORS
        this.app.use(cors({
            origin: config.corsOrigins,
            methods: ['GET', 'POST', 'PUT', 'DELETE'],
            credentials: true,
        }));

        // Body parsing
        this.app.use(express.json());
        this.app.use(express.urlencoded({ extended: true }));

        // Rate limiting for API routes
        const limiter = rateLimit({
            windowMs: config.rateLimit.windowMs,
            max: config.rateLimit.maxRequests,
            message: { error: 'Too many requests, please try again later' },
        });
        this.app.use('/api/', limiter);

        // Serve static dashboard files
        const dashboardPath = path.join(__dirname, '../../mqtt-dashboard');
        this.app.use(express.static(dashboardPath));

        // API routes
        const router = createRouter(this.stateManager, this.mqttHandler);
        this.app.use('/', router);

        // Error handler
        this.app.use((err, req, res, next) => {
            logger.error('Express error:', err);
            res.status(500).json({ error: 'Internal server error' });
        });
    }

    /**
     * Set up metrics collection
     */
    setupMetricsCollection() {
        // Track state manager events for metrics
        this.stateManager.on('stateUpdate', ({ boardId }) => {
            metrics.mqttMessagesReceived.inc({ topic_type: 'state', board_id: boardId });
        });

        this.stateManager.on('telemetryUpdate', ({ boardId }) => {
            metrics.mqttMessagesReceived.inc({ topic_type: 'telemetry', board_id: boardId });
            metrics.lastTelemetryTimestamp.set({ board_id: boardId }, Date.now());
        });

        this.stateManager.on('statusChange', () => {
            // Count online boards
            const boards = this.stateManager.getAllBoards();
            const onlineCount = Object.values(boards).filter(b => b.online).length;
            metrics.boardsOnline.set(onlineCount);
        });

        // Periodic WebSocket connection count update
        setInterval(() => {
            if (this.socketHandler) {
                const stats = this.socketHandler.getStats();
                metrics.websocketConnections.set(stats.connectedClients);
            }
        }, 5000);
    }

    /**
     * Start all services
     */
    async start() {
        try {
            logger.info('Starting STM32 Bridge Server...');

            // Configure Express
            this.configureExpress();

            // Connect to MQTT
            await this.mqttHandler.connect();

            // Initialize WebSocket handler
            this.socketHandler = new SocketHandler(
                this.server,
                this.stateManager,
                this.mqttHandler
            );

            // Initialize Modbus server
            this.modbusServer = new ModbusServer(this.stateManager, this.mqttHandler);
            await this.modbusServer.start();

            // Set up metrics collection
            this.setupMetricsCollection();

            // Start HTTP server
            this.server.listen(config.port, () => {
                logger.info(`Bridge server listening on port ${config.port}`);
                logger.info(`WebSocket path: /ws`);
                logger.info(`Dashboard: http://localhost:${config.port}`);
                logger.info(`Health: http://localhost:${config.port}/health`);
                logger.info(`Metrics: http://localhost:${config.port}/metrics`);
                if (config.modbus.enabled) {
                    logger.info(`Modbus TCP: port ${config.modbus.port}`);
                }
            });

            // Graceful shutdown handlers
            process.on('SIGTERM', () => this.shutdown());
            process.on('SIGINT', () => this.shutdown());

        } catch (err) {
            logger.error('Failed to start server:', err);
            process.exit(1);
        }
    }

    /**
     * Graceful shutdown
     */
    async shutdown() {
        logger.info('Shutting down...');

        try {
            // Close WebSocket connections
            if (this.socketHandler) {
                await this.socketHandler.close();
            }

            // Stop Modbus server
            if (this.modbusServer) {
                await this.modbusServer.stop();
            }

            // Disconnect MQTT
            await this.mqttHandler.disconnect();

            // Close HTTP server
            this.server.close(() => {
                logger.info('HTTP server closed');
                process.exit(0);
            });

            // Force exit after timeout
            setTimeout(() => {
                logger.warn('Forced shutdown after timeout');
                process.exit(1);
            }, 10000);

        } catch (err) {
            logger.error('Error during shutdown:', err);
            process.exit(1);
        }
    }
}

// Start the server
const server = new BridgeServer();
server.start();
