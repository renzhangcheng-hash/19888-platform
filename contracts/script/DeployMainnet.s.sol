// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {LuckyPool} from "../src/LuckyPool.sol";
import {AntiScoreBet} from "../src/AntiScoreBet.sol";
import {ScoreBet} from "../src/ScoreBet.sol";
import {ChampionBet} from "../src/ChampionBet.sol";
import {AIVault} from "../src/AIVault.sol";
import {RevenueShare} from "../src/RevenueShare.sol";
import {VIPStaking} from "../src/VIPStaking.sol";

/// @notice Mainnet deployment — uses real BSC USDT (0x55d398326f99059fF775485246999027B3197955)
contract DeployMainnet is Script {
    // BSC USDT (18 decimals, official Binance-peg)
    address constant BSC_USDT = 0x55d398326f99059fF775485246999027B3197955;

    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        vm.startBroadcast(deployerKey);

        console.log("Deployer:", deployer);
        console.log("USDT (BSC):", BSC_USDT);

        // 1. LuckyPool
        LuckyPool poolImpl = new LuckyPool();
        console.log("LuckyPool impl:", address(poolImpl));

        ERC1967Proxy poolProxy = new ERC1967Proxy(
            address(poolImpl),
            abi.encodeCall(LuckyPool.initialize, BSC_USDT)
        );
        LuckyPool pool = LuckyPool(address(poolProxy));
        console.log("LuckyPool proxy:", address(pool));

        // 2. AntiScoreBet
        AntiScoreBet antiImpl = new AntiScoreBet();
        ERC1967Proxy antiProxy = new ERC1967Proxy(
            address(antiImpl),
            abi.encodeCall(AntiScoreBet.initialize, address(pool))
        );
        console.log("AntiScoreBet:", address(antiProxy));

        // 3. ScoreBet
        ScoreBet scoreImpl = new ScoreBet();
        ERC1967Proxy scoreProxy = new ERC1967Proxy(
            address(scoreImpl),
            abi.encodeCall(ScoreBet.initialize, address(pool))
        );
        console.log("ScoreBet:", address(scoreProxy));

        // 4. ChampionBet
        ChampionBet champImpl = new ChampionBet();
        ERC1967Proxy champProxy = new ERC1967Proxy(
            address(champImpl),
            abi.encodeCall(ChampionBet.initialize, address(pool))
        );
        console.log("ChampionBet:", address(champProxy));

        // 5. AIVault
        AIVault vaultImpl = new AIVault();
        ERC1967Proxy vaultProxy = new ERC1967Proxy(
            address(vaultImpl),
            abi.encodeCall(AIVault.initialize, address(pool))
        );
        console.log("AIVault:", address(vaultProxy));

        // 6. RevenueShare
        RevenueShare revImpl = new RevenueShare();
        ERC1967Proxy revProxy = new ERC1967Proxy(
            address(revImpl),
            abi.encodeCall(RevenueShare.initialize, address(pool))
        );
        console.log("RevenueShare:", address(revProxy));

        // 7. VIPStaking
        VIPStaking vipImpl = new VIPStaking();
        ERC1967Proxy vipProxy = new ERC1967Proxy(
            address(vipImpl),
            abi.encodeCall(VIPStaking.initialize, ())
        );
        console.log("VIPStaking:", address(vipProxy));

        // Authorize betting contracts
        pool.setAuthorizedContract(address(antiProxy), true);
        pool.setAuthorizedContract(address(scoreProxy), true);
        pool.setAuthorizedContract(address(champProxy), true);

        vm.stopBroadcast();

        console.log("\n=== BSC MAINNET Deployment Summary ===");
        console.log("LuckyPool:", address(poolProxy));
        console.log("AntiScoreBet:", address(antiProxy));
        console.log("ScoreBet:", address(scoreProxy));
        console.log("ChampionBet:", address(champProxy));
        console.log("AIVault:", address(vaultProxy));
        console.log("RevenueShare:", address(revProxy));
        console.log("VIPStaking:", address(vipProxy));
        console.log("");
        console.log("Copy these addresses to js/web3.js mainnet config.");
    }
}
