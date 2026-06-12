// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {LuckyPool} from "../src/LuckyPool.sol";
import {AntiScoreBet} from "../src/AntiScoreBet.sol";
import {ScoreBet} from "../src/ScoreBet.sol";
import {ChampionBet} from "../src/ChampionBet.sol";

/// @notice Mock USDT
contract MockUSDT {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => mapping(address => uint256)) public _allowances;
    string public name = "Tether USD";
    string public symbol = "USDT";
    uint8 public decimals = 18;
    
    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }
    
    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "ERC20: insufficient");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
    
    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 a = allowance[from][msg.sender];
        if (a != type(uint256).max) {
            require(a >= amount, "ERC20: insufficient allowance");
            allowance[from][msg.sender] = a - amount;
        }
        require(balanceOf[from] >= amount, "ERC20: insufficient");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
    
    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }
}

contract LuckyPoolTest is Test {
    LuckyPool public pool;
    MockUSDT public usdt;
    address public owner = makeAddr("owner");
    address public alice = makeAddr("alice");
    
    function setUp() public {
        usdt = new MockUSDT();
        
        // Deploy via proxy with owner as initializer
        vm.startPrank(owner);
        LuckyPool impl = new LuckyPool();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeCall(LuckyPool.initialize, address(usdt))
        );
        pool = LuckyPool(address(proxy));
        vm.stopPrank();
        
        usdt.mint(alice, 10000 ether);
    }
    
    function testDeposit() public {
        vm.startPrank(alice);
        usdt.approve(address(pool), 1000 ether);
        pool.deposit(1000 ether);
        
        assertEq(pool.userBalance(alice), 1000 ether);
        assertEq(pool.poolBalance(), 1000 ether);
    }
    
    function testWithdraw() public {
        vm.startPrank(alice);
        usdt.approve(address(pool), 1000 ether);
        pool.deposit(1000 ether);
        pool.withdraw(500 ether);
        assertEq(pool.userBalance(alice), 500 ether);
    }
    
    function testCircuitBreaker() public {
        vm.startPrank(alice);
        usdt.approve(address(pool), 1000 ether);
        pool.deposit(1000 ether);
        vm.stopPrank();
        
        vm.prank(owner);
        pool.toggleCircuitBreaker();
        
        vm.startPrank(alice);
        usdt.approve(address(pool), 500 ether);
        vm.expectRevert(abi.encodeWithSignature("EnforcedPause()"));
        pool.deposit(500 ether);
    }
}

contract AntiScoreBetTest is Test {
    LuckyPool public pool;
    AntiScoreBet public anti;
    MockUSDT public usdt;
    address public owner = makeAddr("owner");
    address public alice = makeAddr("alice");
    
    function setUp() public {
        usdt = new MockUSDT();
        
        vm.startPrank(owner);
        LuckyPool poolImpl = new LuckyPool();
        ERC1967Proxy poolProxy = new ERC1967Proxy(
            address(poolImpl),
            abi.encodeCall(LuckyPool.initialize, address(usdt))
        );
        pool = LuckyPool(address(poolProxy));
        
        AntiScoreBet antiImpl = new AntiScoreBet();
        ERC1967Proxy antiProxy = new ERC1967Proxy(
            address(antiImpl),
            abi.encodeCall(AntiScoreBet.initialize, address(pool))
        );
        anti = AntiScoreBet(address(antiProxy));

        // Authorize AntiScoreBet to call pool.recordBet
        pool.setAuthorizedContract(address(anti), true);
        vm.stopPrank();
        
        usdt.mint(alice, 10000 ether);
    }
    
    function testPlaceBet() public {
        vm.startPrank(alice);
        usdt.approve(address(pool), 1000 ether);
        pool.deposit(1000 ether);
        vm.stopPrank();
        
        vm.prank(owner);
        anti.createMatch(1, "PSG", "Marseille", block.timestamp + 1 days);
        
        vm.startPrank(alice);
        anti.placeBet(1, 5, 100 ether);
        assertEq(anti.betCount(), 1);
    }
}

contract ChampionBetTest is Test {
    LuckyPool public pool;
    ChampionBet public champ;
    MockUSDT public usdt;
    address public owner = makeAddr("owner");
    address public alice = makeAddr("alice");
    
    function setUp() public {
        usdt = new MockUSDT();
        
        vm.startPrank(owner);
        LuckyPool poolImpl = new LuckyPool();
        ERC1967Proxy poolProxy = new ERC1967Proxy(
            address(poolImpl),
            abi.encodeCall(LuckyPool.initialize, address(usdt))
        );
        pool = LuckyPool(address(poolProxy));
        
        ChampionBet champImpl = new ChampionBet();
        ERC1967Proxy champProxy = new ERC1967Proxy(
            address(champImpl),
            abi.encodeCall(ChampionBet.initialize, address(pool))
        );
        champ = ChampionBet(address(champProxy));
        vm.stopPrank();

        // Authorize ChampionBet to call pool.recordBet
        vm.prank(owner);
        pool.setAuthorizedContract(address(champ), true);
        
        usdt.mint(alice, 10000 ether);
    }
    
    function testChampionBet() public {
        vm.startPrank(alice);
        usdt.approve(address(pool), 1000 ether);
        pool.deposit(1000 ether);
        champ.placeBet(1, 1, 100 ether);
        assertEq(champ.betCount(), 1);
    }
    
    function testSettle() public {
        vm.startPrank(alice);
        usdt.approve(address(pool), 1000 ether);
        pool.deposit(1000 ether);
        champ.placeBet(1, 1, 100 ether);
        vm.stopPrank();
        
        vm.prank(owner);
        champ.setResult(1, 2);
        vm.prank(owner);
        champ.settleBet(1);
        
        (,,,,,,bool settled, bool won) = champ.bets(1);
        assertTrue(settled);
        assertTrue(won);
    }
}
