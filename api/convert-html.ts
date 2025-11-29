// api/convert-html.ts
import { GoogleGenerativeAI } from "@google/generative-ai";
import { chromium } from "playwright";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default async function handler(req: any, res: any) {
  // 1. Configura CORS
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    res.setHeader(key, value);
  }

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method Not Allowed" });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "GEMINI_API_KEY is not set." });
    return;
  }

  const { html, url, viewportWidth } = req.body || {};
  const targetWidth = typeof viewportWidth === "number" && viewportWidth > 0 ? viewportWidth : 1440;

  if (!html && !url) {
    res.status(400).json({ error: "Must provide 'html' or 'url'." });
    return;
  }

  let browser = null;
  try {
    // 2. Inicializa o Gemini
    const genAI = new GoogleGenerativeAI(apiKey);
    // Usamos o modelo Flash que suporta imagens e é rápido
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    // 3. Usa o Playwright para renderizar e tirar print
    // Nota: Em produção (Vercel), pode ser necessário configurar bibliotecas específicas para o Chromium.
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.setViewportSize({ width: targetWidth, height: 1200 });

    if (url) {
      await page.goto(url, { waitUntil: "networkidle", timeout: 15000 }).catch(e => console.log("Timeout navegando, prosseguindo..."));
    } else {
      await page.setContent(html, { waitUntil: "networkidle" });
    }

    // Tira o screenshot (visão computacional para a IA)
    const screenshotBuffer = await page.screenshot({ fullPage: false });
    const base64Image = screenshotBuffer.toString("base64");

    const imagePart = {
      inlineData: {
        data: base64Image,
        mimeType: "image/png",
      },
    };

    // 4. Prompt de Alta Fidelidade
    const systemPrompt = `
    You are an expert Figma Developer and UI Designer.
    GOAL: Convert the provided Website Screenshot and HTML into a HIGH-FIDELITY Figma Auto Layout JSON specification.
    
    TARGET_WIDTH: ${targetWidth}px

    STRICT GUIDELINES:
    1. **Visual Fidelity**: Rely heavily on the IMAGE to get exact colors, background-colors, spacing, and visual hierarchy. Use the HTML only for structure and text content.
    2. **Styling Details**: You MUST include properties for:
       - "strokes" (borders): color and width.
       - "cornerRadius": number (border-radius).
       - "effects": drop shadows (type: "DROP_SHADOW").
    3. **Layout**:
       - Use "FRAME" for containers.
       - Use "TEXT" for text.
       - Use "RECTANGLE" for pure visual blocks or placeholders.
       - Determine "layoutMode" (VERTICAL/HORIZONTAL) accurately.
       - Calculate "itemSpacing" and "padding" precisely based on the image.
    
    JSON STRUCTURE:
    {
      "type": "FRAME" | "TEXT" | "RECTANGLE",
      "name": "string",
      "layoutMode": "VERTICAL" | "HORIZONTAL" | "NONE",
      "primaryAxisSizingMode": "FIXED" | "AUTO",
      "counterAxisSizingMode": "FIXED" | "AUTO",
      "primaryAxisAlignItems": "MIN" | "CENTER" | "MAX" | "SPACE_BETWEEN",
      "counterAxisAlignItems": "MIN" | "CENTER" | "MAX",
      "fills": [{ "type": "SOLID", "color": "#HEX", "opacity": 0-1 }],
      "strokes": [{ "type": "SOLID", "color": "#HEX" }],
      "strokeWeight": number,
      "cornerRadius": number,
      "itemSpacing": number,
      "padding": { "top": number, "right": number, "bottom": number, "left": number },
      "effects": [{ "type": "DROP_SHADOW", "color": "#HEX", "offset": { "x": 0, "y": 0 }, "radius": 0, "spread": 0 }],
      "text": "string (only for TEXT type)",
      "fontSize": number,
      "fontWeight": "Regular" | "Medium" | "Bold",
      "textAlign": "LEFT" | "CENTER" | "RIGHT",
      "children": [ ...recursive... ]
    }

    Output ONLY valid JSON. No markdown code blocks.
    `;

    // 5. Envia para o Gemini (Imagem + Texto)
    const result = await model.generateContent([imagePart, systemPrompt]);
    const response = result.response;
    let text = response.text().trim();

    // Limpeza básica de markdown caso o modelo mande
    text = text.replace(/```json/gi, "").replace(/```/g, "").trim();

    const spec = JSON.parse(text);
    res.status(200).json(spec);

  } catch (err: any) {
    console.error("Error in conversion:", err);
    res.status(500).json({ error: "Conversion failed", details: err.message });
  } finally {
    if (browser) await browser.close();
  }
}