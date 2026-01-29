import winston from 'winston';
import config from '../config/index.js';

const { combine, timestamp, printf, colorize, errors } = winston.format;

// Custom log format
const logFormat = printf(({ level, message, timestamp, stack, ...meta }) => {
    let log = `${timestamp} [${level}]: ${message}`;

    if (Object.keys(meta).length > 0) {
        log += ` ${JSON.stringify(meta)}`;
    }

    if (stack) {
        log += `\n${stack}`;
    }

    return log;
});

// Create logger instance
export const logger = winston.createLogger({
    level: config.logLevel,
    format: combine(
        errors({ stack: true }),
        timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
        logFormat
    ),
    defaultMeta: { service: 'stm32-bridge' },
    transports: [
        // Console transport
        new winston.transports.Console({
            format: combine(
                colorize(),
                timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
                logFormat
            ),
        }),
        // File transport for errors
        new winston.transports.File({
            filename: 'logs/error.log',
            level: 'error',
            maxsize: 5242880, // 5MB
            maxFiles: 5,
        }),
        // File transport for all logs
        new winston.transports.File({
            filename: 'logs/combined.log',
            maxsize: 5242880, // 5MB
            maxFiles: 5,
        }),
    ],
});

// Create audit logger for commands
export const auditLogger = winston.createLogger({
    level: 'info',
    format: combine(
        timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
        winston.format.json()
    ),
    defaultMeta: { type: 'audit' },
    transports: [
        new winston.transports.File({
            filename: 'logs/audit.log',
            maxsize: 10485760, // 10MB
            maxFiles: 10,
        }),
    ],
});

// Log command audit entry
export function logCommandAudit(entry) {
    auditLogger.info('command', {
        reqId: entry.reqId,
        boardId: entry.boardId,
        cmd: entry.cmd,
        value: entry.value,
        origin: entry.origin,
        timestamp: entry.ts || Date.now(),
        result: entry.result || 'pending',
    });
}

export default logger;
