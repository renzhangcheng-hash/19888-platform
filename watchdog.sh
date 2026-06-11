#!/bin/bash
# 19888 Backend Watchdog — 2min心跳 + 自动重启
# 运行: nohup bash watchdog.sh > /tmp/19888_watchdog.log 2>&1 &

set -e
PORT=3088
HEALTH_URL="http://localhost:${PORT}/api/status"
SERVER_DIR="/Users/jack/Desktop/19888-platform/backend"
NODE_BIN="$(which node)"
LOG="/tmp/19888_server.log"

log() { echo "[$(date '+%m-%d %H:%M:%S')] $1"; }

while true; do
    sleep 120  # 2min heartbeat
    
    # Check if server is running
    if curl -s --max-time 5 "$HEALTH_URL" | grep -q '"ok"'; then
        continue  # Healthy
    fi
    
    log "⚠  Backend unresponsive → restarting..."
    
    # Kill old instance
    pkill -f "node.*server.js" 2>/dev/null || true
    sleep 2
    
    # Restart
    cd "$SERVER_DIR"
    nohup "$NODE_BIN" server.js > "$LOG" 2>&1 &
    sleep 3
    
    # Verify
    if curl -s --max-time 5 "$HEALTH_URL" | grep -q '"ok"'; then
        log "✓  Backend restarted successfully PID=$(pgrep -f 'node.*server.js' | head -1)"
    else
        log "✗  Backend restart FAILED!"
    fi
done
