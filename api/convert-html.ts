// api/convert-html.ts
import { GoogleGenerativeAI } from "@google/generative-ai"

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*", // se quiser pode trocar por origem específica
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
}

export default async function handler(req: any, res: any) {
  // sempre seta CORS
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    res.setHeader(key, value)
  }

  // 🔹 responde o preflight
  if (req.method === "OPTIONS") {
    res.status(200).end()
    return
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method Not Allowed" })
    return
  }

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    res
      .status(500)
      .json({ error: "GEMINI_API_KEY is not set in environment." })
    return
  }

  const { html, url, viewportWidth } = req.body || {}

  if (!html || typeof html !== "string") {
    res.status(400).json({ error: "Body must contain an 'html' string." })
    return
  }

  const targetWidth =
    typeof viewportWidth === "number" && viewportWidth > 0
      ? viewportWidth
      : 1440

  try {
    const genAI = new GoogleGenerativeAI(apiKey)
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" })

    const prompt = `
You are a layout conversion engine for Figma.

GOAL:
- Receive an HTML snippet from a real product page.
- Return a CLEAN, MINIMAL JSON specification for a Figma Auto Layout frame.

TARGET_VIEWPORT_WIDTH: ${targetWidth}

RULES:
- Output ONLY valid JSON, no prose, no markdown.
- JSON root must describe a frame:
  {
    "type": "FRAME",
    "name": "string",
    "layout": "VERTICAL" | "HORIZONTAL",
    "spacing": number,
    "padding": [top,right,bottom,left],
    "fills": ["#RRGGBB"],
    "children": [ ... ]
  }

- Children may be:
  - TEXT nodes:
    {
      "type": "TEXT",
      "name": "string",
      "text": "string",
      "fontSize": number,
      "bold": boolean,
      "color": "#RRGGBB"
    }
  - nested FRAME nodes (same shape as the root).

- Ignore images, icons, and super complex styling.
- Focus on hierarchy of content and sensible spacings.
- Try to approximate the layout for a viewport width of ${targetWidth}px.

HTML INPUT:
${html}

SOURCE URL (hint only, optional):
${url || "N/A"}
    `.trim()

    const result = await model.generateContent(prompt)
    const response = result.response
    let text = response.text().trim()

    // às vezes o modelo vem com ```json ... ```
    text = text.replace(/```json/gi, "").replace(/```/g, "").trim()

    let spec: any
    try {
      spec = JSON.parse(text)
    } catch (err) {
      console.error("Failed to parse JSON from model:", text)
      throw err
    }

    res.status(200).json(spec)
  } catch (err: any) {
    console.error("Error in /api/convert-html:", err)
    res.status(500).json({
      error: "Failed to convert HTML to Figma spec.",
      detail: String(err?.message || err),
    })
  }
}
