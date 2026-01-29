import express from 'express';
import jwt from 'jsonwebtoken';
import { promClient } from '../metrics/prometheus.js';
import config from '../config/index.js';
import { logger } from '../utils/logger.js';

/**
 * Create Express router with API endpoints
 */
export function createRouter(stateManager, mqttHandler) {
    const router = express.Router();

    // Health check endpoint
    router.get('/health', (req, res) => {
        const mqttConnected = mqttHandler.isConnected();
        const status = mqttConnected ? 'healthy' : 'degraded';

        res.status(mqttConnected ? 200 : 503).json({
            status,
            timestamp: new Date().toISOString(),
            mqtt: mqttConnected ? 'connected' : 'disconnected',
            uptime: process.uptime(),
        });
    });

    // Prometheus metrics endpoint
    router.get('/metrics', async (req, res) => {
        try {
            res.set('Content-Type', promClient.register.contentType);
            const metrics = await promClient.register.metrics();
            res.end(metrics);
        } catch (err) {
            logger.error('Metrics error:', err);
            res.status(500).end();
        }
    });

    // Get all boards
    router.get('/api/boards', authMiddleware, (req, res) => {
        const boards = stateManager.getAllBoards();
        res.json({ boards });
    });

    // Get specific board state
    router.get('/api/state/:boardId', authMiddleware, (req, res) => {
        const { boardId } = req.params;
        const board = stateManager.getBoard(boardId);

        if (!board) {
            return res.status(404).json({ error: 'Board not found' });
        }

        res.json({
            boardId,
            online: board.online,
            lastState: board.lastState,
            lastTelemetry: board.lastTelemetry,
            lastCmd: board.lastCmd,
            lastSeen: board.lastSeen,
        });
    });

    // Send command to board (REST alternative to WebSocket)
    router.post('/api/command/:boardId', authMiddleware, async (req, res) => {
        const { boardId } = req.params;
        const { cmd, value } = req.body;

        if (!cmd) {
            return res.status(400).json({ error: 'cmd is required' });
        }

        const command = {
            cmd,
            value,
            origin: `rest:${req.user?.id || 'anonymous'}`,
            reqId: `rest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            ts: Date.now(),
        };

        try {
            await mqttHandler.publishCommand(boardId, command);
            stateManager.updateLastCommand(boardId, command);

            res.json({
                success: true,
                reqId: command.reqId,
                message: 'Command published',
            });
        } catch (err) {
            logger.error('REST command failed:', err);
            res.status(500).json({ error: 'Failed to publish command' });
        }
    });

    // Generate auth token (for development/testing)
    router.post('/api/auth/token', (req, res) => {
        const { userId, role } = req.body;

        if (config.nodeEnv === 'production' && !req.body.apiKey) {
            return res.status(401).json({ error: 'API key required in production' });
        }

        const token = jwt.sign(
            { id: userId || 'user', role: role || 'user' },
            config.jwt.secret,
            { expiresIn: config.jwt.expiresIn }
        );

        res.json({ token, expiresIn: config.jwt.expiresIn });
    });

    return router;
}

/**
 * Authentication middleware
 */
function authMiddleware(req, res, next) {
    // Skip auth in development
    if (config.nodeEnv !== 'production') {
        req.user = { id: 'dev', role: 'admin' };
        return next();
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Authorization required' });
    }

    const token = authHeader.slice(7);
    try {
        const decoded = jwt.verify(token, config.jwt.secret);
        req.user = decoded;
        next();
    } catch (err) {
        res.status(401).json({ error: 'Invalid token' });
    }
}

export default createRouter;
