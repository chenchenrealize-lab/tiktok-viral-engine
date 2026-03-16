// 抓取 TikTok 数据：代理 Apify 爬虫
// 工具函数：延时（等待爬虫完成）
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const { keyword, resultsPerPage = 20 } = await request.json();
  const token = env.APIFY_TOKEN;

  if (!token) {
    return new Response(JSON.stringify({ error: "未配置 APIFY_TOKEN" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    // 第一步：启动 Apify 爬虫（waitForFinish=300 让 Apify 最多等 5 分钟再返回）
    const runResponse = await fetch(
      "https://api.apify.com/v2/acts/clockworks~free-tiktok-scraper/runs?waitForFinish=300",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          searchQueries: [keyword],
          resultsPerPage,
          shouldDownloadVideos: true,
          shouldDownloadCovers: true,
        }),
      }
    );

    if (!runResponse.ok) {
      const errText = await runResponse.text();
      return new Response(JSON.stringify({ error: `Apify 请求失败: ${errText}` }), {
        status: runResponse.status,
        headers: { "Content-Type": "application/json" },
      });
    }

    const runData = await runResponse.json();
    const datasetId = runData.data?.defaultDatasetId;
    const runId = runData.data?.id;
    let status = runData.data?.status;

    if (!datasetId) {
      return new Response(JSON.stringify({ error: "Apify 没有返回数据集 ID" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    // 第二步：如果爬虫还没完成，轮询等待
    let retries = 0;
    const maxRetries = 60;

    while (status !== "SUCCEEDED" && status !== "FAILED" && retries < maxRetries) {
      await delay(5000);
      const statusRes = await fetch(
        `https://api.apify.com/v2/acts/clockworks~free-tiktok-scraper/runs/${runId}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const statusData = await statusRes.json();
      status = statusData.data?.status;
      retries++;
    }

    if (status === "FAILED") {
      return new Response(JSON.stringify({ error: "Apify 爬虫运行失败" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (retries >= maxRetries) {
      return new Response(JSON.stringify({ error: "Apify 爬虫超时" }), {
        status: 504,
        headers: { "Content-Type": "application/json" },
      });
    }

    // 第三步：获取爬虫结果数据
    const dataRes = await fetch(
      `https://api.apify.com/v2/datasets/${datasetId}/items?format=json`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (!dataRes.ok) {
      return new Response(JSON.stringify({ error: "获取 Apify 数据集失败" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    const items = await dataRes.json();
    return new Response(JSON.stringify(items), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
