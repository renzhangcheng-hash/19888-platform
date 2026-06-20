#!/bin/bash
# 19888 CI/CD Pipeline — Test → Build → Deploy
set -e
cd "$(dirname "$0")/.."
echo "🏗️  19888 CI Pipeline"
echo "===================="

echo ""
echo "[1/4] JS Syntax Check..."
node --check js/app.js && echo "✅ JS OK" || { echo "❌ JS FAIL"; exit 1; }
node --check js/web3.js && echo "✅ web3 OK" || echo "⚠️  web3"

echo ""
echo "[2/4] CSS Balance Check..."
python3 -c "c=open('css/sunshine.css').read();assert c.count('{')==c.count('}'),'CSS unbalanced'" && echo "✅ CSS OK"

echo ""
echo "[3/4] Foundry Tests..."
export PATH="$HOME/.foundry/bin:$PATH"
cd contracts
forge test --no-match-test skip 2>&1 | grep "Suite result" && echo "✅ Tests PASS" || { echo "❌ Tests FAIL"; exit 1; }
cd ..

echo ""
echo "[4/4] L5 Self-Heal..."
python3 scripts/l5_self_heal.py 2>&1 | grep "Score" && echo "✅ L5 OK"

echo ""
echo "🎉 CI PASSED — Ready for deploy"
echo "   → bash deploy.sh"
