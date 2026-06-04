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

contract MockUSDT is Script {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    string public name = "Test USDT";
    string public symbol = "tUSDT";
    uint8 public decimals = 18;
    
    constructor() {
        balanceOf[msg.sender] = 1000000 ether;
    }
    
    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "insufficient");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
    
    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        if (allowance[from][msg.sender] < amount) revert("allowance");
        require(balanceOf[from] >= amount, "insufficient");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
    
    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }
}

contract DeployAll is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        
        vm.startBroadcast(deployerKey);
        
        console.log("Deployer:", deployer);
        
        // 1. Deploy Mock USDT (testnet only)
        MockUSDT usdt = new MockUSDT();
        console.log("MockUSDT deployed at:", address(usdt));
        
        // 2. Deploy LuckyPool implementation
        LuckyPool poolImpl = new LuckyPool();
        console.log("LuckyPool impl:", address(poolImpl));
        
        // 3. LuckyPool proxy
        ERC1967Proxy poolProxy = new ERC1967Proxy(
            address(poolImpl),
            abi.encodeCall(LuckyPool.initialize, address(usdt))
        );
        LuckyPool pool = LuckyPool(address(poolProxy));
        console.log("LuckyPool proxy:", address(pool));
        
        // 4. AntiScoreBet
        AntiScoreBet antiImpl = new AntiScoreBet();
        ERC1967Proxy antiProxy = new ERC1967Proxy(
            address(antiImpl),
            abi.encodeCall(AntiScoreBet.initialize, address(pool))
        );
        console.log("AntiScoreBet:", address(antiProxy));
        
        // 5. ScoreBet
        ScoreBet scoreImpl = new ScoreBet();
        ERC1967Proxy scoreProxy = new ERC1967Proxy(
            address(scoreImpl),
            abi.encodeCall(ScoreBet.initialize, address(pool))
        );
        console.log("ScoreBet:", address(scoreProxy));
        
        // 6. ChampionBet
        ChampionBet champImpl = new ChampionBet();
        ERC1967Proxy champProxy = new ERC1967Proxy(
            address(champImpl),
            abi.encodeCall(ChampionBet.initialize, address(pool))
        );
        console.log("ChampionBet:", address(champProxy));
        
        // 7. AIVault
        AIVault vaultImpl = new AIVault();
        ERC1967Proxy vaultProxy = new ERC1967Proxy(
            address(vaultImpl),
            abi.encodeCall(AIVault.initialize, address(pool))
        );
        console.log("AIVault:", address(vaultProxy));
        
        // 8. RevenueShare
        RevenueShare revImpl = new RevenueShare();
        ERC1967Proxy revProxy = new ERC1967Proxy(
            address(revImpl),
            abi.encodeCall(RevenueShare.initialize, address(pool))
        );
        console.log("RevenueShare:", address(revProxy));
        
        // 9. VIPStaking
        VIPStaking vipImpl = new VIPStaking();
        ERC1967Proxy vipProxy = new ERC1967Proxy(
            address(vipImpl),
            abi.encodeCall(VIPStaking.initialize, ())
        );
        console.log("VIPStaking:", address(vipProxy));
        
        vm.stopBroadcast();
        
        console.log("\n=== Deployment Summary ===");
        console.log("USDT:", address(usdt));
        console.log("LuckyPool:", address(poolProxy));
        console.log("AntiScoreBet:", address(antiProxy));
        console.log("ScoreBet:", address(scoreProxy));
        console.log("ChampionBet:", address(champProxy));
        console.log("AIVault:", address(vaultProxy));
        console.log("RevenueShare:", address(revProxy));
        console.log("VIPStaking:", address(vipProxy));
    }
}
