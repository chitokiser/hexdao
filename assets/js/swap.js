// /assets/js/swap.js
(() => {
  const cfg = window.HEXDAO_CONFIG;
  if (!cfg) return;

  const $ = (id) => document.getElementById(id);

  const setStatus = (t) => {
    const el = $("statusSwap");
    if (el) el.textContent = `상태: ${t}`;
  };

  const ABI_BANK = [
    "function price() view returns (uint256)",
    "function totalStaked() view returns (uint256)",
    "function divisor() view returns (uint256)",
    "function pendingDividend(address) view returns (uint256)",
    "function user(address) view returns (uint256,uint256,uint256,uint256,uint256)"
  ];

  const ABI_ERC20 = [
    "function balanceOf(address) view returns (uint256)"
  ];

  function isAddress(a) {
    try { return ethers.isAddress(a); } catch { return false; }
  }

  function trimDecimals(str, maxFrac = 6) {
    const s = String(str);
    if (!s.includes(".")) return s;
    const [a, b] = s.split(".");
    const bb = b.slice(0, maxFrac).replace(/0+$/, "");
    return bb.length ? `${a}.${bb}` : a;
  }

  function fmt18(u, maxFrac = 6) {
    try { return trimDecimals(ethers.formatUnits(u, 18), maxFrac); }
    catch { return String(u); }
  }

  function fmtPriceDisplay(priceRaw) {
    try {
      const bn = BigInt(priceRaw.toString());
      if (bn >= 1_000_000_000_000n) return fmt18(priceRaw, 6);
      return trimDecimals(String(Number(priceRaw) / 100), 6);
    } catch {
      return String(priceRaw);
    }
  }

  function normalizePriceWei(priceRaw) {
    try {
      const bn = BigInt(priceRaw.toString());
      if (bn >= 1_000_000_000_000n) return bn;
      return bn * 10n ** 16n;
    } catch {
      return 0n;
    }
  }

  async function getConnectedAddress() {
    if (!window.ethereum) return null;
    try {
      const a = await window.ethereum.request({ method: "eth_accounts" });
      return a?.[0] || null;
    } catch {
      return null;
    }
  }

  // 이미지 클릭 → 지갑에 토큰 추가
  async function addTokenToWallet(tokenKey) {
    try {
      if (!window.ethereum?.request) {
        alert("지갑 확장이 필요합니다.");
        return;
      }

      const list = cfg.tokens || cfg.tokenList || [];
      const t = list.find(x => (x.key || x.symbol) === tokenKey);
      if (!t) return;

      const tokenAddress = t.address || t.token || t.contract;
      if (!isAddress(tokenAddress)) return;

      await window.ethereum.request({
        method: "wallet_watchAsset",
        params: {
          type: "ERC20",
          options: {
            address: tokenAddress,
            symbol: t.symbol || tokenKey,
            decimals: typeof t.decimals === "number" ? t.decimals : 0,
            image: t.icon || ""
          }
        }
      });
    } catch (e) {
      console.error("wallet_watchAsset error", e);
    }
  }

  window.HEXDAO_addTokenToWallet = addTokenToWallet;

  function tokenImgHtml(t) {
    const key = t.key || t.symbol || "";
    const src = t.icon || "/assets/images/hexlogo.png";
    const name = t.symbol || t.name || key;

    return `
      <img
        src="${src}"
        alt="${name}"
        title="클릭하면 지갑에 토큰 추가"
        onclick="HEXDAO_addTokenToWallet('${key}')"
        style="width:28px;height:28px;border-radius:50%;margin-right:8px;cursor:pointer;vertical-align:middle;object-fit:cover;"
      />
    `;
  }

  function rowHtml(t, i) {
    const key = t.key || `${t.symbol || "T"}_${i}`;
    t.key = key;

    const paramName = cfg.urlTokenParam || "id";
    const href = `tokendetail.html?${encodeURIComponent(paramName)}=${encodeURIComponent(key)}`;

    return `
      <tr style="border-bottom:1px solid #e7e7e7;">
        <td style="padding:10px;">
          ${tokenImgHtml(t)}
          <span style="vertical-align:middle;">${t.symbol || key}</span>
        </td>

        <td style="padding:10px;" id="price_${key}">-</td>
        <td style="padding:10px;" id="staked_${key}">-</td>
        <td style="padding:10px;" id="roi_${key}">-</td>
        <td style="padding:10px;" id="tvl_${key}">-</td>

        <td style="padding:10px;">
          <a href="${href}" class="token-detail-btn">상세 →</a>
        </td>
      </tr>
    `;
  }

  function getTokenList() {
    return cfg.tokens || cfg.tokenList || [];
  }

  function buildTable() {
    const tbody = $("swapRows");
    if (!tbody) return;
    tbody.innerHTML = getTokenList().map(rowHtml).join("");
  }

  async function readDivisor(bank) {
    try {
      const d = await bank.divisor();
      const bn = BigInt(d.toString());
      return bn === 0n ? 10n ** 18n : bn;
    } catch {
      return 10n ** 18n;
    }
  }

  function calcEstApr(hb, staked, divisor, priceWei) {
    try {
      const ts = BigInt(staked.toString());
      if (ts === 0n) return "-";

      const weekly = (BigInt(hb) / ts) / BigInt(divisor);
      const annual = weekly * 52n;
      const apr = (annual * 10000n) / BigInt(priceWei);
      return `${Number(apr) / 100}%`;
    } catch {
      return "-";
    }
  }

  function calcMyApr(weeklyWei, depo, priceWei) {
    try {
      const annual = BigInt(weeklyWei) * 52n;
      const invested = BigInt(depo) * BigInt(priceWei);
      if (invested === 0n) return "-";
      const apr = (annual * 10000n) / invested;
      return `${Number(apr) / 100}%`;
    } catch {
      return "-";
    }
  }

  async function refreshToken(rpc, t, myAddr) {
    if (!isAddress(t.bank) || !isAddress(cfg.contracts?.hex)) return;

    const bank = new ethers.Contract(t.bank, ABI_BANK, rpc);
    const hex = new ethers.Contract(cfg.contracts.hex, ABI_ERC20, rpc);
    const key = t.key;

    try {
      const [priceRaw, totalStaked, hb] = await Promise.all([
        bank.price(),
        bank.totalStaked(),
        hex.balanceOf(t.bank)
      ]);

      const priceWei = normalizePriceWei(priceRaw);
      const divisor = await readDivisor(bank);
      let roi = calcEstApr(hb, totalStaked, divisor, priceWei);

      if (myAddr) {
        try {
          const [u, weekly] = await Promise.all([
            bank.user(myAddr),
            bank.pendingDividend(myAddr)
          ]);
          const depo = BigInt(u?.[2] ?? 0);
          if (depo > 0n) roi = calcMyApr(weekly, depo, priceWei);
        } catch {}
      }

      $("price_" + key).textContent = fmtPriceDisplay(priceRaw) + " HEX";
      $("staked_" + key).textContent = totalStaked.toString();
      $("tvl_" + key).textContent = fmt18(hb) + " HEX";
      $("roi_" + key).textContent = roi;
    } catch (e) {
      console.error("refresh error:", key, e);
    }
  }

  async function refreshAll() {
    setStatus("실시간 갱신중");
    const rpc = new ethers.JsonRpcProvider(cfg.rpcUrl);
    const myAddr = await getConnectedAddress();

    for (const t of getTokenList()) {
      await refreshToken(rpc, t, myAddr);
    }
    setStatus("대기");
  }

  function boot() {
    buildTable();
    refreshAll();
    setInterval(refreshAll, 8000);

    if (window.ethereum) {
      ethereum.on?.("accountsChanged", refreshAll);
      ethereum.on?.("chainChanged", refreshAll);
    }
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
