// /api/convert-html.ts
import type { VercelRequest, VercelResponse } from "@vercel/node"
import { chromium } from "playwright"
import { GoogleGenerativeAI } from "@google/generative-ai"

type LayoutDirection = "VERTICAL" | "HORIZONTAL"

interface TextSpec {
  type: "TEXT"
  name: string
  text: string
  fontSize: number
  bold: boolean
  color: string
}

interface FrameSpec {
  type: "FRAME"
  name: string
  layout: LayoutDirection
  spacing: number
  padding: [number, number, number, number]
  fills: string[]
  children: Array<FrameSpec | TextSpec>
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Only POST method is allowed." })
    return
  }

  const { html, url, viewportWidth } = req.body || {}

  if ((!html || typeof html !== "string") && !url) {
    res
      .status(400)
      .json({ error: "Body must contain an 'html' string or a 'url'." })
    return
  }

  try {
    // 1) Se tiver URL → usar modo "snapshot auto layout"
    if (url && typeof url === "string") {
      const spec = await createSpecFromRealPage(url, viewportWidth || 1440)
      res.status(200).json(spec)
      return
    }

    // 2) Fallback: usar Gemini com o HTML bruto (modo atual)
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) {
      res
        .status(500)
        .json({ error: "GEMINI_API_KEY is not set in environment." })
      return
    }

    const genAI = new GoogleGenerativeAI(apiKey)
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" })

    const prompt = `
You are a layout conversion engine for Figma.
Return ONLY valid JSON for an auto-layout frame using this schema:

{
  "type": "FRAME",
  "name": "string",
  "layout": "VERTICAL" | "HORIZONTAL",
  "spacing": number,
  "padding": [top,right,bottom,left],
  "fills": ["#RRGGBB"],
  "children": [
    {
      "type": "TEXT",
      "name": "string",
      "text": "string",
      "fontSize": number,
      "bold": boolean,
      "color": "#RRGGBB"
    } | {
      "type": "FRAME",
      "name": "string",
      "layout": "VERTICAL" | "HORIZONTAL",
      "spacing": number,
      "padding": [number,number,number,number],
      "fills": ["#RRGGBB"],
      "children": [...]
    }
  ]
}

Use sensible spacings and paddings based on the HTML hierarchy.
HTML INPUT:
${html}
SOURCE URL (hint only):
${url || "N/A"}
`.trim()

    const result = await model.generateContent(prompt)
    const response = result.response
    let textResp = response.text().trim()
    textResp = textResp.replace(/```json/gi, "").replace(/```/g, "").trim()

    const spec = JSON.parse(textResp) as FrameSpec
    res.status(200).json(spec)
  } catch (err: any) {
    console.error("Error in /api/convert-html:", err)
    res.status(500).json({
      error: "Failed to convert HTML to Figma spec.",
      detail: String(err?.message || err),
    })
  }
}

/**
 * Abre a página real em um navegador headless, mede os elementos
 * e converte num auto layout vertical de "linhas" + alguns grupos horizontais.
 */
async function createSpecFromRealPage(
  url: string,
  viewportWidth: number
): Promise<FrameSpec> {
  const browser = await chromium.launch()
  const page = await browser.newPage({
    viewport: { width: viewportWidth, height: 900 },
  })

  await page.goto(url, { waitUntil: "networkidle" })

  // Pega blocos "importantes": headings, parágrafos, botões, links dentro de <main>
  const nodes = await page.evaluate(() => {
    const root =
      document.querySelector("main") ||
      document.querySelector("[role='main']") ||
      document.body

    const selector =
      "h1,h2,h3,h4,p,button,a,[role='button'],li,label,span,strong,em"

    const elements = Array.from(root.querySelectorAll(selector)) as HTMLElement[]

    return elements
      .map((el) => {
        const rect = el.getBoundingClientRect()
        const style = window.getComputedStyle(el)
        const text = (el.innerText || el.textContent || "").trim()
        if (!text) return null

        return {
          text,
          tag: el.tagName.toLowerCase(),
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
          fontSize: parseFloat(style.fontSize || "14"),
          fontWeight: /bold|700|600/.test(style.fontWeight) ? "bold" : "normal",
          color: style.color,
        }
      })
      .filter(Boolean)
  })

  await browser.close()

  if (!nodes || nodes.length === 0) {
    // fallback bem simples
    return {
      type: "FRAME",
      name: "Page",
      layout: "VERTICAL",
      spacing: 16,
      padding: [32, 32, 32, 32],
      fills: ["#FFFFFF"],
      children: [],
    }
  }

  // Normaliza cor pra #RRGGBB se vier "rgb(...)"
  function toHex(color: string): string {
    if (color.startsWith("#")) return color
    const m = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i)
    if (!m) return "#111111"
    const r = Number(m[1]).toString(16).padStart(2, "0")
    const g = Number(m[2]).toString(16).padStart(2, "0")
    const b = Number(m[3]).toString(16).padStart(2, "0")
    return `#${r}${g}${b}`
  }

  // Ordena por posição na página
  nodes.sort((a: any, b: any) => a.top - b.top || a.left - b.left)

  // Agrupa em "linhas" quando a diferença de top é pequena
  const rows: any[][] = []
  const rowTolerance = 24 // px

  for (const n of nodes as any[]) {
    const lastRow = rows[rows.length - 1]
    if (!lastRow) {
      rows.push([n])
      continue
    }

    const rowTop = lastRow[0].top
    if (Math.abs(n.top - rowTop) <= rowTolerance) {
      lastRow.push(n)
    } else {
      rows.push([n])
    }
  }

  // Converte cada linha em um frame H ou TEXT único
  const children: Array<FrameSpec | TextSpec> = rows.map((row, rowIndex) => {
    if (row.length === 1) {
      const n = row[0]
      return {
        type: "TEXT",
        name: `${n.tag.toUpperCase()} ${rowIndex + 1}`,
        text: n.text,
        fontSize: Math.round(n.fontSize),
        bold: n.fontWeight === "bold",
        color: toHex(n.color),
      }
    }

    // linha com vários itens → frame horizontal
    const texts: TextSpec[] = row.map((n: any, i: number) => ({
      type: "TEXT",
      name: `${n.tag.toUpperCase()} ${rowIndex + 1}.${i + 1}`,
      text: n.text,
      fontSize: Math.round(n.fontSize),
      bold: n.fontWeight === "bold",
      color: toHex(n.color),
    }))

    // spacing médio entre os elementos da linha
    let avgGap = 16
    if (row.length > 1) {
      const gaps: number[] = []
      for (let i = 0; i < row.length - 1; i++) {
        const current = row[i]
        const next = row[i + 1]
        const gap = next.left - (current.left + current.width)
        if (gap > 0) gaps.push(gap)
      }
      if (gaps.length) {
        avgGap = Math.max(8, Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length))
      }
    }

    const leftMost = row.reduce(
      (min: number, n: any) => Math.min(min, n.left),
      row[0].left
    )
    const rightMost = row.reduce(
      (max: number, n: any) => Math.max(max, n.left + n.width),
      row[0].left + row[0].width
    )

    const paddingLeft = Math.round(leftMost)
    const paddingRight = Math.max(24, Math.round(viewportWidth - rightMost))

    const frame: FrameSpec = {
      type: "FRAME",
      name: `Row ${rowIndex + 1}`,
      layout: "HORIZONTAL",
      spacing: avgGap,
      padding: [0, paddingRight, 0, paddingLeft],
      fills: ["#FFFFFF"],
      children: texts,
    }

    return frame
  })

  // spacing vertical = média dos gaps entre linhas
  let verticalSpacing = 24
  if (rows.length > 1) {
    const gaps: number[] = []
    for (let i = 0; i < rows.length - 1; i++) {
      const lastOfRow = rows[i][rows[i].length - 1]
      const firstNext = rows[i + 1][0]
      const gap = firstNext.top - (lastOfRow.top + lastOfRow.height)
      if (gap > 0) gaps.push(gap)
    }
    if (gaps.length) {
      verticalSpacing = Math.max(
        12,
        Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length)
      )
    }
  }

  const pageFrame: FrameSpec = {
    type: "FRAME",
    name: "Page (auto layout)",
    layout: "VERTICAL",
    spacing: verticalSpacing,
    padding: [40, 40, 40, 40],
    fills: ["#FFFFFF"],
    children,
  }

  return pageFrame
}
