// /assets/js/header-wallet.js
(() => {
  const ethers = window.ethers;
  if (!ethers) return;

  const $ = (id) => document.getElementById(id);

  const TOKENS = [
    { key: "USDT", addr: "0x9e5aac1ba1a2e6aed6b32689dfcf62a509ca96f3" },
    { key: "HEX",  addr: "0x41F2Ea9F4eF7c4E35ba1a8438fC80937eD4E5464" },
    { key: "HUT",  addr: "0x3e31344335C77dA37cb2Cf409117e1dCa5Fda634" },
    { key: "BUT",  addr: "0xc159663b769E6c421854E913460b973899B76E42" },
    { key: "VET",  addr: "0xff8eCA08F731EAe46b5e7d10eBF640A8Ca7BA3D4" },
    { key: "EXP",  addr: "0xBc619cb03c0429731AF66Ae8ccD5aeE917A6E5f4" },
    { key: "PUT",  addr: "0xE0fD5e1C6D832E71787BfB3E3F5cdB5dd2FD41b6" },
  ];

  const FALLBACK_DECIMALS = {
    USDT: 18,
    HEX: 18,
    HUT: 0,
    BUT: 0,
    VET: 0,
    EXP: 0,
    PUT: 0,
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
        `USDT ${b.USDT} | HEX ${b.HEX} | HUT ${b.HUT} | BUT ${b.BUT} | VET ${b.VET} | EXP ${b.EXP} | PUT ${b.PUT}`;
      setHeaderStatus(`지갑연결됨: ${shortAddr(user)} | ${line}`, true);
    } catch (e) {
      console.error(e);
      setHeaderStatus(`지갑연결됨: ${shortAddr(user)} | 잔액 조회 실패`, true);
    }
  }

  async function connect() {
    if (!window.ethereum) {
      alert("지갑(메타마스크/라비)을 설치해주세요.");
      return;
    }

    const provider = new ethers.BrowserProvider(window.ethereum);

    try {
      await provider.send("eth_requestAccounts", []);
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

  function bind() {
    const btn = $("btnConnect");
    if (btn) btn.addEventListener("click", connect);
  }

  window.addEventListener("partials:loaded", bind);
  document.addEventListener("DOMContentLoaded", bind);
})();
