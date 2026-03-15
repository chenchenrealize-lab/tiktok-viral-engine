// ========================================================
// TikTok 爆款内容引擎 — 后端服务器
// 作用：保护 API Key，代理所有外部 API 请求
// ========================================================

const express = require("express");
const dotenv = require("dotenv");
const fetch = require("node-fetch");
const FormData = require("form-data");

// 读取 .env 文件中的 API Key
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// 中间件：解析 JSON 请求体
app.use(express.json());

// 中间件：把当前目录的文件当作网页提供（这样 index.html 就能通过 localhost:3000 访问）
app.use(express.static("."));

// 工具函数：延时
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --------------------------------------------------------
// API 1：抓取 TikTok 数据（代理 Apify）
// 前端发：{ keyword, resultsPerPage }
// 后端做：启动 Apify 爬虫 → 轮询等待完成 → 返回数据
// --------------------------------------------------------
app.post("/api/scrape", async (req, res) => {
  // 这个接口可能要跑很久（Apify 爬虫需要时间），设置 6 分钟超时
  req.setTimeout(360000);

  const { keyword, resultsPerPage = 20 } = req.body;
  const token = process.env.APIFY_TOKEN;

  if (!token) {
    return res.status(500).json({ error: "服务器未配置 APIFY_TOKEN" });
  }

  try {
    // 第一步：启动 Apify 爬虫
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
      return res.status(runResponse.status).json({ error: `Apify 请求失败: ${errText}` });
    }

    const runData = await runResponse.json();
    const datasetId = runData.data?.defaultDatasetId;
    const runId = runData.data?.id;
    let status = runData.data?.status;

    if (!datasetId) {
      return res.status(500).json({ error: "Apify 没有返回数据集 ID" });
    }

    // 第二步：轮询等待爬虫完成
    let retries = 0;
    const maxRetries = 60; // 最多等 5 分钟

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
      return res.status(500).json({ error: "Apify 爬虫运行失败" });
    }
    if (retries >= maxRetries) {
      return res.status(504).json({ error: "Apify 爬虫超时" });
    }

    // 第三步：获取数据
    const dataRes = await fetch(
      `https://api.apify.com/v2/datasets/${datasetId}/items?format=json`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (!dataRes.ok) {
      return res.status(500).json({ error: "获取 Apify 数据集失败" });
    }

    const items = await dataRes.json();
    res.json(items);
  } catch (err) {
    console.error("Apify scrape error:", err);
    res.status(500).json({ error: err.message });
  }
});

// --------------------------------------------------------
// API 2：语音转录（代理 Groq Whisper）
// 前端发：{ videoUrl, filename }
// 后端做：下载视频 → 发给 Groq Whisper → 返回转录文字
// --------------------------------------------------------
app.post("/api/transcribe", async (req, res) => {
  const { videoUrl, filename = "video.mp4" } = req.body;
  const apiKey = process.env.GROQ_API_KEY;

  if (!apiKey) {
    return res.status(500).json({ error: "服务器未配置 GROQ_API_KEY" });
  }
  if (!videoUrl) {
    return res.status(400).json({ error: "缺少 videoUrl 参数" });
  }

  try {
    // 第一步：下载视频文件
    const videoRes = await fetch(videoUrl);
    if (!videoRes.ok) {
      return res.status(400).json({ error: "视频下载失败" });
    }

    const videoBuffer = await videoRes.buffer();

    // 检查文件大小（Groq 限制 25MB）
    if (videoBuffer.length > 25 * 1024 * 1024) {
      return res.status(400).json({ error: `视频太大 (${(videoBuffer.length / 1024 / 1024).toFixed(1)}MB)，超过 25MB 限制` });
    }

    // 第二步：发送到 Groq Whisper API
    const formData = new FormData();
    formData.append("file", videoBuffer, { filename, contentType: "video/mp4" });
    formData.append("model", "whisper-large-v3-turbo");

    const transcriptRes = await fetch(
      "https://api.groq.com/openai/v1/audio/transcriptions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          ...formData.getHeaders(),
        },
        body: formData,
      }
    );

    if (!transcriptRes.ok) {
      const errText = await transcriptRes.text();
      return res.status(transcriptRes.status).json({ error: `Groq 转录失败: ${errText}` });
    }

    const transcriptData = await transcriptRes.json();
    res.json(transcriptData);
  } catch (err) {
    console.error("Transcribe error:", err);
    res.status(500).json({ error: err.message });
  }
});

// --------------------------------------------------------
// API 3：AI 对话（代理 DeepSeek）
// 用于爆款分析和脚本生成，统一走这个接口
// 前端发：{ messages, temperature, max_tokens }
// 后端做：加上 API Key 和 model，转发给 DeepSeek
// --------------------------------------------------------
app.post("/api/chat", async (req, res) => {
  const { messages, temperature = 0.7, max_tokens = 2000 } = req.body;
  const apiKey = process.env.DEEPSEEK_API_KEY;

  if (!apiKey) {
    return res.status(500).json({ error: "服务器未配置 DEEPSEEK_API_KEY" });
  }

  try {
    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "deepseek-chat", // 模型名在后端固定，前端不用知道
        messages,
        temperature,
        max_tokens,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).json({ error: `DeepSeek 请求失败: ${errText}` });
    }

    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error("DeepSeek chat error:", err);
    res.status(500).json({ error: err.message });
  }
});

// --------------------------------------------------------
// API 4：生成数字人视频（代理 A2E）
// 前端发：{ text, voice, aspectRatio }
// 后端做：创建视频任务 → 轮询等完成 → 返回视频 URL
// --------------------------------------------------------
app.post("/api/video", async (req, res) => {
  req.setTimeout(360000); // 6 分钟超时

  const { text, voice = "zh-CN-XiaoxiaoNeural", aspectRatio = "9:16" } = req.body;
  const apiKey = process.env.A2E_API_KEY;

  if (!apiKey) {
    return res.status(500).json({ error: "服务器未配置 A2E_API_KEY" });
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
      return res.status(createRes.status).json({ error: `A2E 创建失败: ${errText}` });
    }

    const createData = await createRes.json();
    const videoId = createData.id || createData.videoId;
    if (!videoId) {
      return res.status(500).json({ error: "A2E 没有返回视频 ID" });
    }

    // 第二步：轮询等待视频生成
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
          return res.status(500).json({ error: "A2E 视频生成失败: " + (statusData.error || "未知错误") });
        }
      }
    }

    if (!videoUrl) {
      return res.status(504).json({ error: "A2E 视频生成超时" });
    }

    res.json({ url: videoUrl });
  } catch (err) {
    console.error("A2E video error:", err);
    res.status(500).json({ error: err.message });
  }
});

// --------------------------------------------------------
// 健康检查：确认服务器在运行
// --------------------------------------------------------
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    keys: {
      apify: !!process.env.APIFY_TOKEN,
      groq: !!process.env.GROQ_API_KEY,
      deepseek: !!process.env.DEEPSEEK_API_KEY,
      a2e: !!process.env.A2E_API_KEY,
    },
  });
});

// --------------------------------------------------------
// 启动服务器
// --------------------------------------------------------
app.listen(PORT, () => {
  console.log(`\n🚀 TikTok 爆款内容引擎已启动: http://localhost:${PORT}\n`);
  console.log("API Key 配置状态:");
  console.log(`  Apify:    ${process.env.APIFY_TOKEN ? "✅ 已配置" : "❌ 未配置"}`);
  console.log(`  Groq:     ${process.env.GROQ_API_KEY ? "✅ 已配置" : "❌ 未配置"}`);
  console.log(`  DeepSeek: ${process.env.DEEPSEEK_API_KEY ? "✅ 已配置" : "❌ 未配置"}`);
  console.log(`  A2E:      ${process.env.A2E_API_KEY ? "✅ 已配置" : "❌ 未配置"}`);
  console.log("");
});
