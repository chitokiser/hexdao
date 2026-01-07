// /assets/js/header-stats.js
(() => {
  const cfg = window.HEXDAO_CONFIG;
  if (!cfg) return;

  const $ = (id) => document.getElementById(id);

  function setText(id, v) {
    const el = $(id);
    if (el) el.textContent = v;
  }

  function trimDecimals(str, maxFrac = 6) {
    const s = String(str);
    if (!s.includes(".")) return s;
    const [a, b] = s.split(".");
    const bb = b.slice(0, maxFrac).replace(/0+$/, "");
    return bb.length ? `${a}.${bb}` : a;
  }

  function fmtUnits(u, dec = 18, maxFrac = 6) {
    try { return trimDecimals(ethers.formatUnits(u, dec), maxFrac); }
    catch { return String(u); }
  }

  function fmtPriceDisplay(raw) {
    try {
      const bn = BigInt(raw.toString());
      if (bn > 1000000000n) return fmtUnits(raw, 18, 6);
      const n = Number(raw);
      if (Number.isFinite(n) && n >= 1 && n <= 1000000000) return trimDecimals(String(n / 100), 6);
      return String(raw);
    } catch {
      return String(raw);
    }
  }

  function pickFirst(...vals) {
    for (const v of vals) {
      if (typeof v === "string" && v.startsWith("0x") && v.length >= 42) return v;
    }
    return null;
  }

  const contracts = cfg.contracts || {};
  const tokenMap = cfg.tokenMap || {};
  const tokens = Array.isArray(cfg.tokens) ? cfg.tokens : [];

  const hutInfo =
    tokenMap.HUT ||
    tokens.find(t => (t.key || "").toUpperCase() === "HUT") ||
    tokens.find(t => (t.symbol || "").toUpperCase() === "HUT") ||
    null;

  const ADDR = {
    rpcUrl: cfg.rpcUrl || null,
    usdt: pickFirst(contracts.usdt, cfg.usdt),
    hex:  pickFirst(contracts.hex,  cfg.hex),
    vault: pickFirst(contracts.vault, contracts.hexVault),
    hutbank: pickFirst(hutInfo?.bank, cfg.hutbank, cfg.ADDR?.hutbank, cfg.addr?.hutbank, contracts.hutbank),
  };

  const ABI_BANK = (cfg.abis && cfg.abis.BANK_READ) || [
    "function price() view returns (uint256)",
    "function totalfee() view returns (uint256)",
    "function totalStaked() view returns (uint256)"
  ];

  const ABI_ERC20 = (cfg.abis && cfg.abis.ERC20) || [
    "function balanceOf(address) view returns (uint256)",
    "function decimals() view returns (uint8)"
  ];

  async function refreshHeader() {
    if (!ADDR.rpcUrl || !ADDR.usdt || !ADDR.hex || !ADDR.vault || !ADDR.hutbank) {
      console.error("header-stats: missing address in config", ADDR);
      setText("hxUsers", "-");
      setText("hutPriceTop", "-");
      setText("tvlTop", "-");
      setText("feeTop", "-");
      setText("vaultUsdtTop", "-");
      return;
    }

    const rpc = new ethers.JsonRpcProvider(ADDR.rpcUrl);

    try {
      const bank = new ethers.Contract(ADDR.hutbank, ABI_BANK, rpc);
      const hex  = new ethers.Contract(ADDR.hex, ABI_ERC20, rpc);
      const usdt = new ethers.Contract(ADDR.usdt, ABI_ERC20, rpc);

      const [priceRaw, feeRaw, tvlHexRaw, totalStakedRaw, usdtBalRaw, usdtDec] = await Promise.all([
        bank.price(),
        bank.totalfee(),
        hex.balanceOf(ADDR.hutbank),
        bank.totalStaked(),
        usdt.balanceOf(ADDR.vault),
        usdt.decimals()
      ]);

      setText("hxUsers", `${totalStakedRaw.toString()} HUT`);
      setText("hutPriceTop", `${fmtPriceDisplay(priceRaw)} HEX`);
      setText("tvlTop", `${fmtUnits(tvlHexRaw, 18, 4)} HEX`);
      setText("feeTop", `${fmtUnits(feeRaw, 18, 4)} HEX`);
      setText("vaultUsdtTop", `${fmtUnits(usdtBalRaw, Number(usdtDec), 4)} USDT`);
    } catch (e) {
      console.error("header-stats refresh failed:", e);
      setText("hxUsers", "-");
      setText("hutPriceTop", "-");
      setText("tvlTop", "-");
      setText("feeTop", "-");
      setText("vaultUsdtTop", "-");
    }
  }

  window.addEventListener("partials:loaded", () => {
    refreshHeader();
    setInterval(refreshHeader, 8000);
  });

  document.addEventListener("DOMContentLoaded", () => {
    setTimeout(() => {
      refreshHeader();
      setInterval(refreshHeader, 8000);
    }, 300);
  });
})();
