import mqtt from 'mqtt';
import { logger } from '../utils/logger.js';
import config from '../config/index.js';

/**
 * MqttHandler - Manages MQTT connection and message handling
 */
export class MqttHandler {
    constructor(stateManager) {
        this.stateManager = stateManager;
        this.client = null;
        this.connected = false;
        this.topicPrefix = config.board.topicPrefix;
    }

    /**
     * Connect to MQTT broker
     */
    async connect() {
        return new Promise((resolve, reject) => {
            const options = {
                clientId: config.mqtt.clientId,
                reconnectPeriod: config.mqtt.reconnectPeriod,
                connectTimeout: config.mqtt.connectTimeout,
                clean: true,
            };

            if (config.mqtt.username) {
                options.username = config.mqtt.username;
                options.password = config.mqtt.password;
            }

            logger.info(`Connecting to MQTT broker: ${config.mqtt.url}`);
            this.client = mqtt.connect(config.mqtt.url, options);

            this.client.on('connect', () => {
                this.connected = true;
                logger.info('Connected to MQTT broker');
                this.subscribeToTopics();
                resolve();
            });

            this.client.on('error', (err) => {
                logger.error('MQTT connection error:', err);
                if (!this.connected) {
                    reject(err);
                }
            });

            this.client.on('close', () => {
                this.connected = false;
                logger.warn('MQTT connection closed');
            });

            this.client.on('reconnect', () => {
                logger.info('Attempting MQTT reconnection...');
            });

            this.client.on('message', (topic, payload) => {
                this.handleMessage(topic, payload);
            });

            // Timeout for initial connection
            setTimeout(() => {
                if (!this.connected) {
                    reject(new Error('MQTT connection timeout'));
                }
            }, config.mqtt.connectTimeout);
        });
    }

    /**
     * Subscribe to all relevant STM32 topics
     */
    subscribeToTopics() {
        const topics = [
            `${this.topicPrefix}/+/telemetry`,
            `${this.topicPrefix}/+/state`,
            `${this.topicPrefix}/+/status`,
        ];

        topics.forEach((topic) => {
            this.client.subscribe(topic, { qos: 1 }, (err) => {
                if (err) {
                    logger.error(`Failed to subscribe to ${topic}:`, err);
                } else {
                    logger.info(`Subscribed to topic: ${topic}`);
                }
            });
        });
    }

    /**
     * Handle incoming MQTT messages
     */
    handleMessage(topic, payload) {
        try {
            const msg = JSON.parse(payload.toString());
            const parts = topic.split('/');

            if (parts.length < 3) {
                logger.warn(`Invalid topic format: ${topic}`);
                return;
            }

            const boardId = parts[1];
            const type = parts[2];

            switch (type) {
                case 'telemetry':
                    this.stateManager.updateTelemetry(boardId, msg);
                    break;

                case 'state':
                    this.stateManager.updateState(boardId, msg);
                    break;

                case 'status':
                    // Handle LWT or status updates
                    if (msg.online === false) {
                        this.stateManager.markOffline(boardId, 'lwt');
                    } else if (msg.online === true) {
                        this.stateManager.updateState(boardId, msg);
                    }
                    break;

                default:
                    logger.debug(`Unknown topic type: ${type}`);
            }
        } catch (err) {
            logger.error('Failed to parse MQTT message:', {
                topic,
                error: err.message,
            });
        }
    }

    /**
     * Publish command to board
     */
    publishCommand(boardId, command) {
        return new Promise((resolve, reject) => {
            if (!this.connected) {
                reject(new Error('MQTT not connected'));
                return;
            }

            const topic = `${this.topicPrefix}/${boardId}/commands`;
            const payload = JSON.stringify(command);

            this.client.publish(topic, payload, { qos: 1 }, (err) => {
                if (err) {
                    logger.error(`Failed to publish command to ${boardId}:`, err);
                    reject(err);
                } else {
                    logger.debug(`Command published to ${boardId}:`, command);
                    resolve();
                }
            });
        });
    }

    /**
     * Get connection status
     */
    isConnected() {
        return this.connected;
    }

    /**
     * Disconnect from MQTT broker
     */
    async disconnect() {
        return new Promise((resolve) => {
            if (this.client) {
                this.client.end(true, {}, () => {
                    logger.info('Disconnected from MQTT broker');
                    resolve();
                });
            } else {
                resolve();
            }
        });
    }
}

export default MqttHandler;
