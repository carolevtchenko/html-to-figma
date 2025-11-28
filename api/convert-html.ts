// api/convert-html.ts
import type { VercelRequest, VercelResponse } from "@vercel/node"
import { GoogleGenerativeAI } from "@google/generative-ai"

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "")

const SYSTEM_PROMPT = `
You are a UI layout converter. You receive the raw HTML of a single web page and must output a JSON layout specification for Figma.

You DO NOT generate Figma plugin code.
You DO NOT generate natural language explanations.
You ONLY generate a single JSON object that matches the TypeScript type LayoutNode defined below.

TYPE DEFINITIONS (IMPORTANT):

type LayoutNode =
  | {
      type: "FRAME";
      name: string;
      layout?: "VERTICAL" | "HORIZONTAL";
      width?: number | null;
      height?: number | null;
      fills?: string[]; // Hex colors, e.g. ["#FFFFFF"]
      padding?: [number, number, number, number]; // [top, right, bottom, left] in pixels
      spacing?: number; // item spacing in pixels
      children?: LayoutNode[];
    }
  | {
      type: "TEXT";
      name: string;
      text: string;
      fontSize?: number;
      bold?: boolean;
      color?: string; // Hex color, e.g. "#111827"
    };

REQUIREMENTS:

- Output MUST be a single JSON object of type LayoutNode (the root frame).
- Do NOT wrap JSON in markdown.
- Do NOT include comments or extra fields.
- The root node MUST have: type: "FRAME", name (page title or main heading), layout, children.
- Use a reasonable page width (e.g. 1280) and leave height as null if the page scrolls.
- Group elements semantically:
  - side navigation → one FRAME named "Sidebar"
  - top navigation → one FRAME named "Header"
  - main content → one FRAME named "Main"
  - panels/cards → FRAME children inside "Main"
- Ignore invisible elements, analytics scripts, modals that are not part of the main layout, etc.
- Prefer semantic grouping over pixel-perfect reconstruction.
- Try to keep the total number of nodes under 80 by grouping content logically.

STYLING GUIDELINES:

- Infer layout direction from HTML structure and classes:
  - horizontal nav bars, toolbars, and side-by-side elements → layout: "HORIZONTAL"
  - stacked sections → layout: "VERTICAL"
- Use padding and spacing to approximate the visual density of the page (multiples of 4 or 8).
- For TEXT nodes:
  - Use the visible text content from headings, labels, and key copy.
  - Use larger fontSize for titles/headings, smaller for descriptions.
  - Use bold: true for navigation labels, section titles, and emphasized UI labels.
- Colors:
  - Use a small set of main colors based on the page (background, primary text, secondary text).
  - If you’re unsure, use:
    - background: "#FFFFFF"
    - main text: "#111827"
    - secondary text: "#4B5563"

TAILWIND / UTILITY CLASSES:

- If HTML uses Tailwind/utility classes (e.g. "flex", "flex-col", "items-center", "justify-between", "px-6", "py-4"):
  - Map them to layout and spacing decisions in your JSON.
  - You do NOT need to replicate every utility class — just the visual intent:
    - "flex flex-col" → layout: "VERTICAL"
    - "flex" without "flex-col" → layout: "HORIZONTAL"
    - "px-6 py-4" → higher padding values
- Semantic components like nav menus, sidebars, stepper headers, cards should become clean FRAME hierarchies.

VERY IMPORTANT:

- The final answer MUST be valid JSON with no trailing commas, no comments, and no extra top-level fields.
- Do NOT include a top-level array. It MUST be a single JSON object.
`

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST")
    return res.status(405).json({ error: "Method not allowed" })
  }

  const { html, url } = req.body || {}

  if (!html || typeof html !== "string") {
    return res.status(400).json({ error: "Missing 'html' string in body." })
  }

  if (!process.env.GEMINI_API_KEY) {
    return res
      .status(500)
      .json({ error: "GEMINI_API_KEY is not set in environment." })
  }

  try {
    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-pro",
      generationConfig: {
        responseMimeType: "application/json", // força JSON puro
      },
    })

    const userPromptParts: string[] = []
    userPromptParts.push(SYSTEM_PROMPT)

    if (url && typeof url === "string" && url.trim().length > 0) {
      userPromptParts.push(`Source URL: ${url.trim()}`)
    }

    userPromptParts.push("HTML of the page:")
    userPromptParts.push(html)

    const prompt = userPromptParts.join("\n\n-----\n\n")

    const result = await model.generateContent(prompt)
    const text = result.response.text()

    let spec: unknown
    try {
      spec = JSON.parse(text)
    } catch (e) {
      // Se por algum motivo ainda vier algo estranho, devolve pra debug
      return res.status(500).json({
        error: "Model did not return valid JSON.",
        raw: text,
      })
    }

    return res.status(200).json(spec)
  } catch (err: any) {
    console.error("Error in /api/convert-html:", err)
    return res.status(500).json({
      error: "Internal server error",
      detail: err?.message || String(err),
    })
  }
}
