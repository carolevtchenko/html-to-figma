// api/convert-html.ts (Versão com Injeção de Tailwind)
import { GoogleGenerativeAI } from "@google/generative-ai";
import chromium from "@sparticuz/chromium";
import { chromium as playwrightCore } from "playwright-core";

// Configurações para rodar no Vercel
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
    // Mantém o Gemini 3.0 para inteligência máxima
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
      // Se tiver URL, usa ela (geralmente já carrega o CSS certo)
      await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
    } else if (html) {
      // --- O PULO DO GATO AQUI ---
      // Injetamos o CDN do Tailwind e uma fonte padrão para garantir que fique bonito
      const enhancedHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <script src="https://cdn.tailwindcss.com"></script>
          <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
          <style>
            body { font-family: 'Inter', sans-serif; background: #f5f5f5; margin: 0; }
            /* Garante que o conteúdo ocupe a altura se necessário */
            html, body { min-height: 100vh; } 
          </style>
        </head>
        <body>
          ${html}
        </body>
        </html>
      `;
      
      await page.setContent(enhancedHtml, { waitUntil: "networkidle" });
    } else {
      throw new Error("Preciso de uma URL ou HTML.");
    }

    // Tira o Screenshot da página agora ESTILIZADA
    const screenshotBuffer = await page.screenshot({ fullPage: false });
    const base64Image = screenshotBuffer.toString("base64");
    
    const imagePart = {
      inlineData: {
        data: base64Image,
        mimeType: "image/png",
      },
    };

    const systemPrompt = `
    You are an expert Figma Developer.
    GOAL: Convert the provided Website Screenshot (which uses Tailwind) and HTML into a HIGH-FIDELITY Figma Auto Layout JSON.
    TARGET_WIDTH: ${targetWidth}px

    STRICT GUIDELINES:
    1. **Visual Fidelity**: The screenshot is your source of truth for layout, alignment, and spacing.
    2. **Auto Layout**: Use "layoutMode": "HORIZONTAL" for rows (like flex-row) and "VERTICAL" for columns (flex-col).
    3. **Fill Container**: If an element spans the full width or grows to fill space, use "layoutGrow": 1.
    4. **Styling**: Extract exact colors, borders, and rounded corners from the screenshot.
    
    JSON STRUCTURE:
    {
      "type": "FRAME" | "TEXT",
      "name": "string",
      "layoutMode": "VERTICAL" | "HORIZONTAL" | "NONE",
      "layoutGrow": 0 | 1,
      "primaryAxisSizingMode": "FIXED" | "AUTO",
      "counterAxisSizingMode": "FIXED" | "AUTO",
      "primaryAxisAlignItems": "MIN" | "CENTER" | "MAX" | "SPACE_BETWEEN",
      "counterAxisAlignItems": "MIN" | "CENTER" | "MAX",
      "fills": [{ "type": "SOLID", "color": "#HEX", "opacity": 0-1 }],
      "strokes": [{ "type": "SOLID", "color": "#HEX" }],
      "cornerRadius": number,
      "padding": { "top": number, "right": number, "bottom": number, "left": number },
      "itemSpacing": number,
      "effects": [],
      "text": "string",
      "fontSize": number,
      "fontWeight": "Regular" | "Medium" | "Bold",
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
    console.error("Erro na conversão:", err);
    res.status(500).json({ error: "Falha na conversão", details: err.message });
  } finally {
    if (browser) await browser.close();
  }
}