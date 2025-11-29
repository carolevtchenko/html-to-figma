// api/convert-html.ts (Versão Inteligente: Detecta HTML Completo)
import { GoogleGenerativeAI } from "@google/generative-ai";
import chromium from "@sparticuz/chromium";
import { chromium as playwrightCore } from "playwright-core";

chromium.setHeadlessMode = true;
chromium.setGraphicsMode = false;

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default async function handler(req: any, res: any) {
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    res.setHeader(key, value);
  }

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "GEMINI_API_KEY is not set." });
    return;
  }

  const { html, url, viewportWidth } = req.body || {};
  const targetWidth = viewportWidth || 1440;

  let browser = null;

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-3-pro-preview" });

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
      await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
    } else if (html) {
      let finalHtml = html;

      // VERIFICAÇÃO INTELIGENTE:
      // Se o HTML já começa com doctype ou html, usamos ele puro.
      // Caso contrário, injetamos o esqueleto padrão.
      if (!html.trim().match(/^\s*<!DOCTYPE/i) && !html.trim().match(/^\s*<html/i)) {
        finalHtml = `
          <!DOCTYPE html>
          <html>
          <head>
            <script src="https://cdn.tailwindcss.com"></script>
            <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
            <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined" rel="stylesheet"/>
            <style>
              body { font-family: 'Inter', sans-serif; margin: 0; background: white; }
              * { box-sizing: border-box; }
            </style>
          </head>
          <body>
            ${html}
          </body>
          </html>
        `;
      }
      
      // Carrega o HTML e espera a rede ficar ociosa (para carregar fontes e scripts)
      await page.setContent(finalHtml, { waitUntil: "networkidle", timeout: 60000 });
    } else {
      throw new Error("Preciso de URL ou HTML.");
    }

    const screenshotBuffer = await page.screenshot({ fullPage: false });
    const base64Image = screenshotBuffer.toString("base64");
    
    const imagePart = {
      inlineData: {
        data: base64Image,
        mimeType: "image/png",
      },
    };

    const systemPrompt = `
    You are a Senior UI Engineer specializing in Figma Auto Layout.
    
    INPUT: A screenshot of a web interface and its raw HTML.
    GOAL: Recreate the layout in Figma JSON, adapting intelligently to the specific design pattern visible.

    DECISION RULES:
    1. **Detect Layout Pattern**: 
       - **Is it a Dashboard?** (Left Sidebar + Right Content) -> Root Frame "layoutMode": "HORIZONTAL".
       - **Is it a Landing Page?** -> Root Frame "layoutMode": "VERTICAL".
    
    2. **Smart Icon Detection**: 
       - **Material Symbols/SVGs:** If you see small icons (dashboard, settings, arrows), create a FRAME 24x24px (Fixed Width/Height).
       - Do NOT create giant colored blocks for icons. Keep them transparent or use the icon color.
    
    3. **Spacing & Hierarchy**:
       - Use "itemSpacing" to match the whitespace.
       - Group elements logically (e.g. Sidebar Links together, Form inputs together).

    4. **Fill Container**:
       - Use "layoutGrow": 1 for the main content area or flexible text/inputs.

    JSON STRUCTURE:
    {
      "type": "FRAME" | "TEXT",
      "name": "string",
      "layoutMode": "VERTICAL" | "HORIZONTAL",
      "layoutGrow": 0 | 1,
      "primaryAxisSizingMode": "FIXED" | "AUTO",
      "counterAxisSizingMode": "FIXED" | "AUTO",
      "width": number | null, 
      "height": number | null,
      "fills": [{ "type": "SOLID", "color": "#HEX", "opacity": number }],
      "strokes": [{ "type": "SOLID", "color": "#HEX" }],
      "cornerRadius": number,
      "itemSpacing": number,
      "padding": { "top": number, "right": number, "bottom": number, "left": number },
      "text": "string",
      "fontSize": number,
      "textAlign": "LEFT" | "CENTER" | "RIGHT",
      "children": []
    }
    Output ONLY valid JSON.
    `;

    const result = await model.generateContent([imagePart, systemPrompt]);
    const response = result.response;
    let text = response.text().trim();
    text = text.replace(/```json/gi, "").replace(/```/g, "").trim();

    const spec = JSON.parse(text);
    res.status(200).json(spec);

  } catch (err: any) {
    console.error("Erro:", err);
    res.status(500).json({ error: "Falha", details: err.message });
  } finally {
    if (browser) await browser.close();
  }
}