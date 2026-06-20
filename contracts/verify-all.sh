#!/bin/bash
# 19888 BSC Contract Verification Script
# Usage: BSCSCAN_API_KEY=xxx bash verify-all.sh

set -e
API_KEY="${BSCSCAN_API_KEY}"
if [ -z "$API_KEY" ]; then
  echo "❌ Set BSCSCAN_API_KEY env var"
  exit 1
fi

export PATH="$HOME/.foundry/bin:$PATH"
cd "$(dirname "$0")/contracts"

echo "🔍 Verifying 7 contracts on BSC Mainnet..."
echo ""

# 1. LuckyPool
forge verify-contract 0x07Dbf04Db72Ebd0D6a9488cC90934B046C2092e2 src/LuckyPool.sol:LuckyPool \
  --verifier-url https://api.bscscan.com/api \
  --etherscan-api-key "$API_KEY" --chain 56 && echo "✅ LuckyPool"

# 2. AntiScoreBet
forge verify-contract 0xc7aE31441B72D40F7EAc9AFBc6adC30D8692caEd src/AntiScoreBet.sol:AntiScoreBet \
  --verifier-url https://api.bscscan.com/api \
  --etherscan-api-key "$API_KEY" --chain 56 && echo "✅ AntiScoreBet"

# 3. ScoreBet
forge verify-contract 0xc64E68996b39de6a09A572d35f144Ff5ae891457 src/ScoreBet.sol:ScoreBet \
  --verifier-url https://api.bscscan.com/api \
  --etherscan-api-key "$API_KEY" --chain 56 && echo "✅ ScoreBet"

# 4. ChampionBet
forge verify-contract 0xeBF0EcF53c420C3cA85e20f51e13eb5C51BfCF3a src/ChampionBet.sol:ChampionBet \
  --verifier-url https://api.bscscan.com/api \
  --etherscan-api-key "$API_KEY" --chain 56 && echo "✅ ChampionBet"

# 5. AIVault
forge verify-contract 0x7E6E5506D36aB213E8Df121490A25aE47Ca825Ea src/AIVault.sol:AIVault \
  --verifier-url https://api.bscscan.com/api \
  --etherscan-api-key "$API_KEY" --chain 56 && echo "✅ AIVault"

# 6. RevenueShare
forge verify-contract 0x6DeDbba70e0110B220234404Ba6b41D77e16F709 src/RevenueShare.sol:RevenueShare \
  --verifier-url https://api.bscscan.com/api \
  --etherscan-api-key "$API_KEY" --chain 56 && echo "✅ RevenueShare"

# 7. VIPStaking
forge verify-contract 0x99d1DDce8aDC1946f265CB4e75529AC372851A48 src/VIPStaking.sol:VIPStaking \
  --verifier-url https://api.bscscan.com/api \
  --etherscan-api-key "$API_KEY" --chain 56 && echo "✅ VIPStaking"

echo ""
echo "🎉 All 7 contracts verified on BscScan!"
