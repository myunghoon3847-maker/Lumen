const MAX_REQUEST_LENGTH = 2000;

module.exports = async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({error: "지원하지 않는 요청입니다."});
  }

  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || "gpt-5-mini";

  if (!apiKey) {
    return res.status(500).json({error: "API_KEY_MISSING"});
  }

  const request = String(req.body?.request || "").trim();

  if (!request) {
    return res.status(400).json({error: "글쓰기 요청을 입력해 주세요."});
  }

  if (request.length > MAX_REQUEST_LENGTH) {
    return res.status(400).json({error: "요청은 2,000자 이하로 입력해 주세요."});
  }

  try {
    const openaiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        instructions: [
          "당신은 한국어 전문 작가이자 편집자입니다.",
          "사용자의 요청에 맞는 완성된 글을 작성하세요.",
          "작업 과정, 프롬프트, 분석, 불필요한 설명은 출력하지 마세요.",
          "사용자가 분량이나 문체를 지정하면 그대로 따르세요.",
          "사실을 임의로 만들지 말고, 확인할 수 없는 정보는 단정하지 마세요.",
          "문장은 자연스럽고 읽기 쉽게 작성하세요."
        ].join(" "),
        input: request,
        max_output_tokens: 1800
      })
    });

    const data = await openaiResponse.json().catch(() => ({}));

    if (!openaiResponse.ok) {
      console.error("OpenAI API error:", data);

      const code = data?.error?.code || "";
      const message = data?.error?.message || "";

      if (openaiResponse.status === 429) {
        if (/quota|billing|credit/i.test(message) || code === "insufficient_quota") {
          return res.status(429).json({error: "QUOTA"});
        }
        return res.status(429).json({error: "RATE_LIMIT"});
      }

      if (/model/i.test(message) || code === "model_not_found") {
        return res.status(400).json({error: "MODEL"});
      }

      return res.status(502).json({error: "AI 서비스 요청에 실패했습니다."});
    }

    const text = extractOutputText(data);

    if (!text) {
      return res.status(502).json({error: "AI가 빈 결과를 반환했습니다."});
    }

    return res.status(200).json({text});
  } catch (error) {
    console.error("Server error:", error);
    return res.status(500).json({error: "서버 오류가 발생했습니다."});
  }
};

function extractOutputText(data) {
  if (typeof data?.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }

  return (data?.output || [])
    .flatMap(item => Array.isArray(item.content) ? item.content : [])
    .filter(item => item.type === "output_text" && typeof item.text === "string")
    .map(item => item.text)
    .join("\n")
    .trim();
}