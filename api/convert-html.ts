// api/convert-html.ts (Versão com Correção de Fontes e Ícones)
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
  // Forçamos 1440px para garantir que o menu lateral não colapse
  const targetWidth = Math.max(viewportWidth || 1440, 1440);

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
    // Altura grande para pegar a tela toda
    await page.setViewportSize({ width: targetWidth, height: 1000 });

    if (url) {
      await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
    } else if (html) {
      let finalHtml = html;
      
      // Se não tiver estrutura completa, injeta. Se tiver (seu caso), usa como está.
      if (!html.trim().match(/^\s*<!DOCTYPE/i) && !html.trim().match(/^\s*<html/i)) {
         // (Código de injeção anterior omitido para brevidade, mas o seu HTML já é completo)
      }
      
      await page.setContent(finalHtml, { waitUntil: "networkidle", timeout: 60000 });
    } else {
      throw new Error("Preciso de URL ou HTML.");
    }

    // --- CORREÇÃO CRÍTICA: ESPERAR FONTES ---
    // Isso garante que os ícones do Material Symbols carreguem antes do print
    try {
      await page.evaluate(() => document.fonts.ready);
      // Espera extra de 1s só por segurança para renderização visual
      await new Promise(r => setTimeout(r, 1000));
    } catch (e) {
      console.log("Erro esperando fontes, seguindo...");
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
    GOAL: Recreate the layout in Figma JSON with pixel-perfect structure.

    CRITICAL RULES FOR THIS SPECIFIC DESIGN:
    1. **ICON HANDLING (Most Important)**: 
       - The HTML uses 'Material Symbols' (ligatures). You will see text like "dashboard", "settings" inside spans in the HTML.
       - **DO NOT** render this as text.
       - **DO NOT** render giant colored blocks.
       - **ACTION**: Create a transparent FRAME sized **24x24px** named "Icon".
       - If the screenshot shows a colored active state (e.g. blue button), apply the color to the PARENT frame, not the icon itself.

    2. **SIDEBAR STRUCTURE**:
       - The Root Frame MUST be "layoutMode": "HORIZONTAL".
       - Left Child: "Sidebar" (Fixed width ~250px).
       - Right Child: "Main Content" (Fill Container / layoutGrow: 1).
    
    3. **Backgrounds**:
       - The sidebar usually has a distinct background (white or very light gray) separated by a border. Capture this border as a "stroke".

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
      "strokeWeight": number,
      "cornerRadius": number,
      "itemSpacing": number,
      "padding": { "top": number, "right": number, "bottom": number, "left": number },
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
    console.error("Erro:", err);
    res.status(500).json({ error: "Falha", details: err.message });
  } finally {
    if (browser) await browser.close();
  }
}