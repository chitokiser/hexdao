// /assets/js/chart.js
/* global ApexCharts, ethers */

window.HEXDAO_drawPriceChart = async function ({
  provider,
  bankAddress,
  bankAbi,
  elId,
  unitLabel = ""
}) {
  const el = document.getElementById(elId);
  if (!el) return;

  if (typeof ApexCharts === "undefined") {
    el.innerHTML = '<div style="padding:14px;color:#777;font-size:13px;">차트 라이브러리가 없습니다.</div>';
    return;
  }

  if (el.tagName && el.tagName.toLowerCase() === "canvas") {
    el.insertAdjacentHTML(
      "afterend",
      '<div style="padding:14px;color:#777;font-size:13px;">myChart는 canvas가 아니라 div여야 합니다.</div>'
    );
    return;
  }

  const bank = new ethers.Contract(bankAddress, bankAbi, provider);

  let len = 0;
  try {
    len = Number(await bank.chartLength());
  } catch {
    el.innerHTML = '<div style="padding:14px;color:#777;font-size:13px;">차트 함수(chartLength/chartAt)가 없습니다.</div>';
    return;
  }

  if (!len || len < 2) {
    el.innerHTML = '<div style="padding:14px;color:#777;font-size:13px;">차트 데이터가 아직 부족합니다.</div>';
    return;
  }

  const maxPoints = 120;
  const start = Math.max(0, len - maxPoints);

  const data = [];
  for (let i = start; i < len; i++) {
    try {
      const v = await bank.chartAt(i);
      data.push(Number(v) / 1e18);
    } catch {
      data.push(null);
    }
  }

  const options = {
    chart: { type: "line", height: 360, toolbar: { show: false } },
    series: [{ name: unitLabel, data }],
    xaxis: { labels: { show: false } },
    stroke: { width: 2 },
    dataLabels: { enabled: false }
  };

  try {
    if (el.__hexdaoChart) {
      el.__hexdaoChart.updateOptions(options);
      el.__hexdaoChart.updateSeries(options.series);
    } else {
      el.innerHTML = "";
      const chart = new ApexCharts(el, options);
      el.__hexdaoChart = chart;
      chart.render();
    }
  } catch (e) {
    console.error(e);
    el.innerHTML = '<div style="padding:14px;color:#777;font-size:13px;">차트 렌더링 실패</div>';
  }
};
