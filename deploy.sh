#!/bin/bash
# 19888 Deploy Script — auto-zip → Desktop
cd /Users/jack/Desktop/19888-platform
rm -f /Users/jack/Desktop/19888-deploy.zip
zip -r /Users/jack/Desktop/19888-deploy.zip . \
  -x ".git/*" "node_modules/*" ".hermes/*" "*.log" \
  "backend/data/*.json" "backend/node_modules/*" \
  "contracts/lib/*" ".env*" \
  -q
echo "✅ /Users/jack/Desktop/19888-deploy.zip ($(ls -lh /Users/jack/Desktop/19888-deploy.zip | awk '{print $5}'))"
echo "👉 拖入 https://app.netlify.com/drop"
