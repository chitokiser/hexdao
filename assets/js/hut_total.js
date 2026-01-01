// netlify/functions/hut_total.js
const { ethers } = require("ethers");

const RPC = "https://opbnb-mainnet-rpc.bnbchain.org";
const HUT = "0x3e31344335C77dA37cb2Cf409117e1dCa5Fda634";

const ERC20_ABI = [
  "function totalSupply() view returns (uint256)",
  "function decimals() view returns (uint8)",
];

exports.handler = async () => {
  try {
    const provider = new ethers.JsonRpcProvider(RPC);
    const token = new ethers.Contract(HUT, ERC20_ABI, provider);

    const [ts, dec] = await Promise.all([token.totalSupply(), token.decimals()]);

    // CoinGecko 요구: decimals 반영된 값
    // HUT는 0 decimals이므로 그대로 문자열로 반환
    const human = ethers.formatUnits(ts, dec);

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=60" },
      body: JSON.stringify({ result: human }),
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: String(e?.message || e) }) };
  }
};
