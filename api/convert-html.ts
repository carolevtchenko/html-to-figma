// api/convert-html.ts (Versão Otimizada para HTML Congelado)
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
  
  if (!html) {
    res.status(400).json({ error: "HTML is required." });
    return;
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    
    // 1. Usamos o gemini-1.5-flash que é rápido e aceita contextos gigantes
    // Adicionamos responseMimeType para garantir que a saída seja JSON válido
    const model = genAI.getGenerativeModel({ 
      model: "gemini-2.0-flash-exp",
      generationConfig: {
        responseMimeType: "application/json"
      }
    });

    const systemPrompt = `
    You are an expert Figma Developer.
    
    INPUT: HTML with INLINE STYLES (Frozen CSS).
    GOAL: Create a Figma Auto Layout JSON based strictly on the inline styles.

    CRITICAL RULES TO PREVENT ERRORS:
    1. **Simplify Deep Nesting**: If a <div> is just a wrapper with no visible style (no background, no border), SKIP IT. Process its children directly. This saves output space.
    2. **Handling Icons**: Look for 'data-is-icon="true"' or small fixed sizes (24px). Make them 24x24 frames.
    3. **Output JSON ONLY**: Do not write any markdown code blocks.

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
    `;

    const result = await model.generateContent([systemPrompt, html]);
    const response = result.response;
    let text = response.text().trim();
    
    // Tratamento de erro caso o JSON venha truncado (cortado no final)
    // Tenta encontrar o último fechamento válido se parecer quebrado
    try {
        JSON.parse(text); // Teste rápido
    } catch (e) {
        console.log("JSON parece quebrado ou cortado. Tentando reparar...");
        // Se falhar, é porque cortou. Vamos tentar fechar na marra os objetos e arrays abertos.
        // (Solução simples: achar o último '}' válido)
        const lastBrace = text.lastIndexOf('}');
        if (lastBrace > 0) {
            text = text.substring(0, lastBrace + 1);
        }
    }

    const spec = JSON.parse(text);
    res.status(200).json(spec);

  } catch (err: any) {
    console.error("Erro Fatal:", err);
    // Retorna o erro exato para vermos no log se acontecer de novo
    res.status(500).json({ 
        error: "Falha na conversão (Provavelmente JSON muito grande)", 
        details: err.message 
    });
  }
}