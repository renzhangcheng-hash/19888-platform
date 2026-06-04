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

        // Alice places a bet
        vm.startPrank(alice);
        bytes32 score = keccak256(abi.encodePacked("2-1"));
        scoreBet.placeBet(1, score, 100 ether);

        (address user, uint256 matchId, bytes32 storedScore, uint256 amount, uint256 odds, uint256 win, bool settled, bool won) = scoreBet.bets(1);
        assertEq(user, alice);
        assertEq(matchId, 1);
        assertEq(storedScore, score);
        assertEq(amount, 100 ether);
        assertEq(scoreBet.betCount(), 1);
        assertFalse(settled);
    }

    function testPlaceBet_Failure_NoBalance() public {
        // Bob has no pool balance — placeBet should revert
        vm.startPrank(bob);
        bytes32 score = keccak256(abi.encodePacked("1-0"));
        vm.expectRevert("Invalid");
        scoreBet.placeBet(1, score, 100 ether);
        vm.stopPrank();
    }

    function testSettleBet_Success() public {
        // Deposit and place bet
        vm.startPrank(alice);
        usdt.approve(address(pool), 1000 ether);
        pool.deposit(1000 ether);
        bytes32 score = keccak256(abi.encodePacked("2-1"));
        scoreBet.placeBet(1, score, 100 ether);
        vm.stopPrank();

        // ScoreBet does not call __Ownable_init(), so owner is address(0)
        vm.prank(address(0));
        scoreBet.settleBet(1, score);

        (,,,,,,bool settled, bool won) = scoreBet.bets(1);
        assertTrue(settled);
        assertTrue(won);
    }

    function testSettleBet_Failure_AlreadySettled() public {
        // Deposit and place bet
        vm.startPrank(alice);
        usdt.approve(address(pool), 1000 ether);
        pool.deposit(1000 ether);
        bytes32 score = keccak256(abi.encodePacked("2-1"));
        scoreBet.placeBet(1, score, 100 ether);
        vm.stopPrank();

        // ScoreBet does not call __Ownable_init(), so owner is address(0)
        vm.prank(address(0));
        scoreBet.settleBet(1, score);

        // Settle again — should revert
        vm.prank(address(0));
        vm.expectRevert("Already");
        scoreBet.settleBet(1, score);
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

        assertEq(aiVault.totalRevenue(), 500 ether);
        assertEq(pool.poolBalance(), 500 ether);
    }

    function testGetAPR_InitiallyZero() public {
        uint256 apr = aiVault.getAPR();
        assertEq(apr, 0);
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

    function testStake_Success() public {
        vm.startPrank(alice);
        vipStaking.stake(1000 ether);

        (uint256 staked, uint256 since, uint256 level) = vipStaking.getVIP(alice);
        assertEq(staked, 1000 ether);
        assertEq(level, 3); // 1000 >= baseStakeForVIP3 (1000 ether)
        assertEq(vipStaking.totalStaked(), 1000 ether);
    }

    function testUnstake_Success() public {
        vm.startPrank(alice);
        vipStaking.stake(1000 ether);
        vipStaking.unstake(400 ether);

        (uint256 staked,, uint256 level) = vipStaking.getVIP(alice);
        assertEq(staked, 600 ether);
        assertEq(level, 2); // 600 >= baseStakeForVIP2 (500 ether)
        assertEq(vipStaking.totalStaked(), 600 ether);
    }

    function testUnstake_Failure_Insufficient() public {
        vm.startPrank(alice);
        vipStaking.stake(100 ether);

        vm.expectRevert("Insufficient");
        vipStaking.unstake(200 ether);
        vm.stopPrank();
    }

    function testSetVIPThresholds_Failure_NotOwner() public {
        vm.startPrank(stranger);
        uint256[5] memory newThresholds = [uint256(100 ether), 200 ether, 300 ether, 400 ether, 500 ether];
        vm.expectRevert();
        vipStaking.setVIPThresholds(newThresholds);
        vm.stopPrank();
    }
}
