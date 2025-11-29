// code.js – Versão JS pura (Corrigida: Sem spread operator que causava erro)

figma.showUI(__html__, { width: 480, height: 420 });

// Carrega fontes comuns para evitar erros
async function ensureFonts() {
  const fonts = [
    { family: "Inter", style: "Regular" },
    { family: "Inter", style: "Medium" },
    { family: "Inter", style: "Bold" },
  ];
  for (const font of fonts) {
    try {
      await figma.loadFontAsync(font);
    } catch (e) {
      console.log("Erro ao carregar fonte:", font, e);
    }
  }
}

// Converte Hex (#RRGGBB) para formato Figma {r, g, b}
function hexToFigmaColor(hex) {
  if (!hex) return { r: 1, g: 1, b: 1 };
  let c = hex.replace("#", "").trim();
  if (c.length === 3) {
    c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2];
  }
  const num = parseInt(c, 16);
  return {
    r: ((num >> 16) & 255) / 255,
    g: ((num >> 8) & 255) / 255,
    b: (num & 255) / 255,
  };
}

// Cria nós recursivamente com suporte a propriedades avançadas
function createNodeFromSpec(spec) {
  if (!spec || !spec.type) return null;

  let node;

  // --- TIPO: TEXTO ---
  if (spec.type === "TEXT") {
    node = figma.createText();
    node.name = spec.name || "Text";
    node.characters = spec.text || " ";
    
    if (spec.fontSize) node.fontSize = spec.fontSize;
    
    // Peso da fonte
    if (spec.fontWeight === "Bold") {
      try { node.fontName = { family: "Inter", style: "Bold" }; } catch(e){}
    } else if (spec.fontWeight === "Medium") {
      try { node.fontName = { family: "Inter", style: "Medium" }; } catch(e){}
    }

    // Alinhamento
    if (spec.textAlign === "CENTER") node.textAlignHorizontal = "CENTER";
    if (spec.textAlign === "RIGHT") node.textAlignHorizontal = "RIGHT";
    
    // Cor do texto
    if (spec.fills && spec.fills.length > 0) {
      node.fills = spec.fills.map(f => ({
        type: "SOLID",
        color: hexToFigmaColor(f.color || "#000000"),
        opacity: f.opacity != null ? f.opacity : 1
      }));
    }
  } 
  
  // --- TIPO: FRAME ou RECTANGLE ---
  else if (spec.type === "FRAME" || spec.type === "RECTANGLE") {
    node = figma.createFrame(); 
    node.name = spec.name || "Container";

    // Layout Mode (Auto Layout)
    if (spec.layoutMode && spec.layoutMode !== "NONE") {
      node.layoutMode = spec.layoutMode;
      node.itemSpacing = spec.itemSpacing || 0;
      node.primaryAxisSizingMode = spec.primaryAxisSizingMode === "FIXED" ? "FIXED" : "AUTO";
      node.counterAxisSizingMode = spec.counterAxisSizingMode === "FIXED" ? "FIXED" : "AUTO";
      
      // Alinhamento
      if (spec.primaryAxisAlignItems) node.primaryAxisAlignItems = spec.primaryAxisAlignItems;
      if (spec.counterAxisAlignItems) node.counterAxisAlignItems = spec.counterAxisAlignItems;

      // Padding
      if (spec.padding) {
        node.paddingTop = spec.padding.top || 0;
        node.paddingRight = spec.padding.right || 0;
        node.paddingBottom = spec.padding.bottom || 0;
        node.paddingLeft = spec.padding.left || 0;
      }
    }

    // --- ESTILIZAÇÃO VISUAL ---

    // 1. Fills (Fundo)
    if (spec.fills && spec.fills.length > 0) {
      node.fills = spec.fills.map(f => ({
        type: "SOLID",
        color: hexToFigmaColor(f.color || "#FFFFFF"),
        opacity: f.opacity != null ? f.opacity : 1
      }));
    }

    // 2. Strokes (Bordas)
    if (spec.strokes && spec.strokes.length > 0) {
      node.strokes = spec.strokes.map(s => ({
        type: "SOLID",
        color: hexToFigmaColor(s.color || "#000000")
      }));
      if (spec.strokeWeight) node.strokeWeight = spec.strokeWeight;
    }

    // 3. Corner Radius (Arredondamento)
    if (spec.cornerRadius) node.cornerRadius = spec.cornerRadius;

    // 4. Effects (Sombras) - CORRIGIDO AQUI
    if (spec.effects && spec.effects.length > 0) {
      const validEffects = [];
      
      for (let i = 0; i < spec.effects.length; i++) {
        const e = spec.effects[i];
        if (e.type === "DROP_SHADOW") {
          const baseColor = hexToFigmaColor(e.color || "#000000");
          validEffects.push({
            type: "DROP_SHADOW",
            // Correção: atribuição manual sem usar '...'
            color: { r: baseColor.r, g: baseColor.g, b: baseColor.b, a: 0.25 },
            offset: e.offset || { x: 0, y: 4 },
            radius: e.radius || 4,
            spread: e.spread || 0,
            visible: true,
            blendMode: "NORMAL"
          });
        }
      }
      
      if (validEffects.length > 0) {
        node.effects = validEffects;
      }
    }

    // Recursão: Adicionar filhos
    if (spec.children && Array.isArray(spec.children)) {
      for (const childSpec of spec.children) {
        const childNode = createNodeFromSpec(childSpec);
        if (childNode) {
          node.appendChild(childNode);
        }
      }
    }
  }

  return node;
}

// Função Principal
figma.ui.onmessage = async (msg) => {
  if (msg.type !== "convert-via-api") return;

  const html = msg.html || "";
  const url = msg.url || "";
  
  let viewportWidth = 1440;
  if (figma.currentPage.selection.length > 0) {
    const sel = figma.currentPage.selection[0];
    if (sel.width) viewportWidth = Math.floor(sel.width);
  }

  try {
    figma.notify("Enviando para a IA (pode levar alguns segundos)... ⏳");

    // Certifique-se que esta URL é a do seu backend atual
    const apiUrl = "https://html-to-figma-chi.vercel.app/api/convert-html"; 
    
    const res = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ html, url, viewportWidth }),
    });

    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      throw new Error(errJson.error || "Erro na API: " + res.status);
    }

    const spec = await res.json();
    console.log("Spec recebido:", spec);

    await ensureFonts();
    
    const rootNode = createNodeFromSpec(spec);
    
    if (rootNode) {
        if(rootNode.type === "FRAME") {
            rootNode.resizeWithoutConstraints(viewportWidth, rootNode.height);
        }
        
        figma.currentPage.appendChild(rootNode);
        figma.currentPage.selection = [rootNode];
        figma.viewport.scrollAndZoomIntoView([rootNode]);
        figma.notify("Layout gerado com sucesso! 🎉");
    } else {
        figma.notify("A IA não retornou um layout válido.");
    }

  } catch (err) {
    console.error("Erro no plugin:", err);
    figma.notify("Erro: " + err.message);
  }
};