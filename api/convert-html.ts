// api/convert-html.ts (Versão Minificada Definitiva)
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
  for (const [key, value] of Object.entries(CORS_HEADERS)) res.setHeader(key, value);
  if (req.method === "OPTIONS") return res.status(200).end();

  const { html, viewportWidth } = req.body || {};
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "No API Key" });
  if (!html) return res.status(400).json({ error: "No HTML" });

  let browser = null;
  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    // Gemini 1.5 Flash é o mais estável para JSONs grandes
    const model = genAI.getGenerativeModel({ 
        model: "gemini-1.5-flash",
        generationConfig: { responseMimeType: "application/json" }
    });

    const executablePath = await chromium.executablePath();
    browser = await playwrightCore.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: executablePath,
      headless: chromium.headless,
    });

    const page = await browser.newPage();
    await page.setViewportSize({ width: viewportWidth || 1440, height: 1200 });

    // 1. Injeção de Dependências (Garante que o design fique igual ao original)
    let finalHtml = html;
    if (!html.includes("cdn.tailwindcss.com")) {
        const headInjection = `
          <script src="https://cdn.tailwindcss.com"></script>
          <link href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap" rel="stylesheet">
          <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined" rel="stylesheet"/>
          <style>
            body { font-family: 'Roboto', sans-serif; }
            .material-symbols-outlined { font-family: 'Material Symbols Outlined' !important; font-size: 24px; }
          </style>
        `;
        finalHtml = html.includes("<head>") 
            ? html.replace("<head>", `<head>${headInjection}`) 
            : `<!DOCTYPE html><html><head>${headInjection}</head><body>${html}</body></html>`;
    }

    await page.setContent(finalHtml, { waitUntil: "networkidle", timeout: 60000 });
    
    // Espera fontes para ícones não quebrarem
    try { await page.evaluate(() => document.fonts.ready); } catch(e){}

    const screenshotBuffer = await page.screenshot({ fullPage: false });
    const base64Image = screenshotBuffer.toString("base64");

    // 2. Prompt com Protocolo de Minificação (Reduz tokens em 60%)
    const prompt = `
    Role: Figma Layout Engine.
    Input: Screenshot + HTML.
    Task: Recreate exact layout using Auto Layout.
    
    OUTPUT FORMAT (MINIFIED JSON):
    Use these exact short keys to save space:
    - "t": type ("f"=FRAME, "t"=TEXT, "r"=RECTANGLE)
    - "n": name
    - "lm": layoutMode ("h"=HORIZONTAL, "v"=VERTICAL, "n"=NONE)
    - "lg": layoutGrow (1 or 0)
    - "w": width, "h": height
    - "f": fills array [{ "c": "#HEX", "o": opacity }]
    - "s": strokes array [{ "c": "#HEX" }]
    - "r": cornerRadius
    - "p": padding [top, right, bottom, left]
    - "g": itemSpacing (gap)
    - "txt": characters (for text)
    - "fs": fontSize
    - "al": textAlign ("l", "c", "r")
    - "ch": children array

    RULES:
    1. **Sidebar**: If sidebar detected, Root Frame must be "lm":"h". Sidebar fixed width, Content "lg":1.
    2. **Icons**: If you see an icon (Material Symbol), output: { "t": "f", "n": "Icon", "w": 24, "h": 24, "ch": [] }. DO NOT put text inside.
    3. **Fidelity**: Match colors and spacing from screenshot.

    Return ONLY the JSON.
    `;

    const result = await model.generateContent([
        { inlineData: { data: base64Image, mimeType: "image/png" } }, 
        prompt
    ]);
    
    const responseText = result.response.text();
    const spec = JSON.parse(responseText);
    res.status(200).json(spec);

  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message });
  } finally {
    if (browser) await browser.close();
  }
}