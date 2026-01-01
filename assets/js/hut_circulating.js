// netlify/functions/hut_circulating.js
const { ethers } = require("ethers");

const RPC = "https://opbnb-mainnet-rpc.bnbchain.org";
const HUT = "0x3e31344335C77dA37cb2Cf409117e1dCa5Fda634";

// 락업 주소들 (여기에 실제 락업 주소를 넣으세요)
const LOCKED_ADDRESSES = [
  "0x7b709A479d92Ed358D097138bbEF009Bdd9673AA", // hutbank
  "0x4ad10ac8a18C6Bc481d4bdfA4EEB16692eFe8277", // HutTreasury
  "0x000000000000000000000000000000000000dEaD", // burn (있다면)
];

const ERC20_ABI = [
  "function totalSupply() view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
];

exports.handler = async () => {
  try {
    const provider = new ethers.JsonRpcProvider(RPC);
    const token = new ethers.Contract(HUT, ERC20_ABI, provider);

    const [ts, dec, lockedBalances] = await Promise.all([
      token.totalSupply(),
      token.decimals(),
      Promise.all(LOCKED_ADDRESSES.map((a) => token.balanceOf(a))),
    ]);

    const lockedSum = lockedBalances.reduce((acc, v) => acc + v, 0n);
    const circulating = ts - lockedSum;

    const human = ethers.formatUnits(circulating, dec);

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=60" },
      body: JSON.stringify({ result: human }),
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: String(e?.message || e) }) };
  }
};

