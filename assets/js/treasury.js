// /assets/js/treasury.js
(() => {
  const cfg = window.HEXDAO_CONFIG;
  if (!cfg) return;

  const $ = (id) => document.getElementById(id);

  function setStatus(msg) {
    const el = $("statusTreasury");
    if (el) el.textContent = `상태: ${msg}`;
  }

  function shortAddr(a) {
    if (!a || a.length < 10) return a || "-";
    return `${a.slice(0, 6)}...${a.slice(-4)}`;
  }

  function fmtInt(x) {
    try { return ethers.formatUnits(x, 0); } catch { return String(x); }
  }

  function trimDecimals(str, maxFrac = 6) {
    const s = String(str);
    if (!s.includes(".")) return s;
    const [a, b] = s.split(".");
    const bb = b.slice(0, maxFrac).replace(/0+$/, "");
    return bb.length ? `${a}.${bb}` : a;
  }

  function fmt18(x, maxFrac = 6) {
    try { return trimDecimals(ethers.formatUnits(x, 18), maxFrac); }
    catch { return String(x); }
  }

  function fmtSec(s) {
    const n = Number(s);
    if (!isFinite(n) || n <= 0) return "-";
    const d = Math.floor(n / 86400);
    const h = Math.floor((n % 86400) / 3600);
    const m = Math.floor((n % 3600) / 60);
    if (d > 0) return `${d}일 ${h}시간`;
    if (h > 0) return `${h}시간 ${m}분`;
    return `${m}분`;
  }

  async function getBrowserProvider() {
    if (!window.ethereum) throw new Error("지갑이 없습니다. MetaMask/Rabby 설치 필요");
    return new ethers.BrowserProvider(window.ethereum);
  }

  async function ensureWalletConnected() {
    const provider = await getBrowserProvider();
    await provider.send("eth_requestAccounts", []);
    const signer = await provider.getSigner();
    const account = await signer.getAddress();
    return { provider, signer, account };
  }

  async function ensureChain(provider) {
    // opBNB mainnet chainId = 0xCC
    const want = String(cfg.chainIdHex || "0xCC").toLowerCase();
    const got = String(await provider.send("eth_chainId", [])).toLowerCase();
    if (got !== want) throw new Error(`네트워크가 다릅니다. 현재 ${got}, 필요 ${want}`);
  }

  // ===== ABI =====
  const ABI_ERC20 = cfg.erc20Abi || [
    "function balanceOf(address) view returns (uint256)",
    "function decimals() view returns (uint8)",
    "function symbol() view returns (string)"
  ];

  const ABI_BANK = [
    "function totalStaked() view returns (uint256)",
    "function pendingDividend(address) view returns (uint256)",
    "function user(address) view returns (uint256 totalAllow, uint256 totalBuy, uint256 depo, uint256 stakingTime, uint256 lastClaim)"
  ];

  const ABI_TREASURY = [
    "function beneficiary() view returns (address)",
    "function nextProposalId() view returns (uint256)",
    "function proposals(uint256) view returns (uint256 id, uint256 amount, uint256 startTime, uint256 endTime, uint256 executeAfter, uint256 yesVotes, uint256 noVotes, bool executed, bool canceled)",
    "function quorumRequired() view returns (uint256)",
    "function timeToEnd(uint256) view returns (uint256)",
    "function isEarlyPassed(uint256) view returns (bool)",
    "function treasuryBalance() view returns (uint256)",

    "function createWithdrawProposal(uint256 amount) returns (uint256)",
    "function vote(uint256 proposalId, bool support)",
    "function execute(uint256 proposalId)"
  ];

  // ===== config.js(당신 버전) 호환: cfg.tokens 우선 =====
  function buildSectors() {
    const list = Array.isArray(cfg.tokens) ? cfg.tokens
               : Array.isArray(cfg.tokenList) ? cfg.tokenList
               : [];

    const out = [];

    for (const t of list) {
      const key = String(t.key || t.symbol || "").toUpperCase();
      if (!key) continue;

      // config.js TOKENS 구조 그대로 사용
      const tokenAddr = t.token || (cfg.contracts && (cfg.contracts[key.toLowerCase()] || cfg.contracts[key]));
      const bankAddr = t.bank || (cfg.contracts && (cfg.contracts[`${key.toLowerCase()}bank`] || cfg.contracts[`${key}bank`]));
      const treAddr = t.treasury || (cfg.contracts && (cfg.contracts[`${key.toLowerCase()}Treasury`] || cfg.contracts[`${key}Treasury`]));

      if (!tokenAddr || !bankAddr || !treAddr) continue;

      out.push({
        key,
        title: `${key} 금고`,
        tokenSymbol: key,
        tokenAddress: tokenAddr,
        bankAddress: bankAddr,
        treasuryAddress: treAddr,
        explorer: cfg.explorer || "https://opbnbscan.com/address/"
      });
    }

    return out;
  }

  function renderSector(sector) {
    const wrap = document.createElement("div");
    wrap.className = "swap-box";
    wrap.style.marginBottom = "16px";
    wrap.style.padding = "18px";
    wrap.style.borderRadius = "14px";

    wrap.innerHTML = `
      <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:10px;">
        <div>
          <div style="font-size:18px; font-weight:700;">${sector.title}</div>
          <div style="margin-top:6px; font-size:12px; color:#555;">
            token:
            <a href="${sector.explorer}${sector.tokenAddress}" target="_blank" rel="noreferrer">${shortAddr(sector.tokenAddress)}</a>
            | bank:
            <a href="${sector.explorer}${sector.bankAddress}" target="_blank" rel="noreferrer">${shortAddr(sector.bankAddress)}</a>
            | treasury:
            <a href="${sector.explorer}${sector.treasuryAddress}" target="_blank" rel="noreferrer">${shortAddr(sector.treasuryAddress)}</a>
          </div>
        </div>

        <button class="big-btn" id="btnConnect_${sector.key}" type="button" style="height:44px; padding:0 16px;">
          지갑연결
        </button>
      </div>

      <div class="hr" style="margin:14px 0;"></div>

      <div style="display:grid; grid-template-columns:repeat(4, minmax(0,1fr)); gap:12px;" class="treGrid4">
        <div class="inf" style="border:1px solid #d9d9d9; border-radius:12px; padding:12px;">
          <div class="k">금고 잔고</div>
          <div class="v" id="tBal_${sector.key}">-</div>
        </div>
        <div class="inf" style="border:1px solid #d9d9d9; border-radius:12px; padding:12px;">
          <div class="k">총 스테이킹(bank)</div>
          <div class="v" id="tTotalStaked_${sector.key}">-</div>
        </div>
        <div class="inf" style="border:1px solid #d9d9d9; border-radius:12px; padding:12px;">
          <div class="k">정족수(필요)</div>
          <div class="v" id="tQuorum_${sector.key}">-</div>
        </div>
        <div class="inf" style="border:1px solid #d9d9d9; border-radius:12px; padding:12px;">
          <div class="k">내 투표권(depo)</div>
          <div class="v" id="tMyPower_${sector.key}">지갑연결 필요</div>
        </div>
      </div>

      <div style="display:grid; grid-template-columns:repeat(2, minmax(0,1fr)); gap:12px; margin-top:12px;" class="treGrid2">
        <div class="form-box" style="border:1px solid #d9d9d9; border-radius:14px; padding:14px;">
          <div class="swap-top" style="display:flex; justify-content:space-between;">
            <div>출금 제안 생성</div>
            <div class="mono">createWithdrawProposal</div>
          </div>
          <div style="font-size:12px; color:#666; margin-top:6px;">
            beneficiary만 생성 가능. 수량은 정수(${sector.tokenSymbol} 개수).
          </div>
          <input class="input" id="inpPropAmt_${sector.key}" placeholder="예: 1000000" style="margin-top:10px;" />
          <button class="swap-btn" id="btnCreateProp_${sector.key}" style="margin-top:10px;">제안 생성</button>
          <div class="swap-est" id="propResult_${sector.key}">-</div>
        </div>

        <div class="form-box" style="border:1px solid #d9d9d9; border-radius:14px; padding:14px;">
          <div class="swap-top" style="display:flex; justify-content:space-between;">
            <div>내 스테이킹/배당(참고)</div>
            <div class="mono">bank.user / pendingDividend</div>
          </div>
          <div style="display:grid; grid-template-columns:repeat(2, minmax(0,1fr)); gap:10px; margin-top:10px;">
            <div>
              <div style="font-size:12px; color:#666;">depo</div>
              <div id="tMyDepo_${sector.key}" style="margin-top:4px;">-</div>
            </div>
            <div>
              <div style="font-size:12px; color:#666;">pendingDividend</div>
              <div id="tMyPend_${sector.key}" style="margin-top:4px;">-</div>
            </div>
          </div>
          <button class="smallbtn" id="btnRefresh_${sector.key}" style="margin-top:10px;">새로고침</button>
        </div>
      </div>

      <div class="hr" style="margin:14px 0;"></div>

      <div style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
        <div style="font-size:15px; font-weight:700;">최근 제안</div>
        <button class="smallbtn" id="btnLoadProps_${sector.key}" type="button">불러오기</button>
      </div>

      <div id="props_${sector.key}" style="margin-top:10px;"></div>

      <style>
        @media (max-width: 900px) {
          .treGrid4 { grid-template-columns: repeat(2, minmax(0,1fr)) !important; }
          .treGrid2 { grid-template-columns: repeat(1, minmax(0,1fr)) !important; }
        }
      </style>
    `;
    return wrap;
  }

  async function readCommon(sector, accountOpt) {
    const rpc = new ethers.JsonRpcProvider(cfg.rpcUrl);

    const token = new ethers.Contract(sector.tokenAddress, ABI_ERC20, rpc);
    const bank  = new ethers.Contract(sector.bankAddress, ABI_BANK, rpc);
    const tre   = new ethers.Contract(sector.treasuryAddress, ABI_TREASURY, rpc);

    const [bal, totalStaked, quorumReq] = await Promise.all([
      tre.treasuryBalance().catch(() => token.balanceOf(sector.treasuryAddress)),
      bank.totalStaked().catch(() => 0n),
      tre.quorumRequired().catch(() => 0n)
    ]);

    const elBal = $(`tBal_${sector.key}`);
    const elTs  = $(`tTotalStaked_${sector.key}`);
    const elQ   = $(`tQuorum_${sector.key}`);

    if (elBal) elBal.textContent = `${fmtInt(bal)} ${sector.tokenSymbol}`;
    if (elTs)  elTs.textContent  = `${fmtInt(totalStaked)} ${sector.tokenSymbol}`;
    if (elQ)   elQ.textContent   = `${fmtInt(quorumReq)} ${sector.tokenSymbol}`;

    if (accountOpt) {
      const [u, pend] = await Promise.all([
        bank.user(accountOpt).catch(() => null),
        bank.pendingDividend(accountOpt).catch(() => 0n)
      ]);

      const depo = u ? u[2] : 0n;

      const elPower = $(`tMyPower_${sector.key}`);
      const elDepo  = $(`tMyDepo_${sector.key}`);
      const elPend  = $(`tMyPend_${sector.key}`);

      if (elPower) elPower.textContent = `${fmtInt(depo)} ${sector.tokenSymbol}`;
      if (elDepo)  elDepo.textContent  = `${fmtInt(depo)} ${sector.tokenSymbol}`;
      if (elPend)  elPend.textContent  = `${fmt18(pend)} HEX`;
    } else {
      const elPower = $(`tMyPower_${sector.key}`);
      const elDepo  = $(`tMyDepo_${sector.key}`);
      const elPend  = $(`tMyPend_${sector.key}`);
      if (elPower) elPower.textContent = "지갑연결 필요";
      if (elDepo)  elDepo.textContent  = "지갑연결 필요";
      if (elPend)  elPend.textContent  = "지갑연결 필요";
    }
  }

  function renderProposalCard(sector, p) {
    const id = Number(p.id);
    const amount = fmtInt(p.amount);
    const yes = fmtInt(p.yesVotes);
    const no = fmtInt(p.noVotes);

    const box = document.createElement("div");
    box.style.border = "1px solid #d9d9d9";
    box.style.borderRadius = "14px";
    box.style.padding = "14px";
    box.style.marginBottom = "10px";

    const executed = !!p.executed;
    const canceled = !!p.canceled;

    box.innerHTML = `
      <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:10px;">
        <div>
          <div style="font-size:15px; font-weight:700;">제안 #${id}</div>
          <div style="font-size:12px; color:#666; margin-top:4px;">
            요청 수량: ${amount} ${sector.tokenSymbol}
          </div>
        </div>
        <div style="font-size:12px; color:#666;">
          상태: ${canceled ? "취소" : executed ? "실행완료" : "진행/대기"}
        </div>
      </div>

      <div style="display:grid; grid-template-columns:repeat(4, minmax(0,1fr)); gap:10px; margin-top:10px;" class="treGrid4">
        <div style="border:1px solid #eee; border-radius:12px; padding:10px;">
          <div style="font-size:12px; color:#666;">찬성</div>
          <div style="margin-top:4px;">${yes}</div>
        </div>
        <div style="border:1px solid #eee; border-radius:12px; padding:10px;">
          <div style="font-size:12px; color:#666;">반대</div>
          <div style="margin-top:4px;">${no}</div>
        </div>
        <div style="border:1px solid #eee; border-radius:12px; padding:10px;">
          <div style="font-size:12px; color:#666;">투표 종료까지</div>
          <div style="margin-top:4px;" id="tEnd_${sector.key}_${id}">-</div>
        </div>
        <div style="border:1px solid #eee; border-radius:12px; padding:10px;">
          <div style="font-size:12px; color:#666;">조기 가결</div>
          <div style="margin-top:4px;" id="tEarly_${sector.key}_${id}">-</div>
        </div>
      </div>

      <div style="display:flex; gap:10px; margin-top:10px; flex-wrap:wrap;">
        <button class="smallbtn" id="btnYes_${sector.key}_${id}" type="button">찬성</button>
        <button class="smallbtn" id="btnNo_${sector.key}_${id}" type="button">반대</button>
        <button class="primarybtn" id="btnExec_${sector.key}_${id}" type="button" style="padding:10px 14px;">execute</button>
      </div>

      <div style="font-size:12px; color:#666; margin-top:8px;" id="tMsg_${sector.key}_${id}">-</div>
    `;

    return box;
  }

  async function refreshProposalMeta(sector, proposalId) {
    const rpc = new ethers.JsonRpcProvider(cfg.rpcUrl);
    const tre = new ethers.Contract(sector.treasuryAddress, ABI_TREASURY, rpc);

    const [left, early] = await Promise.all([
      tre.timeToEnd(proposalId).catch(() => 0n),
      tre.isEarlyPassed(proposalId).catch(() => false)
    ]);

    const id = Number(proposalId);
    const elEnd = $(`tEnd_${sector.key}_${id}`);
    const elEarly = $(`tEarly_${sector.key}_${id}`);
    if (elEnd) elEnd.textContent = fmtSec(left);
    if (elEarly) elEarly.textContent = early ? "가능" : "아님";
  }

  function bindProposalActions(sector, p, getAccount) {
    const id = Number(p.id);
    const btnYes = $(`btnYes_${sector.key}_${id}`);
    const btnNo = $(`btnNo_${sector.key}_${id}`);
    const btnExec = $(`btnExec_${sector.key}_${id}`);
    const msg = $(`tMsg_${sector.key}_${id}`);

    const say = (t) => { if (msg) msg.textContent = t; };

    const run = async (fn) => {
      try {
        setStatus("지갑 확인중");
        const { provider, signer, account } = await ensureWalletConnected();
        await ensureChain(provider);

        setStatus("트랜잭션 준비중");
        const treW = new ethers.Contract(sector.treasuryAddress, ABI_TREASURY, signer);

        const tx = await fn(treW, account);
        say(`tx: ${tx.hash}`);
        setStatus("대기중");
        await tx.wait();

        setStatus("완료");
        await loadProposals(sector, getAccount());
        await readCommon(sector, getAccount());
      } catch (e) {
        const reason = e?.shortMessage || e?.reason || e?.message || String(e);
        setStatus("에러");
        say(`에러: ${reason}`);
        console.error(e);
      }
    };

    if (btnYes) btnYes.onclick = () => run((treW) => treW.vote(id, true));
    if (btnNo) btnNo.onclick = () => run((treW) => treW.vote(id, false));
    if (btnExec) btnExec.onclick = () => run((treW) => treW.execute(id));
  }

  async function loadProposals(sector, accountOpt) {
    const rpc = new ethers.JsonRpcProvider(cfg.rpcUrl);
    const tre = new ethers.Contract(sector.treasuryAddress, ABI_TREASURY, rpc);

    const next = await tre.nextProposalId().catch(() => 0n);
    const n = Number(next);

    const host = $(`props_${sector.key}`);
    if (!host) return;

    host.innerHTML = "";
    if (!n || n <= 1) {
      host.innerHTML = `<div style="font-size:12px;color:#666;">표시할 제안이 없습니다.</div>`;
      return;
    }

    const from = Math.max(1, n - 10);
    const list = [];

    for (let i = n - 1; i >= from; i--) {
      const p = await tre.proposals(i).catch(() => null);
      if (!p) continue;
      if (Number(p.id) === 0) continue;
      list.push(p);
    }

    if (!list.length) {
      host.innerHTML = `<div style="font-size:12px;color:#666;">표시할 제안이 없습니다.</div>`;
      return;
    }

    for (const p of list) {
      const card = renderProposalCard(sector, p);
      host.appendChild(card);
      bindProposalActions(sector, p, () => accountOpt);
      await refreshProposalMeta(sector, p.id);
    }
  }

  async function bindSector(sector) {
    const btnConnect = $(`btnConnect_${sector.key}`);
    const btnRefresh = $(`btnRefresh_${sector.key}`);
    const btnLoad = $(`btnLoadProps_${sector.key}`);
    const btnCreate = $(`btnCreateProp_${sector.key}`);
    const inpAmt = $(`inpPropAmt_${sector.key}`);
    const propResult = $(`propResult_${sector.key}`);

    let account = null;

    const refreshAll = async () => {
      await readCommon(sector, account);
    };

    if (btnConnect) {
      btnConnect.onclick = async () => {
        try {
          setStatus("지갑 연결중");
          const r = await ensureWalletConnected();
          await ensureChain(r.provider);
          account = r.account;
          btnConnect.textContent = shortAddr(account);
          setStatus("지갑 연결됨");
          await refreshAll();
        } catch (e) {
          setStatus(`지갑 연결 실패: ${e?.shortMessage || e?.message || e}`);
        }
      };
    }

    if (btnRefresh) {
      btnRefresh.onclick = async () => {
        try {
          setStatus("새로고침");
          await refreshAll();
          setStatus("완료");
        } catch (e) {
          setStatus(`에러: ${e?.shortMessage || e?.message || e}`);
        }
      };
    }

    if (btnLoad) {
      btnLoad.onclick = async () => {
        try {
          setStatus("제안 불러오는 중");
          await loadProposals(sector, account);
          setStatus("완료");
        } catch (e) {
          setStatus(`에러: ${e?.shortMessage || e?.message || e}`);
        }
      };
    }

    if (btnCreate) {
      btnCreate.onclick = async () => {
        try {
          if (!inpAmt) return;
          const raw = String(inpAmt.value || "").trim();
          if (!raw) return;

          const amt = ethers.toBigInt(raw); // decimals=0
          setStatus("제안 생성중");

          const { provider, signer, account: a } = await ensureWalletConnected();
          await ensureChain(provider);
          account = a;
          if (btnConnect) btnConnect.textContent = shortAddr(account);

          const treW = new ethers.Contract(sector.treasuryAddress, ABI_TREASURY, signer);
          const tx = await treW.createWithdrawProposal(amt);
          if (propResult) propResult.textContent = `tx: ${tx.hash}`;
          await tx.wait();

          setStatus("제안 생성 완료");
          await loadProposals(sector, account);
          await refreshAll();
        } catch (e) {
          const reason = e?.shortMessage || e?.reason || e?.message || String(e);
          setStatus("에러");
          if (propResult) propResult.textContent = `에러: ${reason}`;
          console.error(e);
        }
      };
    }

    await refreshAll();
    await loadProposals(sector, account);
  }

  async function hookTopHeaderConnectButton(sectors) {
    const btn = $("btnConnect"); // head.html의 상단 지갑연결 버튼
    if (!btn) return;

    btn.onclick = async () => {
      try {
        setStatus("지갑 연결중");
        const { provider, account } = await ensureWalletConnected();
        await ensureChain(provider);

        btn.textContent = shortAddr(account);
        setStatus("지갑 연결됨");

        for (const s of sectors) {
          const b2 = $(`btnConnect_${s.key}`);
          if (b2) b2.textContent = shortAddr(account);
          await readCommon(s, account);
        }
      } catch (e) {
        setStatus(`지갑 연결 실패: ${e?.shortMessage || e?.message || e}`);
      }
    };
  }

  let _inited = false;

  async function init() {
    if (_inited) return;
    _inited = true;

    try {
      const host = $("treasurySectors");
      if (!host) return;

      const sectors = buildSectors();

      if (!sectors.length) {
        host.innerHTML = `<div style="padding:14px;color:#666;font-size:13px;">
          섹터를 만들 수 없습니다. config.js의 TOKENS에 token/bank/treasury가 모두 있어야 합니다.
        </div>`;
        setStatus("설정 필요");
        return;
      }

      host.innerHTML = "";
      for (const s of sectors) host.appendChild(renderSector(s));

      await hookTopHeaderConnectButton(sectors);

      for (const s of sectors) {
        await bindSector(s);
      }

      setStatus("대기");
    } catch (e) {
      console.error(e);
      setStatus(`에러: ${e?.message || e}`);
    }
  }

  // partials를 쓰는 페이지/안쓰는 페이지 둘 다 동작하게
  window.addEventListener("partials:loaded", () => init());
  document.addEventListener("DOMContentLoaded", () => setTimeout(init, 0));
})();
