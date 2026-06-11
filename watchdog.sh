#!/bin/bash
# 19888 Backend + Tunnel Watchdog
# Keeps backend and Cloudflare tunnel alive. Run via cron every 2 minutes.

LOG="/tmp/19888_watchdog.log"
BACKEND_PORT=3088

# Check backend
if ! curl -s -m 5 http://localhost:${BACKEND_PORT}/api/status > /dev/null 2>&1; then
  echo "[$(date)] Backend dead, restarting..." >> "$LOG"
  # Kill stale processes
  pkill -f "node backend/server.js" 2>/dev/null
  sleep 2
  # Start backend
  cd /Users/jack/Desktop/19888-platform
  PORT=$BACKEND_PORT nohup node backend/server.js >> /tmp/19888_backend.log 2>&1 &
  sleep 3
fi

# Check tunnel
NEED_TUNNEL=false
if ! pgrep -f "cloudflared tunnel --url http://localhost:${BACKEND_PORT}" > /dev/null 2>&1; then
  NEED_TUNNEL=true
elif [ -f /tmp/19888_tunnel_url ]; then
  TUNNEL_URL=$(cat /tmp/19888_tunnel_url)
  if ! curl -s -m 10 "${TUNNEL_URL}/api/status" > /dev/null 2>&1; then
    NEED_TUNNEL=true
  fi
else
  NEED_TUNNEL=true
fi

if $NEED_TUNNEL; then
  echo "[$(date)] Tunnel dead, restarting..." >> "$LOG"
  pkill -f "cloudflared tunnel --url http://localhost:${BACKEND_PORT}" 2>/dev/null
  sleep 1
  # Start tunnel and capture URL
  cloudflared tunnel --url http://localhost:${BACKEND_PORT} 2>&1 | tee /tmp/19888_tunnel.log | grep -o 'https://[^.]*\.trycloudflare\.com' | head -1 > /tmp/19888_tunnel_url &
  echo "[$(date)] Tunnel started" >> "$LOG"
fi

# Trim log
tail -100 "$LOG" > "${LOG}.tmp" && mv "${LOG}.tmp" "$LOG"
