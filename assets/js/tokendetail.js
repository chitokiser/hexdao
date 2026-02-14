// /assets/js/tokendetail.js  (전체 교체)
(() => {
  const cfg = window.HEXDAO_CONFIG;
  if (!cfg) return;

  const $ = (id) => document.getElementById(id);

  function setText(id, v) {
    const el = $(id);
    if (el) el.textContent = v;
  }

  function setStatus(msg) {
    if ($("statusTokenDetail")) setText("statusTokenDetail", `상태: ${msg}`);
    else if ($("status")) setText("status", `상태: ${msg}`);
  }

  // --- 2-step approve UX helpers ---
  function txLink(hash) {
    const base = cfg.explorerTxBase || "";
    if (!hash) return "";
    if (!base) return hash;
    return `<a href="${base}${hash}" target="_blank" rel="noopener">${hash}</a>`;
  }

  function setFlow(prefix, stepText, msgText, hash) {
    if (!prefix) return;
    const stepEl = $(`${prefix}Step`);
    const msgEl = $(`${prefix}Msg`);
    const hashEl = $(`${prefix}Hash`);
    if (stepEl) stepEl.textContent = stepText || "";
    if (msgEl) msgEl.textContent = msgText || "";
    if (hashEl) hashEl.innerHTML = hash ? `tx: ${txLink(hash)}` : "";
  }

  function setBtnBusy(btn, isBusy, idleLabel) {
    if (!btn) return;
    btn.disabled = !!isBusy;
    if (!isBusy && idleLabel) btn.textContent = idleLabel;
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

  function fmtTimeLeft(sec) {
    const s = Math.floor(Number(sec));
    if (!Number.isFinite(s) || s <= 0) return "-";
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (d > 0) return `${d}일 ${h}시간`;
    if (h > 0) return `${h}시간 ${m}분`;
    return `${m}분`;
  }

  function nowSec() {
    return Math.floor(Date.now() / 1000);
  }

  function getTokenKeyFromUrl() {
    try {
      const u = new URL(location.href);
      const k = (u.searchParams.get(cfg.urlTokenParam) || "").toUpperCase();
      if (cfg.tokenMap[k]) return k;
    } catch {}
    return "HUT";
  }

  function parseIntSafe(v) {
    const n = Number(String(v || "").replace(/,/g, "").trim());
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.floor(n);
  }

  async function getBrowserProvider() {
    if (!window.ethereum) throw new Error("지갑이 없습니다(메타마스크/라비).");
    return new ethers.BrowserProvider(window.ethereum);
  }

  async function getDecimals(rpc, tokenAddr, fallback) {
    try {
      const c = new ethers.Contract(tokenAddr, cfg.abis.ERC20, rpc);
      return Number(await c.decimals());
    } catch {
      return fallback;
    }
  }

  async function tryRead(provider, to, sig, args = []) {
    try {
      const iface = new ethers.Interface([`function ${sig}`]);
      const fn = sig.split("(")[0].trim();
      const data = iface.encodeFunctionData(fn, args);
      const raw = await provider.call({ to, data });
      const decoded = iface.decodeFunctionResult(fn, raw);
      return { ok: true, decoded, sig };
    } catch {
      return { ok: false, sig };
    }
  }

  async function tryReadMany(provider, to, candidates) {
    for (const c of candidates) {
      const res = await tryRead(provider, to, c.sig, c.args || []);
      if (res.ok) return res;
    }
    return { ok: false };
  }

  async function approveIfNeeded({ erc20, owner, spender, needAmount, flowPrefix, actionLabel, btn }) {
    const cur = await erc20.allowance(owner, spender);
    if (cur >= needAmount) {
      setFlow(flowPrefix, "승인 OK", `${actionLabel} 실행 시 지갑 서명 1회만 뜹니다.`, "");
      return { didApprove: false };
    }

    setFlow(flowPrefix, "1/2 승인 필요", `먼저 승인(approve) 서명이 뜹니다. 완료되면 2/2 ${actionLabel} 서명이 이어집니다.`, "");
    setStatus(`1/2 승인(approve) 진행 중… 지갑에서 승인 서명을 확인하세요.`);
    setBtnBusy(btn, true);

    try {
      let tx;
      try {
        tx = await erc20.approve(spender, ethers.MaxUint256);
      } catch {
        // 일부 토큰은 approve(0) -> approve(Max) 패턴이 필요
        try {
          const tx0 = await erc20.approve(spender, 0);
          setFlow(flowPrefix, "1/2 승인(초기화)", `승인 초기화 tx 전송됨. 채굴 후 다시 승인을 진행합니다.`, tx0.hash);
          await tx0.wait();
        } catch {}
        tx = await erc20.approve(spender, ethers.MaxUint256);
      }

      setFlow(flowPrefix, "1/2 승인 전송", `승인 tx가 전송되었습니다. 채굴(확정)까지 잠시 기다려 주세요.`, tx.hash);
      await tx.wait();
      setFlow(flowPrefix, "1/2 승인 완료", `승인이 완료되었습니다. 이제 2/2 ${actionLabel} 서명이 뜹니다.`, tx.hash);
      setStatus(`1/2 승인 완료. 이제 2/2 ${actionLabel}를 진행합니다…`);
      return { didApprove: true, approveHash: tx.hash };
    } finally {
      setBtnBusy(btn, false);
    }
  }

  // 기존 함수명 호환 (다른 코드에서 쓰던 호출을 깨지 않기 위해 유지)
  async function ensureApprove(erc20, owner, spender, needAmount) {
    const cur = await erc20.allowance(owner, spender);
    if (cur >= needAmount) return;
    try {
      const tx = await erc20.approve(spender, ethers.MaxUint256);
      await tx.wait();
    } catch {
      try {
        const tx0 = await erc20.approve(spender, 0);
        await tx0.wait();
      } catch {}
      const tx2 = await erc20.approve(spender, ethers.MaxUint256);
      await tx2.wait();
    }
  }

  async function runAllowanceCheck() {
    const tokenKey = getTokenKeyFromUrl();
    const t = cfg.tokenMap[tokenKey];
    if (!t) return;

    try {
      const p = await getBrowserProvider();
      await p.send("eth_requestAccounts", []);
      const signer = await p.getSigner();
      const me = await signer.getAddress();

      const hex = new ethers.Contract(cfg.contracts.hex, cfg.abis.ERC20, signer);
      const tok = new ethers.Contract(t.token, cfg.abis.ERC20, signer);

      let decHEX = cfg.decimals?.HEX ?? 18;
      try { decHEX = Number(await hex.decimals()); } catch {}

      let decTOKEN = t.decimals ?? 0;
      try { decTOKEN = Number(await tok.decimals()); } catch {}

      const [aHex, aTok] = await Promise.all([
        hex.allowance(me, t.bank),
        tok.allowance(me, t.bank)
      ]);

      setText("iAllowHex", fmtUnits(aHex, decHEX, 6));
      setText("iAllowTok", decTOKEN === 0 ? aTok.toString() : fmtUnits(aTok, decTOKEN, 6));

      const hint = $("allowanceHint");
      if (hint) {
        hint.textContent = "안내: 구매는 HEX 승인, 환매/스테이킹은 Token 승인이 필요합니다. 부족하면 지갑에서 approve를 먼저 완료한 뒤 실행하세요.";
      }

      // 2-step UI 힌트 동기화
      try {
        if (aHex > 0n) setFlow("flowBuy", "승인 OK", "구매 실행 시 지갑 서명 1회만 뜹니다.", "");
        else setFlow("flowBuy", "승인 필요", "구매 전에 HEX 승인이 필요합니다(1/2 승인 → 2/2 구매).", "");

        if (aTok > 0n) {
          setFlow("flowSell", "승인 OK", "환매 실행 시 지갑 서명 1회만 뜹니다.", "");
          setFlow("flowStake", "승인 OK", "스테이킹 실행 시 지갑 서명 1회만 뜹니다.", "");
        } else {
          setFlow("flowSell", "승인 필요", "환매 전에 Token 승인이 필요합니다(1/2 승인 → 2/2 환매).", "");
          setFlow("flowStake", "승인 필요", "스테이킹 전에 Token 승인이 필요합니다(1/2 승인 → 2/2 스테이킹).", "");
        }
      } catch {}

      setStatus("allowance 확인 완료");
    } catch (e) {
      console.error(e);
      setStatus(`allowance 확인 실패: ${e?.shortMessage || e?.message || e}`);
    }
  }

  async function trySend(signer, to, sigList, argsBuilder) {
    for (const sig of sigList) {
      try {
        const iface = new ethers.Interface([`function ${sig}`]);
        const fn = sig.split("(")[0].trim();
        const args = argsBuilder(sig);
        const data = iface.encodeFunctionData(fn, args);
        const tx = await signer.sendTransaction({ to, data });
        await tx.wait();
        return { ok: true, sig, hash: tx.hash };
      } catch {}
    }
    return { ok: false };
  }

  const DIV_INTERVAL_SEC = 7 * 24 * 60 * 60;
  const STAKE_LOCK_SEC = 120 * 24 * 60 * 60;

  let _timer = null;
  let _connected = false;
  let _me = null;

  async function connectWallet() {
    try {
      const p = await getBrowserProvider();
      await p.send("eth_requestAccounts", []);
      const signer = await p.getSigner();
      _me = await signer.getAddress();
      _connected = true;
      setStatus("지갑 연결됨");
      await refreshAll();
    } catch (e) {
      console.error(e);
      setStatus(`지갑 연결 실패: ${e?.shortMessage || e?.message || e}`);
    }
  }

  function updateEstimates({ priceWei, sellFeePct }) {
    const buyAmt = parseIntSafe($("inpBuyAmt")?.value);
    const sellAmt = parseIntSafe($("inpSellAmt")?.value);

    if (buyAmt > 0 && priceWei > 0n) {
      const payWei = BigInt(buyAmt) * priceWei;
      setText("buyEst", `${fmtUnits(payWei, 18, 6)} HEX`);
    } else {
      setText("buyEst", "-");
    }

    if (sellAmt > 0 && priceWei > 0n) {
      const gross = BigInt(sellAmt) * priceWei;
      const feeBps = BigInt(Math.round(Number(sellFeePct) * 100));
      const feeWei = (gross * feeBps) / 10000n;
      const recv = gross - feeWei;
      setText("sellEst", `${fmtUnits(recv, 18, 6)} HEX`);
    } else {
      setText("sellEst", "-");
    }
  }

  async function refreshAll() {
    const tokenKey = getTokenKeyFromUrl();
    const t = cfg.tokenMap[tokenKey];
    if (!t) return setStatus("token 파라미터 오류");

    if ($("tokenKeyText")) setText("tokenKeyText", t.symbol);
    if ($("tokenTitle")) setText("tokenTitle", `${t.symbol} 전용페이지`);
    if ($("tokenImg")) $("tokenImg").src = t.icon || "";

    const rpc = new ethers.JsonRpcProvider(cfg.rpcUrl);

    try {
      const decHEX = await getDecimals(rpc, cfg.contracts.hex, cfg.decimals?.HEX ?? 18);
      const decUSDT = await getDecimals(rpc, cfg.contracts.usdt, cfg.decimals?.USDT ?? 6);
      const decTOKEN = await getDecimals(rpc, t.token, t.decimals ?? 0);

      const hex = new ethers.Contract(cfg.contracts.hex, cfg.abis.ERC20, rpc);
      const usdt = new ethers.Contract(cfg.contracts.usdt, cfg.abis.ERC20, rpc);
      const token = new ethers.Contract(t.token, cfg.abis.ERC20, rpc);
      const bank = new ethers.Contract(t.bank, cfg.abis.BANK_READ, rpc);

      const [bankHexBal, bankTokBal] = await Promise.all([
        hex.balanceOf(t.bank),
        token.balanceOf(t.bank)
      ]);

      setText("iHEXBAL", fmtUnits(bankHexBal, decHEX, 6));
      setText("iBAL", decTOKEN === 0 ? bankTokBal.toString() : fmtUnits(bankTokBal, decTOKEN, 6));

      const [priceWei, totalStaked, divisor, totalfee] = await Promise.all([
        bank.price(),
        bank.totalStaked(),
        bank.divisor().catch(() => 1n),
        bank.totalfee().catch(() => 0n)
      ]);

      // 구매가능 캡: effectiveStaked의 1/10 (컨트랙트 buy cap과 동일)
      let effStaked = BigInt(totalStaked.toString());
      const effRes = await tryReadMany(rpc, t.bank, [
        { sig: "effectiveStaked() view returns (uint256)" },
        { sig: "virtualStaked() view returns (uint256)" }
      ]);
      if (effRes.ok) {
        if (effRes.sig && effRes.sig.startsWith("effectiveStaked")) {
          effStaked = BigInt(effRes.decoded[0].toString());
        } else {
          const v = BigInt(effRes.decoded[0].toString());
          effStaked = BigInt(totalStaked.toString()) + v;
        }
      }
      const buyCap = effStaked / 10n;
      if ($("iBuyCap")) setText("iBuyCap", buyCap.toString());

      setText("iPrice", trimDecimals(ethers.formatUnits(priceWei, 18), 6));
      if ($("iFee")) setText("iFee", fmtUnits(totalfee, 18, 6));
      if ($("iTotalStaked")) setText("iTotalStaked", totalStaked.toString());

      let sellFeePct = 3;
      const rateRes = await tryReadMany(rpc, t.bank, [
        { sig: "rate() view returns (uint8)" },
        { sig: "sellFeePct() view returns (uint256)" },
        { sig: "sellFee() view returns (uint256)" }
      ]);
      if (rateRes.ok) {
        const raw = Number(rateRes.decoded[0].toString());
        if (Number.isFinite(raw) && raw > 0) sellFeePct = raw;
      }
      setText("iSellFee", `${sellFeePct} %`);

      const autoRes = await tryReadMany(rpc, t.bank, [
        { sig: "autoStakeBps() view returns (uint16)" },
        { sig: "autoStake() view returns (uint256)" }
      ]);
      if (autoRes.ok) {
        const bps = Number(autoRes.decoded[0].toString());
        setText("iAutoStakeBps", `${bps} bps (${trimDecimals((bps / 100).toFixed(2), 2)}%)`);
      } else {
        if ($("iAutoStakeBps")) setText("iAutoStakeBps", "-");
      }

      if (_connected && _me) {
        const [mh, mu] = await Promise.all([
          hex.balanceOf(_me),
          usdt.balanceOf(_me)
        ]);
        setText("iMyHex", fmtUnits(mh, decHEX, 6));
        setText("iMyUsdt", fmtUnits(mu, decUSDT, 6));
      } else {
        setText("iMyHex", "-");
        setText("iMyUsdt", "-");
      }

      let totalBuy = 0n, depo = 0n, stakingTime = 0n, lastClaim = 0n;
      if (_connected && _me) {
        const u = await bank.user(_me);
        totalBuy = BigInt(u[1].toString());
        depo = BigInt(u[2].toString());
        stakingTime = BigInt(u[3].toString());
        lastClaim = BigInt(u[4].toString());

        setText("iBought", totalBuy.toString());
        setText("iSellable", totalBuy.toString());
        setText("iDepo", depo.toString());
      } else {
        setText("iBought", "-");
        setText("iSellable", "-");
        setText("iDepo", "-");
      }

      if (_connected && _me) {
        const claimable = await bank.pendingDividend(_me);
        setText("iallow", fmtUnits(claimable, 18, 6));
      } else {
        setText("iallow", "-");
      }

      if (_connected && _me && lastClaim > 0n) {
        const left = (Number(lastClaim) + DIV_INTERVAL_SEC) - nowSec();
        setText("iClaimLeft", fmtTimeLeft(left));
      } else {
        setText("iClaimLeft", "-");
      }

      if (_connected && _me && stakingTime > 0n) {
        const left = (Number(stakingTime) + STAKE_LOCK_SEC) - nowSec();
        setText("iUnstakeLeft", fmtTimeLeft(left));
      } else {
        setText("iUnstakeLeft", "-");
      }

      let roiWeeklyPct = 0;
      try {
        const es = BigInt(totalStaked.toString());
        const div = BigInt(divisor.toString());
        if (es > 0n && div > 0n) {
          const allowPerToken = BigInt(bankHexBal.toString()) / es;
          const weeklyPerTokenWei = allowPerToken / div;
          setText("iWeekly", fmtUnits(weeklyPerTokenWei, 18, 6));

          const weeklyNum = Number(ethers.formatUnits(weeklyPerTokenWei, 18) * 52);
          const priceNum = Number(ethers.formatUnits(priceWei, 18));
          if (priceNum > 0 && weeklyNum > 0) roiWeeklyPct = (weeklyNum / priceNum) * 100;
        } else {
          setText("iWeekly", "-");
        }
      } catch {
        setText("iWeekly", "-");
      }
      setText("iAprApy", `${trimDecimals(roiWeeklyPct.toFixed(3), 3)} %`);

      setText("iMyMcap", "-");
      setText("iMyAvg", "-");
      setText("iMyRoiPct", "-");

      if (_connected && _me) {
        const dash = await tryReadMany(rpc, t.bank, [
          { sig: "myDashboard(address) view returns (uint256,uint256,uint256,uint256,int256,int256)", args: [_me] }
        ]);

        if (dash.ok) {
          const d = dash.decoded;
          const myMarketCapWei = BigInt(d[2].toString());
          const myAvgBuyPriceWei = BigInt(d[3].toString());
          const myRoiBps = BigInt(d[5].toString());

          setText("iMyMcap", fmtUnits(myMarketCapWei, 18, 6));
          setText("iMyAvg", trimDecimals(ethers.formatUnits(myAvgBuyPriceWei, 18), 6));
          setText("iMyRoiPct", `${trimDecimals((Number(myRoiBps) / 100).toFixed(2), 2)} %`);
        } else {
          const [mcapRes, avgRes, roiRes] = await Promise.all([
            tryReadMany(rpc, t.bank, [{ sig: "myMarketCap(address) view returns (uint256)", args: [_me] }]),
            tryReadMany(rpc, t.bank, [{ sig: "myAvgBuyPrice(address) view returns (uint256)", args: [_me] }]),
            tryReadMany(rpc, t.bank, [{ sig: "myRoiBps(address) view returns (int256)", args: [_me] }]),
          ]);

          if (mcapRes.ok) setText("iMyMcap", fmtUnits(BigInt(mcapRes.decoded[0].toString()), 18, 6));
          if (avgRes.ok) setText("iMyAvg", trimDecimals(ethers.formatUnits(BigInt(avgRes.decoded[0].toString()), 18), 6));
          if (roiRes.ok) setText("iMyRoiPct", `${trimDecimals((Number(BigInt(roiRes.decoded[0].toString())) / 100).toFixed(2), 2)} %`);
        }
      }

      updateEstimates({ priceWei: BigInt(priceWei.toString()), sellFeePct });

      const b = $("inpBuyAmt");
      const s = $("inpSellAmt");
      if (b) b.oninput = () => updateEstimates({ priceWei: BigInt(priceWei.toString()), sellFeePct });
      if (s) s.oninput = () => updateEstimates({ priceWei: BigInt(priceWei.toString()), sellFeePct });

      if (window.HEXDAO_drawPriceChart) {
        await window.HEXDAO_drawPriceChart({
          provider: rpc,
          bankAddress: t.bank,
          bankAbi: ["function chartLength() view returns (uint256)", "function chartAt(uint256) view returns (uint256)"],
          elId: "myChart",
          unitLabel: `${t.symbol}`
        });
      }

      setStatus(_connected ? "정상" : "정상(지갑 미연결)");
    } catch (e) {
      console.error(e);
      setStatus(`로드 실패: ${e?.shortMessage || e?.message || e}`);
    }
  }

  async function runBuy() {
    const tokenKey = getTokenKeyFromUrl();
    const t = cfg.tokenMap[tokenKey];
    if (!t) return;

    const amt = parseIntSafe($("inpBuyAmt")?.value);
    if (amt <= 0) return setStatus("구매 수량을 입력하세요.");

    const btnBuy = $("btnBuy");
    try {
      const p = await getBrowserProvider();
      await p.send("eth_requestAccounts", []);
      const signer = await p.getSigner();
      const me = await signer.getAddress();

      // bank 가격 읽기(승인 필요 수량 계산용)
      let priceWei = 0n;
      try {
        const bankRead = new ethers.Contract(t.bank, ["function price() view returns (uint256)"], signer);
        priceWei = BigInt((await bankRead.price()).toString());
      } catch {}

      const payWei = priceWei > 0n ? (BigInt(amt) * priceWei) : 0n;

      const hex = new ethers.Contract(cfg.contracts.hex, cfg.abis.ERC20, signer);
      await approveIfNeeded({
        erc20: hex,
        owner: me,
        spender: t.bank,
        // 실제 필요 수량(payWei) 기준으로 승인 여부 판단 (매번 2번 서명 뜨는 혼란 방지)
        needAmount: payWei > 0n ? payWei : 1n,
        flowPrefix: "flowBuy",
        actionLabel: "구매",
        btn: btnBuy
      });

      setFlow("flowBuy", "2/2 구매", "이제 구매(buy) 서명이 뜹니다. 지갑에서 확인하세요.", "");
      setStatus("2/2 구매 진행 중… 지갑에서 구매 서명을 확인하세요.");
      setBtnBusy(btnBuy, true);

      // 우선: 표준 시그니처로 직접 호출 (대부분의 bank가 동일 시그니처)
      try {
        const bank = new ethers.Contract(t.bank, [
          "function buy(uint256 amount,uint256 maxPay) returns (bool)"
        ], signer);

        const tx = await bank.buy(amt, ethers.MaxUint256);
        setFlow("flowBuy", "2/2 구매 전송", "구매 tx가 전송되었습니다. 채굴(확정) 완료 후 잔고/가격이 갱신됩니다.", tx.hash);
        await tx.wait();
        setStatus(`구매 완료: ${tx.hash}`);
      } catch (e) {
        // 표준 호출 실패 시에만 시그니처 후보를 순회 (구형/다른 구현 대비)
        const buySigs = [
          "buy(uint256 amount,uint256 maxPay)",
          "buy(uint256 amount)",
          "buyToken(uint256 amount,uint256 maxPay)",
          "buyToken(uint256 amount)"
        ];

        const res = await trySend(signer, t.bank, buySigs, (sig) => {
          if (sig.includes(",uint256 maxPay")) return [amt, ethers.MaxUint256];
          return [amt];
        });

        if (!res.ok) {
          const reason = e?.shortMessage || e?.reason || e?.message || "컨트랙트 require/revert 또는 시그니처 불일치";
          setFlow("flowBuy", "2/2 구매 실패", `실패 사유: ${reason}`,
            e?.transactionHash || e?.hash || "");
          return setStatus(`구매 실패: ${reason}`);
        }

        setFlow("flowBuy", "2/2 구매 전송", "구매 tx가 전송되었습니다. 채굴(확정) 완료 후 잔고/가격이 갱신됩니다.", res.hash);
        setStatus(`구매 완료: ${res.hash}`);
      }
      await refreshAll();
    } catch (e) {
      console.error(e);
      setFlow("flowBuy", "실패", "지갑에서 거절했거나 트랜잭션이 실패했습니다.", "");
      setStatus(`구매 실패: ${e?.shortMessage || e?.message || e}`);
    } finally {
      setBtnBusy(btnBuy, false, "구매");
    }
  }

  async function runSell() {
    const tokenKey = getTokenKeyFromUrl();
    const t = cfg.tokenMap[tokenKey];
    if (!t) return;

    const amtInput = parseIntSafe($("inpSellAmt")?.value);
    if (amtInput <= 0) return setStatus("환매 수량을 입력하세요.");

    const btnSell = $("btnSell");
    try {
      const p = await getBrowserProvider();
      await p.send("eth_requestAccounts", []);
      const signer = await p.getSigner();
      const me = await signer.getAddress();

      const tok = new ethers.Contract(t.token, cfg.abis.ERC20, signer);

      let decTOKEN = 0;
      try { decTOKEN = Number(await tok.decimals()); } catch { decTOKEN = t.decimals ?? 0; }

      const amt =
        decTOKEN === 0
          ? BigInt(amtInput)
          : ethers.parseUnits(String(amtInput), decTOKEN);

      await approveIfNeeded({
        erc20: tok,
        owner: me,
        spender: t.bank,
        // 실제 필요 수량(amt) 기준으로 승인 여부 판단
        needAmount: amt,
        flowPrefix: "flowSell",
        actionLabel: "환매",
        btn: btnSell
      });

      setFlow("flowSell", "2/2 환매", "이제 환매(sell) 서명이 뜹니다. 지갑에서 확인하세요.", "");
      setStatus("2/2 환매 진행 중… 지갑에서 환매 서명을 확인하세요.");
      setBtnBusy(btnSell, true);

      const sellSigs = [
        "sell(uint256 amount)",
        "sellToken(uint256 amount)",
        "sell(uint256 amount,uint256 minRecv)",
        "sell(uint256 amount,uint256 minHex)",
        "sellToken(uint256 amount,uint256 minRecv)",
        "sellToken(uint256 amount,uint256 minHex)"
      ];

      const res = await trySend(signer, t.bank, sellSigs, (sig) => {
        if (sig.includes(",")) return [amt, 0];
        return [amt];
      });

      if (!res.ok) {
        setFlow("flowSell", "2/2 환매 실패", "sell 함수 시그니처가 컨트랙트와 다릅니다(또는 내부 require revert).", "");
        return setStatus("환매 실패: sell 함수 시그니처가 컨트랙트와 다릅니다(또는 내부 require revert).");
      }

      setFlow("flowSell", "2/2 환매 전송", "환매 tx가 전송되었습니다. 채굴(확정) 완료 후 잔고가 갱신됩니다.", res.hash);
      setStatus(`환매 완료: ${res.hash}`);
      await refreshAll();
    } catch (e) {
      console.error(e);
      setFlow("flowSell", "실패", "지갑에서 거절했거나 트랜잭션이 실패했습니다.", "");
      setStatus(`환매 실패: ${e?.shortMessage || e?.message || e}`);
    } finally {
      setBtnBusy(btnSell, false, "환매");
    }
  }

  async function runStake() {
    const tokenKey = getTokenKeyFromUrl();
    const t = cfg.tokenMap[tokenKey];
    if (!t) return;

    const amt = parseIntSafe($("inpStakeAmt")?.value);
    if (amt <= 0) return setStatus("스테이킹 수량을 입력하세요.");

    const btnStake = $("btnStake");
    try {
      const p = await getBrowserProvider();
      await p.send("eth_requestAccounts", []);
      const signer = await p.getSigner();
      const me = await signer.getAddress();

      const tok = new ethers.Contract(t.token, cfg.abis.ERC20, signer);
      await approveIfNeeded({
        erc20: tok,
        owner: me,
        spender: t.bank,
        // 실제 필요 수량(amt) 기준으로 승인 여부 판단
        needAmount: BigInt(amt),
        flowPrefix: "flowStake",
        actionLabel: "스테이킹",
        btn: btnStake
      });

      setFlow("flowStake", "2/2 스테이킹", "이제 스테이킹(stake/deposit) 서명이 뜹니다. 지갑에서 확인하세요.", "");
      setStatus("2/2 스테이킹 진행 중… 지갑에서 스테이킹 서명을 확인하세요.");
      setBtnBusy(btnStake, true);

      const stakeSigs = [
        "stake(uint256 amount)",
        "deposit(uint256 amount)",
        "depo(uint256 amount)"
      ];

      const res = await trySend(signer, t.bank, stakeSigs, () => [amt]);
      if (!res.ok) {
        setFlow("flowStake", "2/2 스테이킹 실패", "stake/deposit 함수가 컨트랙트와 다릅니다(또는 내부 require revert).", "");
        return setStatus("스테이킹 실패: stake/deposit 함수가 컨트랙트와 다릅니다.");
      }

      setFlow("flowStake", "2/2 스테이킹 전송", "스테이킹 tx가 전송되었습니다. 채굴(확정) 완료 후 정보가 갱신됩니다.", res.hash);
      setText("stakeResult", `성공: ${res.hash}`);
      setStatus("스테이킹 완료");
      await refreshAll();
    } catch (e) {
      console.error(e);
      setFlow("flowStake", "실패", "지갑에서 거절했거나 트랜잭션이 실패했습니다.", "");
      setStatus(`스테이킹 실패: ${e?.shortMessage || e?.message || e}`);
    } finally {
      setBtnBusy(btnStake, false, "스테이킹");
    }
  }

  async function runClaim() {
    const tokenKey = getTokenKeyFromUrl();
    const t = cfg.tokenMap[tokenKey];
    if (!t) return;

    try {
      const p = await getBrowserProvider();
      await p.send("eth_requestAccounts", []);
      const signer = await p.getSigner();

      const claimSigs = [
        "claimDividend()",
        "claim()",
        "getDividend()"
      ];

      const res = await trySend(signer, t.bank, claimSigs, () => []);
      if (!res.ok) return setStatus("청구 실패: claimDividend 함수가 컨트랙트와 다릅니다.");

      setText("claimResult", `성공: ${res.hash}`);
      setStatus("이자배당 청구 완료");
      await refreshAll();
    } catch (e) {
      console.error(e);
      setStatus(`청구 실패: ${e?.shortMessage || e?.message || e}`);
    }
  }

  async function runWithdraw() {
    const tokenKey = getTokenKeyFromUrl();
    const t = cfg.tokenMap[tokenKey];
    if (!t) return;

    try {
      const p = await getBrowserProvider();
      await p.send("eth_requestAccounts", []);
      const signer = await p.getSigner();

      const wdSigs = [
        "withdraw()",
        "unstake()",
        "unStake()"
      ];

      const res = await trySend(signer, t.bank, wdSigs, () => []);
      if (!res.ok) return setStatus("출금 실패: withdraw/unstake 함수가 컨트랙트와 다릅니다.");

      setText("withdrawResult", `성공: ${res.hash}`);
      setStatus("언스테이킹(출금) 완료");
      await refreshAll();
    } catch (e) {
      console.error(e);
      setStatus(`출금 실패: ${e?.shortMessage || e?.message || e}`);
    }
  }

  function boot() {
    const btnConnect = $("btnConnectLocal") || $("btnConnect") || $("btnWallet");
    if (btnConnect) btnConnect.onclick = connectWallet;

    const btnAllowance = $("btnAllowance");
    if (btnAllowance) btnAllowance.onclick = runAllowanceCheck;

    const btnBuy = $("btnBuy");
    const btnSell = $("btnSell");
    const btnStake = $("btnStake");
    const btnClaim = $("btnClaim");
    const btnWithdraw = $("btnWithdraw");

    if (btnBuy) btnBuy.onclick = runBuy;
    if (btnSell) btnSell.onclick = runSell;
    if (btnStake) btnStake.onclick = runStake;
    if (btnClaim) btnClaim.onclick = runClaim;
    if (btnWithdraw) btnWithdraw.onclick = runWithdraw;

    refreshAll();
    if (_timer) clearInterval(_timer);
    _timer = setInterval(refreshAll, 12000);
  }

  window.addEventListener("partials:loaded", () => setTimeout(boot, 0));
  document.addEventListener("DOMContentLoaded", () => setTimeout(boot, 250));
})();
