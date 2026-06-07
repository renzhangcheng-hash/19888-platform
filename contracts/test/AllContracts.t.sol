// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {LuckyPool} from "../src/LuckyPool.sol";
import {ScoreBet} from "../src/ScoreBet.sol";
import {AIVault} from "../src/AIVault.sol";
import {RevenueShare} from "../src/RevenueShare.sol";
import {VIPStaking} from "../src/VIPStaking.sol";

/// @notice Mock USDT token for testing
contract MockUSDT {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

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

/// ==================== ScoreBet Tests ====================

contract ScoreBetTest is Test {
    LuckyPool public pool;
    ScoreBet public scoreBet;
    MockUSDT public usdt;
    address public owner = makeAddr("owner");
    address public alice = makeAddr("alice");
    address public bob = makeAddr("bob");

    function setUp() public {
        usdt = new MockUSDT();

        vm.startPrank(owner);
        // Deploy LuckyPool via proxy
        LuckyPool poolImpl = new LuckyPool();
        ERC1967Proxy poolProxy = new ERC1967Proxy(
            address(poolImpl),
            abi.encodeCall(LuckyPool.initialize, address(usdt))
        );
        pool = LuckyPool(address(poolProxy));

        // Deploy ScoreBet via proxy
        ScoreBet scoreBetImpl = new ScoreBet();
        ERC1967Proxy scoreBetProxy = new ERC1967Proxy(
            address(scoreBetImpl),
            abi.encodeCall(ScoreBet.initialize, address(pool))
        );
        scoreBet = ScoreBet(address(scoreBetProxy));

        // Authorize ScoreBet to call pool.recordBet / recordPayout
        pool.setAuthorizedContract(address(scoreBet), true);

        // Create a match for betting
        scoreBet.createMatch(1, "Home", "Away", block.timestamp + 1 days);
        vm.stopPrank();

        usdt.mint(alice, 10000 ether);
        usdt.mint(bob, 10000 ether);
    }

    function testPlaceBet_Success() public {
        // Alice deposits into LuckyPool first
        vm.startPrank(alice);
        usdt.approve(address(pool), 1000 ether);
        pool.deposit(1000 ether);
        vm.stopPrank();

        // Alice places a bet on cell index 9 (score "2:1")
        vm.startPrank(alice);
        uint8 cellIndex = 9; // 2:1
        scoreBet.placeBet(1, cellIndex, 100 ether);

        (address user, uint256 matchId, uint8 storedCell, uint256 amount, uint256 odds, uint256 potentialWin, bool settled, bool won, uint256 payout, uint256 placedAt) = scoreBet.bets(1);
        assertEq(user, alice);
        assertEq(matchId, 1);
        assertEq(storedCell, cellIndex);
        assertEq(amount, 100 ether);
        assertEq(scoreBet.betCount(), 1);
        assertFalse(settled);
    }

    function testPlaceBet_Failure_NoBalance() public {
        // Bob has no pool balance — placeBet should revert
        vm.startPrank(bob);
        uint8 cellIndex = 4; // 1:0
        vm.expectRevert("ScoreBet: insufficient balance");
        scoreBet.placeBet(1, cellIndex, 100 ether);
        vm.stopPrank();
    }

    function testSettleBet_Success() public {
        // Deposit and place bet
        vm.startPrank(alice);
        usdt.approve(address(pool), 1000 ether);
        pool.deposit(1000 ether);
        uint8 cellIndex = 9; // 2:1
        scoreBet.placeBet(1, cellIndex, 100 ether);
        vm.stopPrank();

        // Owner settles the match with final score = cellIndex 9 (2:1)
        vm.prank(owner);
        scoreBet.settleMatch(1, cellIndex);

        // Owner settles the bet
        vm.prank(owner);
        scoreBet.settleBet(1);

        (,,,,,,bool settled, bool won,,) = scoreBet.bets(1);
        assertTrue(settled);
        assertTrue(won);
    }

    function testSettleBet_Failure_AlreadySettled() public {
        // Deposit and place bet
        vm.startPrank(alice);
        usdt.approve(address(pool), 1000 ether);
        pool.deposit(1000 ether);
        uint8 cellIndex = 9; // 2:1
        scoreBet.placeBet(1, cellIndex, 100 ether);
        vm.stopPrank();

        // Owner settles the match
        vm.prank(owner);
        scoreBet.settleMatch(1, cellIndex);

        // Settle bet once
        vm.prank(owner);
        scoreBet.settleBet(1);

        // Settle again — should revert
        vm.prank(owner);
        vm.expectRevert("ScoreBet: bet already settled");
        scoreBet.settleBet(1);
    }
}

/// ==================== AIVault Tests ====================

contract AIVaultTest is Test {
    LuckyPool public pool;
    AIVault public aiVault;
    MockUSDT public usdt;
    address public owner = makeAddr("owner");
    address public stranger = makeAddr("stranger");

    function setUp() public {
        usdt = new MockUSDT();

        vm.startPrank(owner);
        // Deploy LuckyPool via proxy
        LuckyPool poolImpl = new LuckyPool();
        ERC1967Proxy poolProxy = new ERC1967Proxy(
            address(poolImpl),
            abi.encodeCall(LuckyPool.initialize, address(usdt))
        );
        pool = LuckyPool(address(poolProxy));

        // Deploy AIVault via proxy
        AIVault vaultImpl = new AIVault();
        ERC1967Proxy vaultProxy = new ERC1967Proxy(
            address(vaultImpl),
            abi.encodeCall(AIVault.initialize, address(pool))
        );
        aiVault = AIVault(address(vaultProxy));

        // AIVault.addRevenue calls pool.recordRevenue() which is onlyOwner.
        // Transfer LuckyPool ownership to AIVault so the cross-call works.
        pool.transferOwnership(address(aiVault));
        vm.stopPrank();
    }

    function testAddRevenue_Success() public {
        vm.prank(owner);
        aiVault.addRevenue(500 ether);

        assertEq(pool.poolBalance(), 500 ether);
    }

    function testGetDailyReturn_InitiallyDefault() public {
        uint256 dailyReturn = aiVault.dailyReturnBps();
        assertEq(dailyReturn, 60); // 0.6%
    }

    function testAddRevenue_Failure_NotOwner() public {
        vm.startPrank(stranger);
        vm.expectRevert();
        aiVault.addRevenue(100 ether);
        vm.stopPrank();
    }
}

/// ==================== RevenueShare Tests ====================

contract RevenueShareTest is Test {
    LuckyPool public pool;
    RevenueShare public revenueShare;
    MockUSDT public usdt;
    address public owner = makeAddr("owner");
    address public stranger = makeAddr("stranger");

    function setUp() public {
        usdt = new MockUSDT();

        vm.startPrank(owner);
        // Deploy LuckyPool via proxy
        LuckyPool poolImpl = new LuckyPool();
        ERC1967Proxy poolProxy = new ERC1967Proxy(
            address(poolImpl),
            abi.encodeCall(LuckyPool.initialize, address(usdt))
        );
        pool = LuckyPool(address(poolProxy));

        // Deploy RevenueShare via proxy
        RevenueShare rsImpl = new RevenueShare();
        ERC1967Proxy rsProxy = new ERC1967Proxy(
            address(rsImpl),
            abi.encodeCall(RevenueShare.initialize, address(pool))
        );
        revenueShare = RevenueShare(address(rsProxy));
        vm.stopPrank();
    }

    function testCollectFee_Success() public {
        vm.prank(owner);
        revenueShare.collectFee(1000 ether);

        assertEq(revenueShare.totalFeesCollected(), 1000 ether);
    }

    function testSetShares_Success() public {
        // 25% / 25% / 25% / 25% = 10000 bps
        vm.prank(owner);
        revenueShare.setShares(2500, 2500, 2500, 2500);

        assertEq(revenueShare.agentShare(), 2500);
        assertEq(revenueShare.treasuryShare(), 2500);
        assertEq(revenueShare.stakerShare(), 2500);
        assertEq(revenueShare.teamShare(), 2500);
    }

    function testSetShares_Failure_WrongSum() public {
        // Sum = 9000, not 10000
        vm.prank(owner);
        vm.expectRevert("Must sum to 100%");
        revenueShare.setShares(2000, 2000, 2000, 3000);
    }

    function testCollectFee_Failure_NotOwner() public {
        vm.startPrank(stranger);
        vm.expectRevert();
        revenueShare.collectFee(100 ether);
        vm.stopPrank();
    }
}

/// ==================== VIPStaking Tests ====================

contract VIPStakingTest is Test {
    VIPStaking public vipStaking;
    address public owner = makeAddr("owner");
    address public alice = makeAddr("alice");
    address public stranger = makeAddr("stranger");

    function setUp() public {
        vm.startPrank(owner);
        VIPStaking impl = new VIPStaking();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeCall(VIPStaking.initialize, ())
        );
        vipStaking = VIPStaking(address(proxy));
        vm.stopPrank();
    }

    function testDeposit_Success() public {
        vm.startPrank(alice);
        vipStaking.deposit(1000 ether);

        (uint256 turnover, uint256 depositAmt, uint256 depositReturned, uint256 level, uint256 rewards) = vipStaking.getUserInfo(alice);
        assertEq(depositAmt, 1000 ether);
        assertEq(level, 0); // no turnover yet, so not VIP
        assertEq(vipStaking.totalDeposits(), 1000 ether);
    }

    function testRecordTurnover_Success() public {
        vm.startPrank(alice);
        vipStaking.deposit(1000 ether);
        vm.stopPrank();

        // Owner records turnover to trigger VIP level
        vm.prank(owner);
        vipStaking.recordTurnover(alice, 1_000_000 * 1e18); // $1M → VIP 3

        (uint256 turnover, uint256 depositAmt,, uint256 level,) = vipStaking.getUserInfo(alice);
        assertEq(turnover, 1_000_000 * 1e18);
        assertEq(depositAmt, 1000 ether);
        assertEq(level, 3); // $1M turnover → VIP 3
    }

    function testWithdrawDeposit_Failure_NotVIP() public {
        vm.startPrank(alice);
        vipStaking.deposit(100 ether);

        vm.expectRevert("Not a VIP");
        vipStaking.withdrawDeposit();
        vm.stopPrank();
    }

    function testSetVIPTier_Failure_NotOwner() public {
        vm.startPrank(stranger);
        vm.expectRevert();
        vipStaking.setVIPTier(1, 100 ether, 10, 100, 10);
        vm.stopPrank();
    }
}
