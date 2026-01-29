# Deployment Guide

## Development Setup

### Prerequisites

- Node.js 18 or later
- Docker (for MQTT broker)
- npm or yarn

### Quick Start

```bash
# Clone and install
cd mqtt-server/server
npm install

# Copy and configure environment
cp .env.example .env

# Start MQTT broker
docker run -d --name mosquitto -p 1883:1883 -p 9001:9001 eclipse-mosquitto

# Start development server
npm run dev
```

## Production Deployment

### Docker Compose (Recommended)

1. **Configure environment**

Create `.env` file in project root:
```bash
JWT_SECRET=your-secure-random-string-at-least-32-chars
```

2. **Start services**

```bash
# Basic deployment (Mosquitto + Bridge)
docker-compose up -d

# With Redis for horizontal scaling
docker-compose --profile with-redis up -d

# With Nginx reverse proxy
docker-compose --profile with-nginx up -d

# All services
docker-compose --profile with-redis --profile with-nginx up -d
```

3. **Verify deployment**

```bash
# Check service status
docker-compose ps

# Check health
curl http://localhost:3000/health

# View logs
docker-compose logs -f bridge
```

### Manual Deployment

1. **Install Node.js 18+**

```bash
# Ubuntu/Debian
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs
```

2. **Install dependencies**

```bash
cd server
npm ci --only=production
```

3. **Configure systemd service**

Create `/etc/systemd/system/stm32-bridge.service`:
```ini
[Unit]
Description=STM32 Bridge Server
After=network.target mosquitto.service

[Service]
Type=simple
User=stm32
WorkingDirectory=/opt/stm32-bridge/server
ExecStart=/usr/bin/node src/server.js
Restart=on-failure
RestartSec=10
Environment=NODE_ENV=production
EnvironmentFile=/opt/stm32-bridge/.env

[Install]
WantedBy=multi-user.target
```

4. **Enable and start**

```bash
sudo systemctl daemon-reload
sudo systemctl enable stm32-bridge
sudo systemctl start stm32-bridge
```

## TLS/HTTPS Configuration

### With Nginx

1. **Obtain certificates** (Let's Encrypt example)

```bash
sudo apt install certbot
sudo certbot certonly --standalone -d yourdomain.com
```

2. **Configure Nginx**

Create `nginx/nginx.conf`:
```nginx
events {
    worker_connections 1024;
}

http {
    upstream bridge {
        server bridge:3000;
    }

    server {
        listen 80;
        server_name yourdomain.com;
        return 301 https://$server_name$request_uri;
    }

    server {
        listen 443 ssl http2;
        server_name yourdomain.com;

        ssl_certificate /etc/nginx/certs/fullchain.pem;
        ssl_certificate_key /etc/nginx/certs/privkey.pem;

        location / {
            root /usr/share/nginx/html;
            try_files $uri $uri/ /index.html;
        }

        location /ws {
            proxy_pass http://bridge;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "upgrade";
            proxy_set_header Host $host;
        }

        location /api {
            proxy_pass http://bridge;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
        }
    }
}
```

## Monitoring

### Prometheus + Grafana

1. **Add Prometheus scrape config**

```yaml
scrape_configs:
  - job_name: 'stm32-bridge'
    static_configs:
      - targets: ['localhost:3000']
    metrics_path: '/metrics'
```

2. **Import Grafana dashboard**

Available metrics:
- `stm32_bridge_mqtt_messages_received_total`
- `stm32_bridge_websocket_connections`
- `stm32_bridge_boards_online`
- `stm32_bridge_commands_processed_total`
- `stm32_bridge_modbus_requests_total`

### Health Checks

```bash
# HTTP health endpoint
curl http://localhost:3000/health

# Docker health check (built-in)
docker inspect --format='{{.State.Health.Status}}' stm32-bridge
```

## Backup & Recovery

### Data to backup

- `mosquitto/data/` - MQTT persistence
- `server/logs/` - Application and audit logs
- `.env` - Configuration

### Restore procedure

1. Stop services: `docker-compose down`
2. Restore data files
3. Start services: `docker-compose up -d`

## Troubleshooting

### MQTT connection issues

```bash
# Test MQTT connectivity
mosquitto_pub -h localhost -t test -m "hello"
mosquitto_sub -h localhost -t test

# Check broker logs
docker-compose logs mosquitto
```

### WebSocket issues

```bash
# Test WebSocket connection
wscat -c ws://localhost:3000/ws
```

### Modbus issues

```bash
# Test Modbus (requires modbus-cli or similar)
modbus -t tcp -h localhost -p 502 -a 1 -r 0 -c 6
```
