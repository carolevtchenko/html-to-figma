// api/convert-html.ts
import { GoogleGenerativeAI } from "@google/generative-ai";
import chromium from "@sparticuz/chromium";
import { chromium as playwrightCore } from "playwright-core";

// Configurações para rodar no Vercel (limite de memória e fontes)
chromium.setHeadlessMode = true;
chromium.setGraphicsMode = false;

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default async function handler(req: any, res: any) {
  // CORS Setup
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

  let browser = null;

  try {
    // 1. Inicializa o Gemini
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-3-pro-preview" });

    // 2. Configura o Browser (A mágica acontece aqui)
    // Se estivermos no Vercel, usamos o @sparticuz/chromium. 
    // Se for local, tentamos achar um executável local ou falhará se não tiver o playwright full instalado.
    
    const executablePath = await chromium.executablePath();
    
    browser = await playwrightCore.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: executablePath,
      headless: chromium.headless,
    });

    const page = await browser.newPage();
    await page.setViewportSize({ width: targetWidth, height: 1200 });

    if (url) {
      // Timeout maior para garantir que dê tempo de carregar
      await page.goto(url, { waitUntil: "networkidle", timeout: 20000 });
    } else if (html) {
      await page.setContent(html, { waitUntil: "networkidle" });
    } else {
        throw new Error("No URL or HTML provided");
    }

    // Tira Screenshot
    const screenshotBuffer = await page.screenshot({ fullPage: false });
    const base64Image = screenshotBuffer.toString("base64");
    
    const imagePart = {
      inlineData: {
        data: base64Image,
        mimeType: "image/png",
      },
    };

    // 3. Prompt
    const systemPrompt = `
    You are an expert Figma Developer.
    GOAL: Convert the provided Website Screenshot and HTML into a HIGH-FIDELITY Figma Auto Layout JSON specification.
    TARGET_WIDTH: ${targetWidth}px

    STRICT GUIDELINES:
    1. **Visual Fidelity**: Use the IMAGE to get exact colors, spacing, and hierarchy.
    2. **Styling**: Include "strokes" (borders), "cornerRadius", and "effects" (shadows).
    3. **Layout**: Use "FRAME" for containers, "TEXT" for text. Calculate "itemSpacing" and "padding" precisely.
    
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
      "children": []
    }
    Output ONLY valid JSON.
    `;

    // 4. Envia para o Gemini
    const result = await model.generateContent([imagePart, systemPrompt]);
    const response = result.response;
    let text = response.text().trim();
    text = text.replace(/```json/gi, "").replace(/```/g, "").trim();

    const spec = JSON.parse(text);
    res.status(200).json(spec);

  } catch (err: any) {
    console.error("Error in conversion:", err);
    // Retorna o erro detalhado para o frontend ver o que houve
    res.status(500).json({ error: "Conversion failed", details: err.message });
  } finally {
    if (browser) await browser.close();
  }
}