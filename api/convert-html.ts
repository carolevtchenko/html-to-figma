// api/convert-html.ts (Versão Blindada: Força Ícones e Layout)
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
    // Usamos o Gemini 3.0 Pro, que é o melhor visualmente
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
      // --- A CORREÇÃO MÁGICA ---
      // Mesmo se o HTML vier "congelado", nós injetamos os links de fontes vitais no topo.
      // Isso conserta os ícones quebrados.
      const criticalHead = `
        <head>
          <script src="https://cdn.tailwindcss.com"></script>
          <link href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap" rel="stylesheet">
          <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined" rel="stylesheet"/>
          <style>
            /* Força renderização correta de ícones para a IA não se perder */
            .material-symbols-outlined, [class*="material-symbols"] {
              font-family: 'Material Symbols Outlined' !important;
              font-weight: normal;
              font-style: normal;
              font-size: 24px;
              line-height: 1;
              letter-spacing: normal;
              text-transform: none;
              display: inline-block;
              white-space: nowrap;
              word-wrap: normal;
              direction: ltr;
            }
          </style>
        </head>
      `;
      
      // Se o HTML já tem <head>, inserimos antes de fechar. Se não tem, adicionamos no começo.
      let enhancedHtml = html;
      if (html.includes("</head>")) {
        enhancedHtml = html.replace("</head>", criticalHead + "</head>");
      } else {
        enhancedHtml = `<!DOCTYPE html><html>${criticalHead}<body>${html}</body></html>`;
      }

      await page.setContent(enhancedHtml, { waitUntil: "networkidle", timeout: 60000 });
    } else {
      throw new Error("Preciso de URL ou HTML.");
    }

    // Espera explícita para fontes carregarem (vital para ícones)
    try { await page.evaluate(() => document.fonts.ready); } catch(e){}

    const screenshotBuffer = await page.screenshot({ fullPage: false });
    const base64Image = screenshotBuffer.toString("base64");
    
    const imagePart = {
      inlineData: {
        data: base64Image,
        mimeType: "image/png",
      },
    };

    const systemPrompt = `
    You are a Senior UI Engineer.
    
    INPUT: A screenshot of a Dashboard UI and its raw HTML.
    GOAL: Recreate the layout in Figma JSON pixel-perfectly.

    CRITICAL RULES:
    1. **Structure**: 
       - Look at the screenshot. If there is a Sidebar + Main Content, use a Horizontal Root Frame.
       - Sidebar is Fixed Width. Main Content is Fill Container (layoutGrow: 1).
    
    2. **ICONS (Crucial)**: 
       - The design uses "Material Symbols". The HTML might look like text ("dashboard", "home").
       - **DO NOT** render the text "dashboard".
       - **ACTION**: Create a Frame named "Icon" (24x24px Fixed).
       - Leave it empty or put a vector inside if possible. Do NOT make it a giant text block.

    3. **Spacing**:
       - Trust the screenshot for whitespace. Use "itemSpacing" and "padding" to match it.

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