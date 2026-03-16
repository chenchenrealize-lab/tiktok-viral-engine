// 语音转录：下载视频 → 发给 Groq Whisper → 返回文字
export async function onRequestPost(context) {
  const { request, env } = context;
  const { videoUrl, filename = "video.mp4" } = await request.json();
  const apiKey = env.GROQ_API_KEY;

  if (!apiKey) {
    return new Response(JSON.stringify({ error: "未配置 GROQ_API_KEY" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (!videoUrl) {
    return new Response(JSON.stringify({ error: "缺少 videoUrl 参数" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    // 第一步：下载视频文件
    const videoRes = await fetch(videoUrl);
    if (!videoRes.ok) {
      return new Response(JSON.stringify({ error: "视频下载失败" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const videoBuffer = await videoRes.arrayBuffer();

    // 检查文件大小（Groq 限制 25MB）
    if (videoBuffer.byteLength > 25 * 1024 * 1024) {
      return new Response(JSON.stringify({
        error: `视频太大 (${(videoBuffer.byteLength / 1024 / 1024).toFixed(1)}MB)，超过 25MB 限制`
      }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // 第二步：发送到 Groq Whisper API（用 Workers 原生的 FormData 和 Blob）
    const blob = new Blob([videoBuffer], { type: "video/mp4" });
    const formData = new FormData();
    formData.append("file", blob, filename);
    formData.append("model", "whisper-large-v3-turbo");

    const transcriptRes = await fetch(
      "https://api.groq.com/openai/v1/audio/transcriptions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        body: formData,
      }
    );

    if (!transcriptRes.ok) {
      const errText = await transcriptRes.text();
      return new Response(JSON.stringify({ error: `Groq 转录失败: ${errText}` }), {
        status: transcriptRes.status,
        headers: { "Content-Type": "application/json" },
      });
    }

    const transcriptData = await transcriptRes.json();
    return new Response(JSON.stringify(transcriptData), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
