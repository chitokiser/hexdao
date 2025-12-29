// /assets/js/index.js
/* global ethers */
(() => {
  const $ = (id) => document.getElementById(id);

  function setStatus(msg) {
    const el = $("status");
    if (el) el.textContent = "상태: " + msg;
  }

  function fmt(n, dp = 6) {
    const x = Number(n);
    if (!isFinite(x)) return "-";
    return x.toLocaleString(undefined, { maximumFractionDigits: dp });
  }

  function getCfg() {
    const cfg = window.HEXDAO_CONFIG;
    if (!cfg) throw new Error("HEXDAO_CONFIG 없음 (config.js 로드 확인)");
    if (!cfg.rpcUrl) throw new Error("rpcUrl 누락");
    if (!cfg.contracts) throw new Error("contracts 누락");
    if (!cfg.contracts.usdt || !cfg.contracts.hex || !cfg.contracts.vault) {
      throw new Error("contracts.usdt/hex/vault 누락");
    }
    if (!Array.isArray(cfg.erc20Abi) || !cfg.erc20Abi.length) throw new Error("erc20Abi 누락");
    if (!Array.isArray(cfg.vaultAbi) || !cfg.vaultAbi.length) throw new Error("vaultAbi 누락");
    return cfg;
  }

  let readProvider = null;
  let browserProvider = null;
  let signer = null;
  let user = null;

  let usdtDec = 18;
  let hexDec = 18;
  let decimalsLoaded = false;

  function getReadProvider(cfg) {
    if (!readProvider) readProvider = new ethers.JsonRpcProvider(cfg.rpcUrl);
    return readProvider;
  }

  function getReadContracts() {
    const cfg = getCfg();
    const rp = getReadProvider(cfg);

    const usdt = new ethers.Contract(cfg.contracts.usdt, cfg.erc20Abi, rp);
    const hex  = new ethers.Contract(cfg.contracts.hex,  cfg.erc20Abi, rp);
    const vault = new ethers.Contract(cfg.contracts.vault, cfg.vaultAbi, rp);

    return { cfg, usdt, hex, vault };
  }

  async function loadDecimalsOnce() {
    if (decimalsLoaded) return;
    const { usdt, hex } = getReadContracts();
    try { usdtDec = await usdt.decimals(); } catch {}
    try { hexDec  = await hex.decimals(); } catch {}
    decimalsLoaded = true;
  }

  async function refreshWalletButtons() {
    if (!user) return;

    const { usdt, hex } = getReadContracts();
    await loadDecimalsOnce();

    const u = await usdt.balanceOf(user);
    const h = await hex.balanceOf(user);

    if ($("btnShowUSDT")) $("btnShowUSDT").textContent = "보유 USDT " + fmt(Number(ethers.formatUnits(u, usdtDec)), 6);
    if ($("btnShowHEX"))  $("btnShowHEX").textContent  = "보유 HEX "  + fmt(Number(ethers.formatUnits(h, hexDec)), 6);
  }

  async function connect() {
    try {
      getCfg();

      if (!window.ethereum) {
        alert("지갑이 필요합니다. MetaMask/Rabby 설치 후 다시 시도하세요.");
        return;
      }

      browserProvider = new ethers.BrowserProvider(window.ethereum);
      await browserProvider.send("eth_requestAccounts", []);
      signer = await browserProvider.getSigner();
      user = await signer.getAddress();

      await refreshWalletButtons();
      setStatus("지갑 연결 완료: " + user.slice(0, 6) + "..." + user.slice(-4));
    } catch (e) {
      console.error(e);
      setStatus("지갑 연결 실패: " + (e?.message || String(e)));
    }
  }

  async function ensureAllowance(tokenRead, owner, spender, needWei) {
    const allowance = await tokenRead.allowance(owner, spender);
    if (allowance >= needWei) return;

    const tokenWrite = tokenRead.connect(signer);
    const tx = await tokenWrite.approve(spender, needWei);
    setStatus("approve 진행중: " + tx.hash);
    await tx.wait();
  }

  async function doSwapUsdtToHex() {
    try {
      if (!signer || !user) { setStatus("지갑 연결 필요"); return; }

      const amt = Number(($("inpUsdt")?.value || "0"));
      if (!(amt > 0)) { setStatus("USDT 수량 입력"); return; }

      const { cfg, usdt, vault } = getReadContracts();
      await loadDecimalsOnce();

      const needWei = ethers.parseUnits(String(amt), usdtDec);

      setStatus("USDT 승인 확인중...");
      await ensureAllowance(usdt, user, cfg.contracts.vault, needWei);

      const tx = await vault.connect(signer).depositUSDT(needWei);
      setStatus("교환 진행중: " + tx.hash);
      await tx.wait();

      setStatus("완료");
      await refreshWalletButtons();
    } catch (e) {
      console.error(e);
      setStatus("실패: " + (e?.shortMessage || e?.message || String(e)));
    }
  }

  async function doSwapHexToUsdt() {
    try {
      if (!signer || !user) { setStatus("지갑 연결 필요"); return; }

      const amt = Number(($("inpHex")?.value || "0"));
      if (!(amt > 0)) { setStatus("HEX 수량 입력"); return; }

      const { cfg, hex, vault } = getReadContracts();
      await loadDecimalsOnce();

      const needWei = ethers.parseUnits(String(amt), hexDec);

      setStatus("HEX 승인 확인중...");
      await ensureAllowance(hex, user, cfg.contracts.vault, needWei);

      const tx = await vault.connect(signer).redeemHEX(needWei);
      setStatus("교환 진행중: " + tx.hash);
      await tx.wait();

      setStatus("완료");
      await refreshWalletButtons();
    } catch (e) {
      console.error(e);
      setStatus("실패: " + (e?.shortMessage || e?.message || String(e)));
    }
  }

  function updateEst() {
    const u = Number(($("inpUsdt")?.value || "0"));
    const h = Number(($("inpHex")?.value || "0"));
    if ($("estHex"))  $("estHex").textContent  = "예상 수령 HEX: "  + (u > 0 ? fmt(u, 6) : "-");
    if ($("estUsdt")) $("estUsdt").textContent = "예상 수령 USDT: " + (h > 0 ? fmt(h, 6) : "-");
  }

  // partials.js와 공존: 헤더가 로드된 뒤 버튼이 생기므로 여기서 바인딩
  function bindConnectButton() {
    let btn = document.getElementById("btnConnect");
    if (!btn) {
      const all = Array.from(document.querySelectorAll("button, a"));
      btn = all.find((el) => (el.textContent || "").trim() === "지갑연결") || null;
    }
    if (!btn) return;

    if (btn.dataset.boundConnect === "1") return;
    btn.dataset.boundConnect = "1";

    btn.addEventListener("click", (e) => {
      e.preventDefault();
      connect();
    });
  }

  function bindPageButtons() {
    $("btnShowUSDT")?.addEventListener("click", () => refreshWalletButtons().catch(()=>{}));
    $("btnShowHEX")?.addEventListener("click", () => refreshWalletButtons().catch(()=>{}));
    $("btnSwapToHex")?.addEventListener("click", doSwapUsdtToHex);
    $("btnSwapToUsdt")?.addEventListener("click", doSwapHexToUsdt);

    $("inpUsdt")?.addEventListener("input", updateEst);
    $("inpHex")?.addEventListener("input", updateEst);
    updateEst();
  }

  window.addEventListener("partials:loaded", () => {
    bindConnectButton();
  });

  document.addEventListener("DOMContentLoaded", () => {
    bindPageButtons();
    setStatus("대기");
    setTimeout(bindConnectButton, 300);
    setTimeout(bindConnectButton, 1200);
  });

  if (window.ethereum) {
    window.ethereum.on("accountsChanged", () => location.reload());
    window.ethereum.on("chainChanged", () => location.reload());
  }
})();
