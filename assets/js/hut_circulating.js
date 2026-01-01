// netlify/functions/hut_circulating.js
// CoinGecko Circulating Supply endpoint (manual / policy-based value)
//
// - HUT의 "실제 유통량"을 프로젝트 정책 기준으로 고정 반환합니다.
// - CoinGecko 폼의 "보유/잠금지갑(locked wallets)" 항목과 함께 사용할 때 가장 깔끔합니다.
// - 인증/키 없이 누구나 GET으로 호출 가능해야 합니다.
//
// 배포 후 호출 예:
//   https://hexdao.netlify.app/.netlify/functions/hut_circulating
//
// 응답 예:
//   { "result": "282585" }

exports.handler = async () => {
  try {
    // 프로젝트가 정의한 "실제 유통량"
    // (Bank + Treasury 등 잠금분을 제외하고, 유통으로 인정하는 수량)
    const circulating = "282585";

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        // CoinGecko는 주기적으로 폴링합니다.
        // 너무 길게 캐시하면 반영이 늦어질 수 있어 60초 정도를 권장합니다.
        "Cache-Control": "public, max-age=60",
        // CORS(브라우저 테스트/외부 호출 편의)
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({ result: circulating }),
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({ error: String(e?.message || e) }),
    };
  }
};
