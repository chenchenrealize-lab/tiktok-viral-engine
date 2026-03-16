// 健康检查：确认服务在运行，检查哪些 API Key 已配置
export async function onRequestGet(context) {
  const { env } = context;

  return new Response(JSON.stringify({
    status: "ok",
    keys: {
      apify: !!env.APIFY_TOKEN,
      groq: !!env.GROQ_API_KEY,
      deepseek: !!env.DEEPSEEK_API_KEY,
      a2e: !!env.A2E_API_KEY,
    },
  }), {
    headers: { "Content-Type": "application/json" },
  });
}
