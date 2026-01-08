// /assets/js/partials.js
// 모든 페이지에서 동일하게 헤더/푸터를 안정적으로 로드하고,
// 로드 성공 시 "partials:loaded" 이벤트를 발생시킵니다.

async function loadPartial(targetId, url) {
  const host = document.getElementById(targetId);
  if (!host) return;

  // 캐시 이슈 방지 (배포 후 head/footer 바꿨는데 안 바뀌는 문제 해결)
  const bust = `v=${Date.now()}`;
  const u = url.includes("?") ? `${url}&${bust}` : `${url}?${bust}`;

  try {
    const res = await fetch(u, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
    const html = await res.text();
    host.innerHTML = html;
  } catch (e) {
    host.innerHTML = `
      <div style="padding:12px; border:1px solid #ff4d4f; border-radius:10px; color:#b00020;">
        부분 로드 실패: ${url}<br/>
        ${String(e.message || e)}
      </div>
    `;
    console.error("loadPartial failed:", url, e);
  }
}

async function bootPartials() {
  await loadPartial("site-header", "/partials/head.html");
  await loadPartial("site-footer", "/partials/footer.html");

  // 헤더/푸터 로드 완료 이벤트
  window.dispatchEvent(new CustomEvent("partials:loaded"));
}

// 페이지에서 필요할 때 호출할 수 있게 노출
window.bootPartials = bootPartials;

// DOM 준비되면 자동 실행
document.addEventListener("DOMContentLoaded", () => {
  bootPartials();
});
