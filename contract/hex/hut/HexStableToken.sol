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

interface IERC20 {
    function totalSupply() external view returns (uint256);
    function balanceOf(address a) external view returns (uint256);
    function transfer(address to, uint256 v) external returns (bool);
    function allowance(address o, address s) external view returns (uint256);
    function approve(address s, uint256 v) external returns (bool);
    function transferFrom(address f, address t, uint256 v) external returns (bool);

    event Transfer(address indexed f, address indexed t, uint256 v);
    event Approval(address indexed o, address indexed s, uint256 v);
}

contract HexStableToken is IERC20, Ownable {
    string public constant name = "HeritageX Stable Token";
    string public constant symbol = "HEX";
    uint8 public constant decimals = 18;

    uint256 private _total;
    mapping(address => uint256) private _bal;
    mapping(address => mapping(address => uint256)) private _allow;

    address public minter;

    error NotMinter();

    constructor() Ownable(msg.sender) {
        minter = msg.sender;

        uint256 initial = 10_000_000 * (10 ** uint256(decimals));
        _mint(msg.sender, initial);
    }

    function setMinter(address m) external onlyOwner {
        require(m != address(0), "MINTER: zero");
        minter = m;
    }

    function mint(address to, uint256 v) external {
        if (msg.sender != minter) revert NotMinter();
        _mint(to, v);
    }

    function burn(address from, uint256 v) external {
        if (msg.sender != minter) revert NotMinter();
        require(_bal[from] >= v, "BURN");
        _bal[from] -= v;
        _total -= v;
        emit Transfer(from, address(0), v);
    }

    function totalSupply() external view returns (uint256) { return _total; }
    function balanceOf(address a) external view returns (uint256) { return _bal[a]; }
    function allowance(address o, address s) external view returns (uint256) { return _allow[o][s]; }

    function approve(address s, uint256 v) external returns (bool) {
        _allow[msg.sender][s] = v;
        emit Approval(msg.sender, s, v);
        return true;
    }

    function transfer(address t, uint256 v) external returns (bool) {
        _transfer(msg.sender, t, v);
        return true;
    }

    function transferFrom(address f, address t, uint256 v) external returns (bool) {
        uint256 a = _allow[f][msg.sender];
        require(a >= v, "ALLOW");
        _allow[f][msg.sender] = a - v;
        emit Approval(f, msg.sender, _allow[f][msg.sender]);
        _transfer(f, t, v);
        return true;
    }

    function _transfer(address f, address t, uint256 v) internal {
        require(t != address(0), "TO: zero");
        require(_bal[f] >= v, "BAL");
        _bal[f] -= v;
        _bal[t] += v;
        emit Transfer(f, t, v);
    }

    function _mint(address to, uint256 v) internal {
        require(to != address(0), "MINT: zero");
        _total += v;
        _bal[to] += v;
        emit Transfer(address(0), to, v);
    }
}
