// /assets/js/config.js
(() => {
  // opBNB
  const rpcUrl = "https://opbnb-mainnet-rpc.bnbchain.org";

  // 배포된 주소
  const ADDR = {
    deployer: "0x54363a36aabA3ff0678f452c6592125441E2E25f",

    usdt: "0x9e5aac1ba1a2e6aed6b32689dfcf62a509ca96f3",
    hex:  "0x41F2Ea9F4eF7c4E35ba1a8438fC80937eD4E5464",
    hexVault: "0x153A4f25511930C8f1C44efF2889224cb9bD17A3",

    hut: "0x3e31344335C77dA37cb2Cf409117e1dCa5Fda634",
    hutbank: "0x7b709A479d92Ed358D097138bbEF009Bdd9673AA",
    hutTreasury: "0x4ad10ac8a18C6Bc481d4bdfA4EEB16692eFe8277",

    put: "0xE0fD5e1C6D832E71787BfB3E3F5cdB5dd2FD41b6",
    putbank: "0xbBB08FBaaFAb10419D7EF3E6e4404b6c75B00BF0",
    putTreasury: "0x60C3cAa39F9Ebd0EC9CaEA89d0E03728D44d6948",

    // BUT 재배포 반영 (사용자 제공 값)
    but: "0xc159663b769E6c421854E913460b973899B76E42",
    butbank: "0x7a310060BcE6e5C66d8eb47E19Ea50CefB963a33",
    butTreasury: "0x47fac604B1E699E7fbE470598EF69024e8a43b7f",

   exp: "0xBc619cb03c0429731AF66Ae8ccD5aeE917A6E5f4",
   expbank: "0x6666f37F760287914d37F935220a7Ff18f076A8E",
   expTreasury: "0xe6e1E50e1CBE7D415815785f14Ad45186F7E35a8",

  vet: "0xff8eCA08F731EAe46b5e7d10eBF640A8Ca7BA3D4",
  vetbank: "0xCB3AD2b01577A153884B6751E41f0c8dfbaF9E40",
  vetTreasury: "0xE4C5C1478DD8dEb46ECeC9dB1B9508E33BEC6cF3",
  };

  // ERC20 최소 ABI (지갑연결/잔고/approve/allowance/decimals)
  const ERC20_ABI = [
    "function name() view returns (string)",
    "function symbol() view returns (string)",
    "function decimals() view returns (uint8)",
    "function balanceOf(address) view returns (uint256)",
    "function allowance(address owner, address spender) view returns (uint256)",
    "function approve(address spender, uint256 amount) returns (bool)",
    "function transfer(address to, uint256 amount) returns (bool)",
    "function transferFrom(address from, address to, uint256 amount) returns (bool)"
  ];

  // HexStableVault ABI (Vault 코드 기준)
  const HEX_VAULT_ABI = [
    "function depositUSDT(uint256 amount)",
    "function redeemHEX(uint256 amount)",
    "function usdtReserves() view returns (uint256)",
    "function feeReceiver() view returns (address)",
    "function accumulatedHexFee() view returns (uint256)",
    "function FEE_BPS() view returns (uint256)"
  ];

  // Bank ABI: 읽기용(없으면 try/catch로 무시되는 구조의 JS들과 호환)
  const BANK_ABI = [
    "function price() view returns (uint256)",
    "function totalfee() view returns (uint256)",
    "function totalStaked() view returns (uint256)",
    "function divisor() view returns (uint256)",
    "function rate() view returns (uint8)",

    "function chartLength() view returns (uint256)",
    "function chartAt(uint256) view returns (uint256)",

    // user 구조체(당신 프로젝트에서 사용 중)
    "function user(address) view returns (uint256,uint256,uint256,uint256,uint256)",

    // 배당
    "function pendingDividend(address) view returns (uint256)",

    // 일부 페이지에서 쓸 수도 있는 후보들(없으면 호출 실패 -> 스크립트에서 무시)
    "function myDashboardSelf() view returns (uint256,uint256,uint256,uint256,int256,int256)",
    "function userStatsBase(address) view returns (uint256,uint256,uint256,uint256)",
    "function autoStakeBps() view returns (uint16)"
  ];

  // 토큰 메타
  const TOKENS = [
    {
      key: "HUT",
      name: "HeritageX Utility Token",
      symbol: "HUT",
      token: ADDR.hut,
      bank: ADDR.hutbank,
      treasury: ADDR.hutTreasury,
      icon: "/assets/images/tokens/hut.png",
      decimals: 0
    },
    {
      key: "PUT",
      name: "PUT Utility Token",
      symbol: "PUT",
      token: ADDR.put,
      bank: ADDR.putbank,
      treasury: ADDR.putTreasury,
      icon: "/assets/images/tokens/put.png",
      decimals: 0
    },
    {
      key: "BUT",
      name: "BlueEco Utility Token",
      symbol: "BUT",
      token: ADDR.but,
      bank: ADDR.butbank,
      treasury: ADDR.butTreasury,
      icon: "/assets/images/tokens/but.png",
      decimals: 0
    },
    {
      key: "EXP",
      name: "Experience Factory",
      symbol: "EXP",
      token: ADDR.exp,
      bank: ADDR.expbank,
      treasury: ADDR.expTreasury,
      icon: "/assets/images/tokens/exp.png",
      decimals: 0
    },
    {
      key: "VET",
      name: "Vietnam Sales",
      symbol: "VET",
      token: ADDR.vet,
      bank: ADDR.vetbank,
      treasury: ADDR.vetTreasury,
      icon: "/assets/images/tokens/vet.png",
      decimals: 0
    },
  ];

  const tokenMap = {};
  for (const t of TOKENS) tokenMap[t.key] = t;

  window.HEXDAO_CONFIG = {
    rpcUrl,
    chain: "opbnb",

    // 공통 컨트랙트
    contracts: {
      usdt: ADDR.usdt,
      hex: ADDR.hex,

      // 기존 키 유지
      hexVault: ADDR.hexVault,

      // 호환 키 추가 (vault로 찾는 스크립트 대응)
      vault: ADDR.hexVault
    },

    // 기존 스크립트 호환 키들
    erc20Abi: ERC20_ABI,
    vaultAbi: HEX_VAULT_ABI,
    hexVaultAbi: HEX_VAULT_ABI,

    // 내가 추가했던 구조(다른 파일에서 cfg.abis.* 로 찾는 경우까지 커버)
    abis: {
      ERC20: ERC20_ABI,
      HEX_VAULT: HEX_VAULT_ABI,
      BANK_READ: BANK_ABI
    },

    // 토큰
    tokens: TOKENS,
    tokenMap,

    // decimals 기본값(표시용)
    decimals: {
      HEX: 18,
      USDT: 6
    },

    urlTokenParam: "token"
  };
})();
