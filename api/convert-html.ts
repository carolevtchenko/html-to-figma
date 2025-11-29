// api/convert-html.ts (Versão Jato: Sem Playwright, Só Texto)
import { GoogleGenerativeAI } from "@google/generative-ai";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default async function handler(req: any, res: any) {
  // Configura CORS
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

  const { html, viewportWidth } = req.body || {};
  const targetWidth = viewportWidth || 1440;

  if (!html) {
    res.status(400).json({ error: "HTML is required." });
    return;
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    
    // Vamos usar o Gemini 2.0 Flash (Experimental) se disponível, ou o 1.5 Flash.
    // Eles são MUITO mais rápidos que o 3.0 Pro e funcionam bem com muito texto.
    // Se der erro de modelo não encontrado, troque para "gemini-1.5-flash"
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });

    const systemPrompt = `
    You are an expert Figma Developer.
    
    INPUT: Raw HTML with INLINE STYLES (Frozen CSS).
    GOAL: Create a Figma Auto Layout JSON based strictly on the inline styles provided.

    INSTRUCTIONS:
    1. **Analyze Styles**: Read the 'style="..."' attributes. 
       - If 'display: flex' and 'flex-direction: row' -> "layoutMode": "HORIZONTAL".
       - If 'display: flex' and 'flex-direction: column' -> "layoutMode": "VERTICAL".
       - If 'background-color' is present -> add to "fills".
       - If 'color' is present -> use it for Text fills.
       - If 'width' is fixed (e.g., '250px') -> use it. If 'flex-grow' or 'width: 100%' -> use "layoutGrow": 1.

    2. **Handling Icons**: 
       - Since you cannot see images, look for elements with 'data-is-icon="true"' OR small fixed dimensions (e.g. width:24px; height:24px).
       - Create a FRAME 24x24px for them. Do NOT create text nodes for icon names like "dashboard".

    3. **Structure**:
       - Recreate the DOM tree hierarchy exactly as frames/text nodes.
       - Ignore <script>, <head>, <meta>. Focus on <body> content.

    JSON STRUCTURE:
    {
      "type": "FRAME" | "TEXT",
      "name": "string",
      "layoutMode": "VERTICAL" | "HORIZONTAL" | "NONE",
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

    // Envia apenas o texto (Prompt + HTML Gigante)
    // O Gemini Flash tem uma janela de contexto enorme (1M tokens), ele aguenta o HTML tranquilo.
    const result = await model.generateContent([systemPrompt, html]);
    const response = result.response;
    let text = response.text().trim();
    text = text.replace(/```json/gi, "").replace(/```/g, "").trim();

    const spec = JSON.parse(text);
    res.status(200).json(spec);

  } catch (err: any) {
    console.error("Erro:", err);
    res.status(500).json({ error: "Falha na conversão", details: err.message });
  }
}