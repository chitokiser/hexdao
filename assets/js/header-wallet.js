// /assets/js/header-wallet.js
(() => {
  const ethers = window.ethers;
  if (!ethers) return;

  const $ = (id) => document.getElementById(id);

  const OPBNB_RPC = 'https://opbnb-mainnet-rpc.bnbchain.org';

  const TOKENS = [
    { key: "USDT", addr: "0x9e5aac1ba1a2e6aed6b32689dfcf62a509ca96f3" },
    { key: "HEX",  addr: "0x41F2Ea9F4eF7c4E35ba1a8438fC80937eD4E5464" },
    { key: "HUT",  addr: "0x3e31344335C77dA37cb2Cf409117e1dCa5Fda634" },
    { key: "BUT",  addr: "0xc159663b769E6c421854E913460b973899B76E42" },
    { key: "VET",  addr: "0xff8eCA08F731EAe46b5e7d10eBF640A8Ca7BA3D4" },
    { key: "EXP",  addr: "0xBc619cb03c0429731AF66Ae8ccD5aeE917A6E5f4" },
    { key: "PUT",  addr: "0xE0fD5e1C6D832E71787BfB3E3F5cdB5dd2FD41b6" },
    { key: "MKT",  addr: "0x2736e0Bab4C1b80E3A55443753F29F33475AADCB" },
  ];

  const FALLBACK_DECIMALS = {
    USDT: 18, HEX: 18, HUT: 0, BUT: 0, VET: 0, EXP: 0, PUT: 0, MKT: 0,
  };

  const ERC20_ABI = [
    "function balanceOf(address) view returns (uint256)",
    "function decimals() view returns (uint8)"
  ];

  function shortAddr(a) {
    if (!a || a.length < 10) return a || "";
    return a.slice(0, 6) + "..." + a.slice(-4);
  }

  function trimDecimals(str, maxFrac = 6) {
    const s = String(str);
    if (!s.includes(".")) return s;
    const [a, b] = s.split(".");
    const bb = b.slice(0, maxFrac).replace(/0+$/, "");
    return bb.length ? `${a}.${bb}` : a;
  }

  function fmtUnits(bn, dec, maxFrac = 6) {
    try { return trimDecimals(ethers.formatUnits(bn, dec), maxFrac); }
    catch { return String(bn); }
  }

  function setBtn(text) {
    const el = $("btnConnect");
    if (el) el.textContent = text;
  }

  function setHeaderStatus(text, onchain) {
    const el = $("headerStatusText");
    if (!el) return;
    el.textContent = text;
    el.classList.remove("onchain", "onchain-soft");
    if (onchain) el.classList.add("onchain");
  }

  async function getDecimalsSafe(c, key) {
    try {
      const d = await c.decimals();
      const n = Number(d);
      if (Number.isFinite(n) && n >= 0 && n <= 36) return n;
    } catch {}
    return FALLBACK_DECIMALS[key] ?? 18;
  }

  async function readBalances(provider, user) {
    const list = TOKENS.map(t => ({
      ...t,
      c: new ethers.Contract(t.addr, ERC20_ABI, provider)
    }));

    const decs = await Promise.all(list.map(t => getDecimalsSafe(t.c, t.key)));
    const bals = await Promise.all(list.map(async (t) => {
      try { return await t.c.balanceOf(user); } catch { return null; }
    }));

    const out = {};
    for (let i = 0; i < list.length; i++) {
      const k = list[i].key;
      const bn = bals[i];
      if (bn === null) out[k] = "-";
      else out[k] = fmtUnits(bn, decs[i], 6);
    }
    return out;
  }

  async function render(provider, user) {
    setBtn(shortAddr(user));
    setHeaderStatus(`지갑연결됨: ${shortAddr(user)} | 잔액 불러오는 중...`, true);

    try {
      const b = await readBalances(provider, user);
      const line =
        `USDT ${b.USDT} | HEX ${b.HEX} | HUT ${b.HUT} | BUT ${b.BUT} | VET ${b.VET} | EXP ${b.EXP} | PUT ${b.PUT} | MKT ${b.MKT}`;
      setHeaderStatus(`지갑연결됨: ${shortAddr(user)} | ${line}`, true);
    } catch (e) {
      console.error(e);
      setHeaderStatus(`지갑연결됨: ${shortAddr(user)} | 잔액 조회 실패`, true);
    }
  }

  // ── opBNB 자동 전환 (MetaMask/Rabby 전용) ──────────────────────────────
  async function ensureOpBNB() {
    if (!window.ethereum || !window.ethereum.request) throw new Error('지갑 인터페이스가 없습니다');
    try {
      const chainId = String(await window.ethereum.request({ method: 'eth_chainId' })).toLowerCase();
      if (chainId === '0xcc') return;

      try {
        await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0xCC' }] });
        return;
      } catch (switchErr) {
        const code = switchErr && (switchErr.code || switchErr.errorCode);
        if (code === 4902 || /Unrecognized chain|is not available/.test(String(switchErr.message || ''))) {
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [{
              chainId: '0xCC',
              chainName: 'opBNB Mainnet',
              nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
              rpcUrls: ['https://rpc.ankr.com/opbnb'],
              blockExplorerUrls: ['https://opbnbscan.com/']
            }]
          });
          await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0xCC' }] });
          return;
        }
        throw switchErr;
      }
    } catch (e) {
      console.error('ensureOpBNB 실패', e);
      throw new Error('opBNB 네트워크로 전환 실패: ' + (e?.message || e));
    }
  }

  // ── MetaMask / Rabby 개인 지갑 연결 ────────────────────────────────────
  async function connect() {
    // Jump 수탁 지갑이 이미 연결된 경우 MetaMask 연결 스킵
    if (window.jumpWallet) return;

    if (!window.ethereum) {
      alert("지갑(메타마스크/라비)을 설치해주세요.");
      return;
    }

    const provider = new ethers.BrowserProvider(window.ethereum);

    try {
      await provider.send("eth_requestAccounts", []);
      try {
        await ensureOpBNB();
      } catch (e) {
        console.error(e);
        alert(e?.message || 'opBNB 네트워크로 전환할 수 없습니다. 지갑에서 수동으로 변경해주세요.');
        return;
      }
      const signer = await provider.getSigner();
      const user = await signer.getAddress();
      await render(provider, user);

      try { window.ethereum.removeAllListeners("accountsChanged"); } catch {}
      try { window.ethereum.removeAllListeners("chainChanged"); } catch {}

      window.ethereum.on("accountsChanged", async (accounts) => {
        const addr = accounts && accounts[0];
        if (!addr) {
          setBtn("지갑연결");
          setHeaderStatus("HEX DAO현황", false);
          return;
        }
        await render(provider, addr);
      });

      window.ethereum.on("chainChanged", async () => {
        const signer2 = await provider.getSigner();
        const user2 = await signer2.getAddress();
        await render(provider, user2);
      });

      if (window.__hexdaoBalTimer) clearInterval(window.__hexdaoBalTimer);
      window.__hexdaoBalTimer = setInterval(async () => {
        try {
          const signer3 = await provider.getSigner();
          const user3 = await signer3.getAddress();
          await render(provider, user3);
        } catch {}
      }, 8000);
    } catch (e) {
      console.error(e);
      alert(e?.message || "지갑 연결 실패");
    }
  }

  // ── Firebase SDK 동적 로드 헬퍼 ────────────────────────────────────────
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('스크립트 로드 실패: ' + src));
      document.head.appendChild(s);
    });
  }

  const GOOGLE_BTN_HTML = `<svg width="16" height="16" viewBox="0 0 24 24" style="flex-shrink:0;"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg> 구글 로그인`;

  // ── Jump 지갑 연결 성공 후 공통 UI 처리 ──────────────────────────────────
  async function onJumpConnected(wallet) {
    const gBtn = $("btnGoogleLogin");
    const provider = new ethers.JsonRpcProvider(OPBNB_RPC);
    window.__jumpProvider = provider;

    await render(provider, wallet.address);
    window.dispatchEvent(new CustomEvent('jump:connected'));

    if (gBtn) {
      gBtn.innerHTML = `<span style="font-size:12px;">📧</span> ${wallet.email.split('@')[0]}`;
    }

    if (window.__hexdaoBalTimer) clearInterval(window.__hexdaoBalTimer);
    window.__hexdaoBalTimer = setInterval(async () => {
      try { await render(provider, wallet.address); } catch {}
    }, 8000);
  }

  // ── SDK 로드 헬퍼 ────────────────────────────────────────────────────────
  async function loadFirebaseAndJump() {
    const FBV = '9.23.0';
    await loadScript(`https://www.gstatic.com/firebasejs/${FBV}/firebase-app-compat.js`);
    await loadScript(`https://www.gstatic.com/firebasejs/${FBV}/firebase-auth-compat.js`);
    await loadScript('/assets/js/jump-auth.js');
  }

  // ── Google 로그인 (팝업 방식) ────────────────────────────────────────────
  let _jumpConnecting = false;
  async function connectJump() {
    const gBtn = $("btnGoogleLogin");

    if (window.jumpWallet) {
      if (confirm(`${window.jumpWallet.email} 로그아웃 하시겠습니까?`)) {
        await window.jumpLogout();
      }
      return;
    }

    if (_jumpConnecting) return;
    _jumpConnecting = true;
    if (gBtn) gBtn.textContent = '연결 중...';

    try {
      await loadFirebaseAndJump();
      const wallet = await window.jumpLogin();
      if (!wallet) return;
      await onJumpConnected(wallet);
    } catch (e) {
      console.error('Jump 로그인 실패', e);
      if (gBtn) gBtn.innerHTML = GOOGLE_BTN_HTML;
      if (e?.code !== 'auth/popup-closed-by-user') {
        alert(e?.message || 'Jump 로그인 실패');
      }
    } finally {
      _jumpConnecting = false;
    }
  }

  // ── 버튼 바인딩 ──────────────────────────────────────────────────────────
  function bind() {
    const btn = $("btnConnect");
    if (btn) btn.addEventListener("click", connect);

    const gBtn = $("btnGoogleLogin");
    if (gBtn) gBtn.addEventListener("click", connectJump);
  }

  window.addEventListener("partials:loaded", bind);
  document.addEventListener("DOMContentLoaded", bind);
})();
