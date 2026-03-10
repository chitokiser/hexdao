// /assets/js/index.js
/* global ethers */
(() => {
  const $ = (id) => document.getElementById(id);

  // ── JumpSigner: Jump 수탁 지갑용 ethers.js v6 커스텀 서명자 ────────────
  // 잔액 조회·표시는 완전히 동작합니다.
  // 트랜잭션 서명(approve, swap 등)은 Jump API에 /signTransaction 엔드포인트가
  // 추가되면 signTransaction() 내부를 구현하면 됩니다.
  class JumpSigner extends ethers.AbstractSigner {
    constructor(jumpWallet, provider) {
      super(provider);
      this._j = jumpWallet;
    }

    async getAddress() {
      return this._j.address;
    }

    // personal_sign 방식 메시지 서명 (Jump /signMessage 사용)
    async signMessage(message) {
      const msg = typeof message === 'string'
        ? message
        : ethers.hexlify(message);
      if (msg.length > 200) throw new Error('Jump signMessage: 200자를 초과할 수 없습니다.');
      const result = await this._j.signMsg(msg);
      return result.signature;
    }

    async signTransaction(_tx) {
      throw new Error('Jump: signTransaction은 sendTransaction을 통해 처리됩니다.');
    }

    async sendTransaction(tx) {
      const token = await this._j.getIdToken();

      // calldata 디코딩 → Jump API contract 타입으로 변환
      const IFACE = new ethers.Interface([
        'function approve(address spender, uint256 amount) returns (bool)',
        'function depositUSDT(uint256 amount)',
        'function redeemHEX(uint256 amount)',
      ]);

      let jumpTx;
      try {
        const decoded = IFACE.parseTransaction({ data: tx.data || '0x' });
        const args = decoded.args.map((a) => a.toString());
        jumpTx = {
          type:   'contract',
          to:     tx.to,
          abi:    [decoded.fragment.format('full')],
          method: decoded.name,
          args,
        };
      } catch {
        throw new Error('Jump: 지원하지 않는 트랜잭션 형식입니다. calldata: ' + (tx.data || '0x').slice(0, 10));
      }

      console.log('[Jump] sendTransaction 요청:', JSON.stringify(jumpTx));
      const result = await window.jumpSignTx(token, jumpTx);
      console.log('[Jump] sendTransaction 응답:', JSON.stringify(result));

      const txHash = result?.data?.txHash || result?.txHash;
      if (!txHash) throw new Error('Jump sendTransaction: txHash 없음. 응답: ' + JSON.stringify(result));

      const provider = this.provider;
      return {
        hash: txHash,
        wait: async (confirms = 1) => {
          let receipt = null;
          while (!receipt || receipt.confirmations < confirms) {
            await new Promise((r) => setTimeout(r, 2000));
            receipt = await provider.getTransactionReceipt(txHash).catch(() => null);
          }
          return receipt;
        },
      };
    }

    async signTypedData(_domain, _types, _value) {
      throw new Error('Jump 수탁 지갑은 signTypedData를 지원하지 않습니다.');
    }

    connect(provider) {
      return new JumpSigner(this._j, provider);
    }
  }
  // ────────────────────────────────────────────────────────────────────────

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

      // ── Jump 수탁 지갑 (Google 로그인 완료된 경우) ────────────────────
      if (window.jumpWallet) {
        user = window.jumpWallet.address;
        console.log('[HEX] Jump 지갑 주소:', user);
        if (!user) {
          setStatus('Jump 지갑 주소 없음 - 콘솔에서 verifyUser 응답 확인 필요');
          return;
        }
        const provider = window.__jumpProvider
          || new ethers.JsonRpcProvider(getCfg().rpcUrl);
        signer = new JumpSigner(window.jumpWallet, provider);
        await refreshWalletButtons();
        setStatus('Jump 수탁 지갑 연결: ' + user.slice(0, 6) + '...' + user.slice(-4));
        return;
      }

      // ── MetaMask / Rabby 개인 지갑 ────────────────────────────────────
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

  window.__hexdaoConnect = connect;

  window.addEventListener("partials:loaded", () => {
    bindConnectButton();
  });

  window.addEventListener("jump:connected", () => {
    console.log('[HEX] jump:connected → jumpWallet:', window.jumpWallet);
    connect().catch((e) => console.error('[HEX] connect() 실패:', e));
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
