// ブラウザとClaudeの間に立つ部分。
// APIキーはここでだけ使う。ブラウザ側には一切渡さない。

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: { message: "POSTで送ってください" } });
  }

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return res.status(500).json({
      error: { message: "APIキーが設定されていません。Vercelの環境変数を確認してください。" },
    });
  }

  try {
    const { content } = req.body;
    if (!content) {
      return res.status(400).json({ error: { message: "content がありません" } });
    }

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1000,
        messages: [{ role: "user", content }],
      }),
    });

    const data = await r.json();
    if (!r.ok) {
      return res.status(r.status).json({
        error: { message: data?.error?.message || "Claudeからの応答が異常です" },
      });
    }
    return res.status(200).json(data);
  } catch (e) {
    return res.status(500).json({ error: { message: String(e.message || e) } });
  }
}

export const config = {
  api: { bodyParser: { sizeLimit: "20mb" } },
  maxDuration: 60,
};
