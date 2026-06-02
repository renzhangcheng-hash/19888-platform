#!/bin/bash
# 1688 Platform Deployment
# One-command deploy to Render.com
set -e

echo "🏆 1688 部署脚本"
echo "================="
echo ""

# Check if gh CLI exists
if command -v gh &>/dev/null; then
  echo "✅ GitHub CLI found"
else
  echo "⚠️  GitHub CLI not installed. Install with: brew install gh"
  echo "   Then run: gh auth login"
  echo ""
  echo "Alternatively, create a repo manually at:"
  echo "   https://github.com/new"
  echo "   Then run: git remote add origin <your-repo-url>"
  echo "   And:      git push -u origin main"
  exit 1
fi

# Create GitHub repo
echo "📦 Creating GitHub repository..."
gh repo create 1688-platform --public --source=. --remote=origin --push 2>/dev/null || {
  echo "⚠️  Repo may already exist, pushing..."
  git push -u origin main
}

echo ""
echo "✅ Code pushed to GitHub!"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  NEXT STEP: Deploy on Render.com"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "1. Go to https://dashboard.render.com"
echo "2. Sign up (free) with GitHub"
echo "3. Click 'New Web Service'"
echo "4. Select '1688-platform' repo"
echo "5. Settings:"
echo "   - Build Command: npm install"
echo "   - Start Command: node backend/server.js"
echo "6. Click 'Create Web Service'"
echo ""
echo "That's it! Your platform will be live in 2 minutes."
echo ""
echo "Admin panel: https://YOUR-APP.onrender.com/admin.html"
echo "Username: admin"
echo "Password: 1688admin"
