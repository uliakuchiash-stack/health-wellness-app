export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      error: "Method not allowed",
    });
  }

  try {
    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        ok: false,
        error: "OPENAI_API_KEY is not set in Vercel Environment Variables",
      });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const imageDataUrl = body?.imageDataUrl;
    const language = body?.language || "uk";

    if (!imageDataUrl || typeof imageDataUrl !== "string") {
      return res.status(400).json({
        ok: false,
        error: "No imageDataUrl provided",
      });
    }

    if (!imageDataUrl.startsWith("data:image/")) {
      return res.status(400).json({
        ok: false,
        error: "Invalid image format",
      });
    }

    if (imageDataUrl.length > 8_000_000) {
      return res.status(413).json({
        ok: false,
        error: "Image is too large. Please upload a smaller photo.",
      });
    }

    const prompt = `
You are a food calorie estimation assistant for a wellness app.

Analyze the food photo and estimate calories.

Important:
- This is only an approximate estimate, not medical advice.
- If portion size is unclear, make a reasonable estimate and mention low confidence.
- Return ONLY valid JSON.
- Do not include markdown.
- Use the requested language for food names and notes.
- Requested language code: ${language}

Return this JSON structure:
{
  "items": [
    {
      "name": "food name",
      "portion": "estimated portion, for example 120 g or 2 pieces",
      "kcal": 123,
      "confidence": "high | medium | low"
    }
  ],
  "totalKcal": 456,
  "summary": "short human-readable summary",
  "warning": "Approximate estimate only. For better accuracy, edit portions manually."
}
`;

    const openaiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.FOOD_SCAN_MODEL || "gpt-4.1-mini",
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: prompt,
              },
              {
                type: "input_image",
                image_url: imageDataUrl,
              },
            ],
          },
        ],
        max_output_tokens: 900,
      }),
    });

    const data = await openaiResponse.json();

    if (!openaiResponse.ok) {
      return res.status(openaiResponse.status).json({
        ok: false,
        error: data?.error?.message || "OpenAI request failed",
      });
    }

    let text = data.output_text;

    if (!text && Array.isArray(data.output)) {
      text = data.output
        .flatMap((item) => item.content || [])
        .map((content) => content.text || "")
        .join("")
        .trim();
    }

    if (!text) {
      return res.status(500).json({
        ok: false,
        error: "Empty AI response",
      });
    }

    let parsed;

    try {
      parsed = JSON.parse(text);
    } catch (e) {
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        parsed = JSON.parse(match[0]);
      } else {
        return res.status(500).json({
          ok: false,
          error: "AI response was not valid JSON",
          raw: text,
        });
      }
    }

    return res.status(200).json({
      ok: true,
      result: parsed,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || "Server error",
    });
  }
}
