// /assets/js/header-stats.js
(() => {
  const cfg = window.HEXDAO_CONFIG;
  if (!cfg) return;

  const $ = (id) => document.getElementById(id);

  const ABI_BANK = [
    "function price() view returns (uint256)",
    "function totalfee() view returns (uint256)",
    "function totalStaked() view returns (uint256)"
  ];

  const ABI_ERC20 = [
    "function balanceOf(address) view returns (uint256)"
  ];

  function getTokenKeyFromUrl() {
    try {
      const u = new URL(location.href);
      const k = (u.searchParams.get(cfg.urlTokenParam) || "").toUpperCase();
      if (cfg.tokenMap[k]) return k;
    } catch {}
    // swap/treasury 같은 페이지는 기본 HUT로 (원하면 바꿔도 됨)
    return "HUT";
  }

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

  function fmtUnits(u, dec, maxFrac = 6) {
    try { return trimDecimals(ethers.formatUnits(u, dec), maxFrac); }
    catch { return String(u); }
  }

  function fmtPrice(rawWei18) {
    // price는 wei(18)로 저장되어 있다고 가정 (현재 화면값이 정상이라 그대로 유지)
    return fmtUnits(rawWei18, 18, 6);
  }

  let _timer = null;
  async function refreshHeader() {
    // 헤더 카드 id가 없으면 그냥 종료
    if (!$("hxUsers") && !$("hutPriceTop") && !$("tvlTop") && !$("feeTop")) return;

    const tokenKey = getTokenKeyFromUrl();
    const t = cfg.tokenMap[tokenKey];
    if (!t) return;

    const rpc = new ethers.JsonRpcProvider(cfg.rpcUrl);

    try {
      const bankAddr = t.bank;
      const bank = new ethers.Contract(bankAddr, ABI_BANK, rpc);
      const hex  = new ethers.Contract(cfg.contracts.hex, ABI_ERC20, rpc);

      const [priceRaw, feeRaw, tvlRaw, totalStakedRaw] = await Promise.all([
        bank.price(),
        bank.totalfee(),
        hex.balanceOf(bankAddr),
        bank.totalStaked()
      ]);

      // 카드 라벨(있으면)도 토큰별로 바꿔줌
      if ($("hxUsersLabel")) setText("hxUsersLabel", `${t.symbol}스테이킹 총량`);
      if ($("hutPriceTopLabel")) setText("hutPriceTopLabel", `${t.symbol} 가격`);
      if ($("tvlTopLabel")) setText("tvlTopLabel", `${t.symbol}Bank TVL`);
      if ($("feeTopLabel")) setText("feeTopLabel", `${t.symbol}Bank 수수료 수익`);

      setText("hxUsers", `${totalStakedRaw.toString()} ${t.symbol}`);
      setText("hutPriceTop", `${fmtPrice(priceRaw)} HEX`);
      setText("tvlTop", `${fmtUnits(tvlRaw, 18, 6)} HEX`);
      setText("feeTop", `${fmtUnits(feeRaw, 18, 6)} HEX`);
    } catch (e) {
      console.error("header-stats refresh failed:", e);
      setText("hxUsers", "-");
      setText("hutPriceTop", "-");
      setText("tvlTop", "-");
      setText("feeTop", "-");
    }
  }

  function start() {
    refreshHeader();
    if (_timer) clearInterval(_timer);
    _timer = setInterval(refreshHeader, 8000);
  }

  window.addEventListener("partials:loaded", start);
  document.addEventListener("DOMContentLoaded", () => setTimeout(start, 250));
})();
