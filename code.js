// Main script do plugin Figma
// Responsável por:
// - Mostrar a UI (ui.html)
// - Receber o HTML enviado pela UI
// - Chamar a API na Vercel
// - Criar o layout no canvas a partir do JSON retornado

const API_ENDPOINT = "https://html-to-figma-chi.vercel.app/api/convert-html";

// Abre a UI embutida (__html__ vem do ui.html)
figma.showUI(__html__, {
  width: 520,
  height: 480,
});

// Controle simples para não carregar fonte toda hora
let fontsLoaded = false;
async function ensureFonts() {
  if (fontsLoaded) return;
  // Usa Roboto Regular, que é padrão do Figma
  await figma.loadFontAsync({ family: "Roboto", style: "Regular" });
  fontsLoaded = true;
}

// Converte "#RRGGBB" em Paint do Figma
function hexToSolidPaint(hex) {
  if (!hex || typeof hex !== "string") {
    return {
      type: "SOLID",
      color: { r: 1, g: 1, b: 1 },
    };
  }

  const cleaned = hex.replace("#", "").trim();
  if (cleaned.length !== 6) {
    return {
      type: "SOLID",
      color: { r: 1, g: 1, b: 1 },
    };
  }

  const r = parseInt(cleaned.slice(0, 2), 16) / 255;
  const g = parseInt(cleaned.slice(2, 4), 16) / 255;
  const b = parseInt(cleaned.slice(4, 6), 16) / 255;

  return {
    type: "SOLID",
    color: { r, g, b },
  };
}

// Cria um TEXT node a partir do spec
async function createTextNodeFromSpec(spec) {
  await ensureFonts();

  const node = figma.createText();
  node.name = spec.name || "Text";
  node.characters = spec.text || "";

  if (typeof spec.fontSize === "number") {
    node.fontSize = spec.fontSize;
  }
  if (spec.bold) {
    try {
      await figma.loadFontAsync({ family: "Roboto", style: "Bold" });
      node.fontName = { family: "Roboto", style: "Bold" };
    } catch (e) {
      // se não achar Bold, ignora e fica Regular
    }
  }

  if (spec.color) {
    node.fills = [hexToSolidPaint(spec.color)];
  }

  return node;
}

// Cria um FRAME (com children recursivos) a partir do spec
async function createFrameFromSpec(spec) {
  const frame = figma.createFrame();

  frame.name = spec.name || "Converted Layout";

  // Auto Layout
  const layout = spec.layout === "HORIZONTAL" ? "HORIZONTAL" : "VERTICAL";
  frame.layoutMode = layout;
  frame.counterAxisSizingMode = "AUTO";
  frame.primaryAxisSizingMode = "AUTO";

  if (typeof spec.spacing === "number") {
    frame.itemSpacing = spec.spacing;
  } else {
    frame.itemSpacing = 16;
  }

  const padding = Array.isArray(spec.padding) && spec.padding.length === 4
    ? spec.padding
    : [40, 40, 40, 40];

  frame.paddingTop = padding[0];
  frame.paddingRight = padding[1];
  frame.paddingBottom = padding[2];
  frame.paddingLeft = padding[3];

  if (Array.isArray(spec.fills) && spec.fills.length > 0) {
    frame.fills = [hexToSolidPaint(spec.fills[0])];
  } else {
    frame.fills = [hexToSolidPaint("#FFFFFF")];
  }

  // Children
  if (Array.isArray(spec.children)) {
    for (const child of spec.children) {
      if (!child || typeof child !== "object") continue;

      let childNode = null;

      if (child.type === "TEXT") {
        childNode = await createTextNodeFromSpec(child);
      } else if (child.type === "FRAME") {
        childNode = await createFrameFromSpec(child);
      }

      if (childNode) {
        childNode.x = 0;
        childNode.y = 0;
        frame.appendChild(childNode);
      }
    }
  }

  return frame;
}

// Handler das mensagens vindas da UI
figma.ui.onmessage = async (msg) => {
  if (msg.type !== "convert-via-api") return;

  const html = (msg.html || "").trim();
  const url = (msg.url || "").trim();

  if (!html) {
    figma.notify("Nenhum HTML recebido da UI.");
    return;
  }

  try {
    figma.notify("Enviando HTML para a API…");

    const res = await fetch(API_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ html, url }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error("API error:", res.status, text);
      figma.notify("Erro na API (" + res.status + "). Veja o console.");
      return;
    }

    const spec = await res.json();

    if (!spec || spec.type !== "FRAME") {
      console.error("Spec inesperado da API:", spec);
      figma.notify("Resposta da API não está no formato esperado.");
      return;
    }

    const rootFrame = await createFrameFromSpec(spec);

    // Centraliza na viewport
    const vp = figma.viewport;
    rootFrame.x = vp.center.x - rootFrame.width / 2;
    rootFrame.y = vp.center.y - rootFrame.height / 2;

    figma.currentPage.selection = [rootFrame];
    figma.viewport.scrollAndZoomIntoView([rootFrame]);

    figma.notify("Layout criado a partir do HTML!");
  } catch (err) {
    console.error("Erro no plugin:", err);
    figma.notify("Erro ao converter HTML. Veja o console do plugin.");
  }
};
