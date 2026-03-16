// 生成数字人视频：代理 A2E 服务
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const { text, voice = "zh-CN-XiaoxiaoNeural", aspectRatio = "9:16" } = await request.json();
  const apiKey = env.A2E_API_KEY;

  if (!apiKey) {
    return new Response(JSON.stringify({ error: "未配置 A2E_API_KEY" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    // 第一步：创建视频任务
    const createRes = await fetch("https://api.a2e.ai/v1/video/create", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ text, voice, aspectRatio }),
    });

    if (!createRes.ok) {
      const errText = await createRes.text();
      return new Response(JSON.stringify({ error: `A2E 创建失败: ${errText}` }), {
        status: createRes.status,
        headers: { "Content-Type": "application/json" },
      });
    }

    const createData = await createRes.json();
    const videoId = createData.id || createData.videoId;
    if (!videoId) {
      return new Response(JSON.stringify({ error: "A2E 没有返回视频 ID" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    // 第二步：轮询等待视频生成完成
    let videoUrl = null;
    let retries = 0;
    const maxRetries = 60;

    while (!videoUrl && retries < maxRetries) {
      await delay(5000);
      retries++;

      const statusRes = await fetch(`https://api.a2e.ai/v1/video/${videoId}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });

      if (statusRes.ok) {
        const statusData = await statusRes.json();
        if (statusData.status === "completed" && statusData.url) {
          videoUrl = statusData.url;
        } else if (statusData.status === "failed") {
          return new Response(JSON.stringify({
            error: "A2E 视频生成失败: " + (statusData.error || "未知错误")
          }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      }
    }

    if (!videoUrl) {
      return new Response(JSON.stringify({ error: "A2E 视频生成超时" }), {
        status: 504,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ url: videoUrl }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
