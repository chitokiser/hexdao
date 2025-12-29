// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract Ownable {
    address public owner;
    event OwnershipTransferred(address indexed prev, address indexed next);

    modifier onlyOwner() {
        require(msg.sender == owner, "OWN: not owner");
        _;
    }

    constructor(address initialOwner) {
        require(initialOwner != address(0), "OWN: zero");
        owner = initialOwner;
        emit OwnershipTransferred(address(0), initialOwner);
    }

    function transferOwnership(address next) external onlyOwner {
        require(next != address(0), "OWN: zero");
        emit OwnershipTransferred(owner, next);
        owner = next;
    }
}

contract ReentrancyGuard {
    uint256 private _status = 1;
    modifier nonReentrant() {
        require(_status == 1, "REENTRANCY");
        _status = 2;
        _;
        _status = 1;
    }
}

interface IERC20 {
    function balanceOf(address a) external view returns (uint256);
    function transfer(address to, uint256 v) external returns (bool);
    function allowance(address o, address s) external view returns (uint256);
    function approve(address s, uint256 v) external returns (bool);
    function transferFrom(address f, address t, uint256 v) external returns (bool);
}

library SafeERC20 {
    function safeTransfer(address token, address to, uint256 v) internal {
        (bool ok, bytes memory d) =
            token.call(abi.encodeWithSelector(IERC20.transfer.selector, to, v));
        require(ok && (d.length == 0 || abi.decode(d, (bool))), "SAFE: transfer");
    }

    function safeTransferFrom(address token, address f, address t, uint256 v) internal {
        (bool ok, bytes memory d) =
            token.call(abi.encodeWithSelector(IERC20.transferFrom.selector, f, t, v));
        require(ok && (d.length == 0 || abi.decode(d, (bool))), "SAFE: transferFrom");
    }
}

interface IHexStableToken {
    function mint(address to, uint256 v) external;
    function burn(address from, uint256 v) external;
    function transfer(address to, uint256 v) external returns (bool);
}

contract HexStableVault is Ownable, ReentrancyGuard {
    using SafeERC20 for address;

    address public immutable usdt;
    address public immutable hexToken;

    address public feeReceiver;

    uint256 public constant FEE_BPS = 25; // 0.25%
    uint256 public constant BPS_DENOM = 10_000;

    uint256 public accumulatedHexFee;
    uint256 public constant FEE_PAYOUT_THRESHOLD = 10 ether; // 10 HEX (18 decimals)

    event Deposited(address indexed user, uint256 usdtIn, uint256 hexMinted);
    event Redeemed(address indexed user, uint256 hexIn, uint256 usdtOut);
    event FeePayout(uint256 amount);

    constructor(
        address usdtAddress,
        address hexTokenAddress,
        address feeReceiverAddress
    ) Ownable(msg.sender) {
        require(
            usdtAddress != address(0) &&
            hexTokenAddress != address(0) &&
            feeReceiverAddress != address(0),
            "ZERO"
        );
        usdt = usdtAddress;
        hexToken = hexTokenAddress;
        feeReceiver = feeReceiverAddress;
    }

    function setFeeReceiver(address newReceiver) external onlyOwner {
        require(newReceiver != address(0), "ZERO");
        feeReceiver = newReceiver;
    }

    function usdtReserves() public view returns (uint256) {
        return IERC20(usdt).balanceOf(address(this));
    }

    function _collectFee(uint256 feeAmount) internal {
        accumulatedHexFee += feeAmount;  //누적수수료 금액

        if (accumulatedHexFee >= FEE_PAYOUT_THRESHOLD) {
            uint256 payout = accumulatedHexFee;
            accumulatedHexFee = 0;

            IHexStableToken(hexToken).transfer(feeReceiver, payout);
            emit FeePayout(payout);
        }
    }

    function depositUSDT(uint256 amount) external nonReentrant {
        require(amount > 0, "AMOUNT");

        uint256 fee = (amount * FEE_BPS) / BPS_DENOM;
        uint256 mintAmount = amount - fee;

        usdt.safeTransferFrom(msg.sender, address(this), amount);
        IHexStableToken(hexToken).mint(msg.sender, mintAmount);

        _collectFee(fee);

        emit Deposited(msg.sender, amount, mintAmount);
    }

    function redeemHEX(uint256 amount) external nonReentrant {
        require(amount > 0, "AMOUNT");

        uint256 fee = (amount * FEE_BPS) / BPS_DENOM;
        uint256 redeemAmount = amount - fee;

        require(usdtReserves() >= redeemAmount, "RESERVE");

        IHexStableToken(hexToken).burn(msg.sender, amount);
        usdt.safeTransfer(msg.sender, redeemAmount);

        _collectFee(fee);

        emit Redeemed(msg.sender, amount, redeemAmount);
    }
}
