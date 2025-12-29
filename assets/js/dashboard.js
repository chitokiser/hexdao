// /assets/js/dashboard.js (전체 교체본: 모든 토큰 공용, PUT 차트 HEX/PUT로 표시)
/* global ethers, HEXDAO_CONFIG, ApexCharts, feather */
(() => {
  const cfg = window.HEXDAO_CONFIG;
  const el = (id) => document.getElementById(id);

  const PRICE_DECIMALS = 18;

  // 대시보드가 읽을 공용 ABI (토큰마다 inventory/buy/sell 이름이 달라서 여기선 조회만 통일)
  const bankAbiDash = [
    "function price() view returns (uint256)",
    "function act() view returns (uint8)",
    "function totalfee() view returns (uint256)",
    "function hexBalance() view returns (uint256)",
    "function totalStaked() view returns (uint256)",

    // inventory 이름이 토큰별로 다를 수 있어 둘 다 시도
    "function hutInventory() view returns (uint256)",
    "function putInventory() view returns (uint256)",
    "function butInventory() view returns (uint256)",

    // 차트 (있으면 사용)
    "function chartLength() view returns (uint256)",
    "function chartAt(uint256 idx) view returns (uint256)"
  ];

  const erc20Abi = ["function decimals() view returns (uint8)"];

  let chart = null;

  function setCal() {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mi = String(d.getMinutes()).padStart(2, "0");
    if (el("calD")) el("calD").textContent = `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
  }

  function fmt(n, dp = 6) {
    const x = Number(n);
    if (!isFinite(x)) return "-";
    return x.toLocaleString(undefined, { maximumFractionDigits: dp });
  }

  function actToText(v) {
    const n = Number(v);
    if (n === 0) return "정지";
    if (n === 1) return "판매";
    if (n === 2) return "판매+배당";
    if (n === 3) return "판매+배당+환매";
    return String(n);
  }

  function getTokenKey() {
    // 1) body data-bank 우선
    const k1 = (document.body?.dataset?.bank || "").trim();
    if (k1) return k1.toUpperCase();

    // 1.5) URL 파라미터(token=PUT) 지원 (tokendetail.html?token=PUT)
    try {
      const sp = new URLSearchParams(location.search);
      const kq = (sp.get("token") || "").trim();
      if (kq) return kq.toUpperCase();
    } catch {}

    // 2) 파일명으로 추론 (putdetail.html이면 PUT)
    const fn = (location.pathname.split("/").pop() || "").toLowerCase();
    if (fn.includes("put")) return "PUT";
    if (fn.includes("hut")) return "HUT";
    if (fn.includes("but")) return "BUT";

    // 3) 기본
    return "HUT";
  }

  function findTokenInfo(key) {
    const list = Array.isArray(cfg?.tokenList) ? cfg.tokenList : [];
    return list.find((t) => String(t.key).toUpperCase() === String(key).toUpperCase()) || null;
  }

  function bankAddressFromKey(key) {
    const info = findTokenInfo(key);
    if (info?.bank) return info.bank;
    const lower = String(key).toLowerCase();
    return cfg?.contracts?.[`${lower}bank`] || cfg?.contracts?.hutbank;
  }

  async function getInventory(bank) {
    try {
      const v = await bank.hutInventory();
      return { value: v, symbol: "HUT" };
    } catch {}
    try {
      const v = await bank.putInventory();
      return { value: v, symbol: "PUT" };
    } catch {}
    try {
      const v = await bank.butInventory();
      return { value: v, symbol: "BUT" };
    } catch {}
    return { value: 0n, symbol: "" };
  }

  async function loadChartData(bank) {
    let len = 0;
    try {
      len = Number(await bank.chartLength());
    } catch {
      const p = await bank.price();
      return [Number(ethers.formatUnits(p, PRICE_DECIMALS))];
    }

    if (!len || len < 2) {
      const p = await bank.price();
      return [Number(ethers.formatUnits(p, PRICE_DECIMALS))];
    }

    const N = 120;
    const start = Math.max(0, len - N);
    const arr = [];

    for (let i = start; i < len; i++) {
      const v = await bank.chartAt(i);
      // 여기서 이미 price/1e18 반영
      arr.push(Number(ethers.formatUnits(v, PRICE_DECIMALS)));
    }
    return arr;
  }

  function renderChart(seriesData, tokenKey) {
    const target = el("myChart");
    if (!target) return;

    const options = {
      chart: { type: "line", height: 380, toolbar: { show: false }, animations: { enabled: true } },
      series: [{ name: `price (HEX/${tokenKey})`, data: seriesData }],
      xaxis: { categories: seriesData.map((_, i) => String(i + 1)), labels: { show: false } },
      yaxis: { labels: { formatter: (v) => fmt(v, 6) } },
      stroke: { width: 2 },
      grid: { borderColor: "rgba(0,0,0,0.08)" },
      tooltip: { y: { formatter: (v) => fmt(v, 6) } }
    };

    if (chart) {
      chart.updateOptions(options, true, true);
      chart.updateSeries(options.series, true);
    } else {
      chart = new ApexCharts(target, options);
      chart.render();
    }
  }

  async function renderTopAndDash(bank, hexDec, tokenKey) {
    const [price, act, totalfee, hexBal, totalStaked] = await Promise.all([
      bank.price(),
      bank.act(),
      bank.totalfee(),
      bank.hexBalance(),
      bank.totalStaked()
    ]);

    const inv = await getInventory(bank);
    const invSym = inv.symbol || tokenKey;

    // 헤더 카드 id 유지(기존 코드 깨짐 방지)
    if (el("hutPriceTop")) el("hutPriceTop").textContent = `${fmt(Number(ethers.formatUnits(price, PRICE_DECIMALS)), 6)}`;
    if (el("tvlTop")) el("tvlTop").textContent = `${fmt(Number(ethers.formatUnits(hexBal, hexDec)), 6)} HEX`;
    if (el("feeTop")) el("feeTop").textContent = `${fmt(Number(ethers.formatUnits(totalfee, hexDec)), 6)} HEX`;
    if (el("hxUsers")) el("hxUsers").textContent = "온체인 집계불가";

    // 상세 대시보드(있으면 채움)
    if (el("dashHexBal")) el("dashHexBal").textContent = `${fmt(Number(ethers.formatUnits(hexBal, hexDec)), 6)} HEX`;
    if (el("dashTokenBal")) el("dashTokenBal").textContent = `${Number(inv.value)} ${invSym}`;
    if (el("dashTotalStaked")) el("dashTotalStaked").textContent = `${Number(totalStaked)} ${invSym}`;
    if (el("dashTotalFee")) el("dashTotalFee").textContent = `${fmt(Number(ethers.formatUnits(totalfee, hexDec)), 6)} HEX`;
    if (el("dashAct")) el("dashAct").textContent = actToText(act);
  }

  async function main() {
    try {
      setCal();
      if (window.feather) feather.replace();
      if (!window.ApexCharts) return;

      const tokenKey = getTokenKey();
      const bankAddr = bankAddressFromKey(tokenKey);

      const rp = new ethers.JsonRpcProvider(cfg.rpcUrl);
      const bank = new ethers.Contract(bankAddr, bankAbiDash, rp);

      // HEX decimals
      const hex = new ethers.Contract(cfg.contracts.hex, erc20Abi, rp);
      let hexDec = 18;
      try { hexDec = Number(await hex.decimals()); } catch {}

      await renderTopAndDash(bank, hexDec, tokenKey);

      const data = await loadChartData(bank);
      renderChart(data, tokenKey);

      setInterval(async () => {
        try {
          setCal();
          await renderTopAndDash(bank, hexDec, tokenKey);
          const d2 = await loadChartData(bank);
          renderChart(d2, tokenKey);
        } catch {}
      }, (cfg?.ui?.refreshIntervalMs || 15000));

    } catch (e) {
      const t = el("myChart");
      if (t) t.innerHTML = `<div style="padding:14px;color:#b00;font-size:13px;">대시보드 로딩 실패: ${String(e?.message || e)}</div>`;
      console.error(e);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", main);
  } else {
    main();
  }
})();
