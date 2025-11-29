// api/convert-html.ts
import { GoogleGenerativeAI } from "@google/generative-ai"

export default async function handler(req: any, res: any) {
  // 🔹 CORS – sempre setar antes de tudo
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type")

  // Responde preflight (OPTIONS)
  if (req.method === "OPTIONS") {
    res.status(200).end()
    return
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Only POST method is allowed." })
    return
  }

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    res
      .status(500)
      .json({ error: "GEMINI_API_KEY is not set in environment." })
    return
  }

  const { html, url } = req.body || {}

  if (!html || typeof html !== "string") {
    res.status(400).json({ error: "Body must contain an 'html' string." })
    return
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey)

    // modelo que já testamos via curl
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" })

    const prompt = `
You are a layout conversion engine for Figma.

GOAL:
- Receive an HTML snippet from a real product page.
- Return a CLEAN, MINIMAL JSON specification for a Figma Auto Layout frame.

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

HTML INPUT:
${html}

SOURCE URL (hint only, optional):
${url || "N/A"}
    `.trim()

    const result = await model.generateContent(prompt)
    const response = result.response
    let text = response.text().trim()

    // Remove blocos ```json ... ``` se o modelo insistir em mandar
    text = text.replace(/```json/gi, "").replace(/```/g, "").trim()

    let spec: any
    try {
      spec = JSON.parse(text)
    } catch (err) {
      console.error("Failed to parse JSON from model:", text)
      throw err
    }

    // 🔹 garantir que a resposta também leva os headers de CORS
    res.setHeader("Access-Control-Allow-Origin", "*")
    res.status(200).json(spec)
  } catch (err: any) {
    console.error("Error in /api/convert-html:", err)
    res.status(500).json({
      error: "Failed to convert HTML to Figma spec.",
      detail: String(err?.message || err),
    })
  }
}
