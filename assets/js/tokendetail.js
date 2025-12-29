// /assets/js/tokendetail.js
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

  async function ensureApprove(erc20, owner, spender, needAmount) {
    const cur = await erc20.allowance(owner, spender);
    if (cur >= needAmount) return;
    const tx = await erc20.approve(spender, ethers.MaxUint256);
    await tx.wait();
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
      } catch (e) {
        // 다음 후보 시도
      }
    }
    return { ok: false };
  }

  const DIV_INTERVAL_SEC = 7 * 24 * 60 * 60;   // 7 days
  const STAKE_LOCK_SEC = 120 * 24 * 60 * 60;   // 120 days

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
      const feeBps = BigInt(Math.round(Number(sellFeePct) * 100)); // % -> bps*100
      const feeWei = (gross * feeBps) / 10000n; // (bps*100)/10000 => %
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

      // 계약 잔고
      const [bankHexBal, bankTokBal] = await Promise.all([
        hex.balanceOf(t.bank),
        token.balanceOf(t.bank)
      ]);

      setText("iHEXBAL", fmtUnits(bankHexBal, decHEX, 6));
      setText("iBAL", decTOKEN === 0 ? bankTokBal.toString() : fmtUnits(bankTokBal, decTOKEN, 6));

      // 가격/수수료/스테이킹
      const [priceWei, totalStaked, divisor, totalfee] = await Promise.all([
        bank.price(),
        bank.totalStaked(),
        bank.divisor().catch(() => 1n),
        bank.totalfee().catch(() => 0n)
      ]);

      setText("iPrice", trimDecimals(ethers.formatUnits(priceWei, 18), 6));
      if ($("iFee")) setText("iFee", fmtUnits(totalfee, 18, 6));
      if ($("iTotalStaked")) setText("iTotalStaked", totalStaked.toString());

      // 매도 수수료(rate 우선, 없으면 3%)
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

      // 자동스테이크비율
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

      // 내 잔고
      let myTokWallet = 0n;
      if (_connected && _me) {
        const [mh, mu, mt] = await Promise.all([
          hex.balanceOf(_me),
          usdt.balanceOf(_me),
          token.balanceOf(_me)
        ]);
        setText("iMyHex", fmtUnits(mh, decHEX, 6));
        setText("iMyUsdt", fmtUnits(mu, decUSDT, 6));
        myTokWallet = BigInt(mt.toString());
      } else {
        setText("iMyHex", "-");
        setText("iMyUsdt", "-");
      }

      // user()
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

      // 이번에 배당받을 HEX
      if (_connected && _me) {
        const claimable = await bank.pendingDividend(_me);
        setText("iallow", fmtUnits(claimable, 18, 6));
      } else {
        setText("iallow", "-");
      }

      // 남은 시간들
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

      // ROI(주간) = (이번주배당/가격)*100
      let roiWeeklyPct = 0;
      try {
        const es = BigInt(totalStaked.toString()) + 1000n;
        const div = BigInt(divisor.toString());
        if (es > 0n && div > 0n) {
          const allowPerToken = BigInt(bankHexBal.toString()) / es;
          const weeklyPerTokenWei = allowPerToken / div;
          setText("iWeekly", fmtUnits(weeklyPerTokenWei, 18, 6));

          const weeklyNum = Number(ethers.formatUnits(weeklyPerTokenWei, 18));
          const priceNum = Number(ethers.formatUnits(priceWei, 18));
          if (priceNum > 0 && weeklyNum > 0) roiWeeklyPct = (weeklyNum / priceNum) * 100;
        } else {
          setText("iWeekly", "-");
        }
      } catch {
        setText("iWeekly", "-");
      }
      setText("iAprApy", `${trimDecimals(roiWeeklyPct.toFixed(3), 3)} %`);

      // 내 시가총액/평단/손익/수익률
      let filled = false;

      if (_connected && _me) {
        try {
          const d = await bank.myDashboardSelf();
          const myMarketCapWei = BigInt(d[2].toString());
          const myAvgBuyPriceWei = BigInt(d[3].toString());
          const myPnlWei = BigInt(d[4].toString());
          const myRoiBps = BigInt(d[5].toString());

          setText("iMyMcap", fmtUnits(myMarketCapWei, 18, 6));
          setText("iMyAvg", trimDecimals(ethers.formatUnits(myAvgBuyPriceWei, 18), 6));
          setText("iMyPnl", fmtUnits(myPnlWei, 18, 6));
          setText("iMyRoiPct", `${trimDecimals((Number(myRoiBps) / 100).toFixed(2), 2)} %`);
          filled = true;
        } catch {
          // continue
        }
      }

      if (!filled && _connected && _me) {
        try {
          const s = await bank.userStatsBase(_me);
          const netQty = BigInt(s[0].toString());
          const avgBuyPriceWei = BigInt(s[1].toString());

          const mcapWei = netQty * BigInt(priceWei.toString());
          const costWei = netQty * avgBuyPriceWei;
          const pnlWei = mcapWei - costWei;

          let roiPct = 0;
          if (costWei > 0n) {
            const m = Number(ethers.formatUnits(mcapWei, 18));
            const c = Number(ethers.formatUnits(costWei, 18));
            roiPct = c > 0 ? ((m - c) / c) * 100 : 0;
          }

          setText("iMyMcap", fmtUnits(mcapWei, 18, 6));
          setText("iMyAvg", trimDecimals(ethers.formatUnits(avgBuyPriceWei, 18), 6));
          setText("iMyPnl", fmtUnits(pnlWei, 18, 6));
          setText("iMyRoiPct", `${trimDecimals(roiPct.toFixed(2), 2)} %`);
          filled = true;
        } catch {
          // continue
        }
      }

      // 마지막 fallback: (지갑토큰 + depo) 기준 시가총액만이라도
      if (!filled) {
        if (_connected && _me) {
          const myTotalTok = myTokWallet + depo; // 토큰 0dec
          const mcapWei = myTotalTok * BigInt(priceWei.toString());
          setText("iMyMcap", fmtUnits(mcapWei, 18, 6));
        } else {
          setText("iMyMcap", "-");
        }
        setText("iMyAvg", "0");
        setText("iMyPnl", "0");
        setText("iMyRoiPct", "0 %");
      }

      // 예측가격(구매/환매)
      updateEstimates({ priceWei: BigInt(priceWei.toString()), sellFeePct });

      const b = $("inpBuyAmt");
      const s = $("inpSellAmt");
      if (b) b.oninput = () => updateEstimates({ priceWei: BigInt(priceWei.toString()), sellFeePct });
      if (s) s.oninput = () => updateEstimates({ priceWei: BigInt(priceWei.toString()), sellFeePct });

      // 차트
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

    try {
      const p = await getBrowserProvider();
      await p.send("eth_requestAccounts", []);
      const signer = await p.getSigner();
      const me = await signer.getAddress();

      const hex = new ethers.Contract(cfg.contracts.hex, cfg.abis.ERC20, signer);
      await ensureApprove(hex, me, t.bank, ethers.MaxUint256);

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

      if (!res.ok) return setStatus("구매 실패: buy 함수가 컨트랙트와 다릅니다.");

      setStatus(`구매 완료: ${res.hash}`);
      await refreshAll();
    } catch (e) {
      console.error(e);
      setStatus(`구매 실패: ${e?.shortMessage || e?.message || e}`);
    }
  }

  async function runSell() {
    const tokenKey = getTokenKeyFromUrl();
    const t = cfg.tokenMap[tokenKey];
    if (!t) return;

    const amt = parseIntSafe($("inpSellAmt")?.value);
    if (amt <= 0) return setStatus("환매 수량을 입력하세요.");

    try {
      const p = await getBrowserProvider();
      await p.send("eth_requestAccounts", []);
      const signer = await p.getSigner();

      const sellSigs = [
        "sell(uint256 amount)",
        "sellToken(uint256 amount)"
      ];

      const res = await trySend(signer, t.bank, sellSigs, () => [amt]);
      if (!res.ok) return setStatus("환매 실패: sell 함수가 컨트랙트와 다릅니다.");

      setStatus(`환매 완료: ${res.hash}`);
      await refreshAll();
    } catch (e) {
      console.error(e);
      setStatus(`환매 실패: ${e?.shortMessage || e?.message || e}`);
    }
  }

  async function runStake() {
    const tokenKey = getTokenKeyFromUrl();
    const t = cfg.tokenMap[tokenKey];
    if (!t) return;

    const amt = parseIntSafe($("inpStakeAmt")?.value);
    if (amt <= 0) return setStatus("스테이킹 수량을 입력하세요.");

    try {
      const p = await getBrowserProvider();
      await p.send("eth_requestAccounts", []);
      const signer = await p.getSigner();
      const me = await signer.getAddress();

      // stake는 보통 "토큰을 bank가 transferFrom" 하므로 토큰 approve 필요
      const tok = new ethers.Contract(t.token, cfg.abis.ERC20, signer);
      await ensureApprove(tok, me, t.bank, ethers.MaxUint256);

      const stakeSigs = [
        "stake(uint256 amount)",
        "deposit(uint256 amount)",
        "depo(uint256 amount)"
      ];

      const res = await trySend(signer, t.bank, stakeSigs, () => [amt]);
      if (!res.ok) return setStatus("스테이킹 실패: stake/deposit 함수가 컨트랙트와 다릅니다.");

      setText("stakeResult", `성공: ${res.hash}`);
      setStatus("스테이킹 완료");
      await refreshAll();
    } catch (e) {
      console.error(e);
      setStatus(`스테이킹 실패: ${e?.shortMessage || e?.message || e}`);
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
