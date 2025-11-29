// code.js – Com feedback de status em tempo real

figma.showUI(__html__, { width: 400, height: 550 });

// Função auxiliar para mandar status para a UI
function sendStatus(text, state = "loading") {
  figma.ui.postMessage({ type: "update-status", text, state });
}

// Carrega fontes
async function ensureFonts() {
  const fonts = [
    { family: "Inter", style: "Regular" },
    { family: "Inter", style: "Medium" },
    { family: "Inter", style: "Bold" },
  ];
  for (const font of fonts) {
    try { await figma.loadFontAsync(font); } catch (e) {}
  }
}

function hexToFigmaColor(hex) {
  if (!hex) return { r: 1, g: 1, b: 1 };
  let c = hex.replace("#", "").trim();
  if (c.length === 3) c = c[0]+c[0]+c[1]+c[1]+c[2]+c[2];
  const num = parseInt(c, 16);
  return {
    r: ((num >> 16) & 255) / 255,
    g: ((num >> 8) & 255) / 255,
    b: (num & 255) / 255,
  };
}

function createNodeFromSpec(spec) {
  if (!spec || !spec.type) return null;
  let node;

  if (spec.type === "TEXT") {
    node = figma.createText();
    node.name = spec.name || "Text";
    node.characters = spec.text || " ";
    if (spec.fontSize) node.fontSize = spec.fontSize;
    if (spec.fontWeight === "Bold") try { node.fontName = { family: "Inter", style: "Bold" }; } catch(e){}
    else if (spec.fontWeight === "Medium") try { node.fontName = { family: "Inter", style: "Medium" }; } catch(e){}
    
    if (spec.textAlign === "CENTER") node.textAlignHorizontal = "CENTER";
    if (spec.textAlign === "RIGHT") node.textAlignHorizontal = "RIGHT";

    if (spec.fills && spec.fills.length) {
      node.fills = spec.fills.map(f => ({
        type: "SOLID",
        color: hexToFigmaColor(f.color),
        opacity: f.opacity ?? 1
      }));
    }
  } 
  else if (spec.type === "FRAME" || spec.type === "RECTANGLE") {
    node = figma.createFrame();
    node.name = spec.name || "Container";
    
    if (spec.layoutMode && spec.layoutMode !== "NONE") {
      node.layoutMode = spec.layoutMode;
      node.itemSpacing = spec.itemSpacing || 0;
      node.primaryAxisSizingMode = spec.primaryAxisSizingMode === "FIXED" ? "FIXED" : "AUTO";
      node.counterAxisSizingMode = spec.counterAxisSizingMode === "FIXED" ? "FIXED" : "AUTO";
      if (spec.primaryAxisAlignItems) node.primaryAxisAlignItems = spec.primaryAxisAlignItems;
      if (spec.counterAxisAlignItems) node.counterAxisAlignItems = spec.counterAxisAlignItems;
      if (spec.padding) {
        node.paddingTop = spec.padding.top || 0;
        node.paddingRight = spec.padding.right || 0;
        node.paddingBottom = spec.padding.bottom || 0;
        node.paddingLeft = spec.padding.left || 0;
      }
    }

    if (spec.fills && spec.fills.length) {
      node.fills = spec.fills.map(f => ({
        type: "SOLID",
        color: hexToFigmaColor(f.color),
        opacity: f.opacity ?? 1
      }));
    }

    if (spec.strokes && spec.strokes.length) {
      node.strokes = spec.strokes.map(s => ({
        type: "SOLID",
        color: hexToFigmaColor(s.color)
      }));
      if (spec.strokeWeight) node.strokeWeight = spec.strokeWeight;
    }

    if (spec.cornerRadius) node.cornerRadius = spec.cornerRadius;

    if (spec.effects && spec.effects.length) {
        const validEffects = [];
        for (const e of spec.effects) {
            if (e.type === "DROP_SHADOW") {
                const c = hexToFigmaColor(e.color || "#000000");
                validEffects.push({
                    type: "DROP_SHADOW",
                    color: { r: c.r, g: c.g, b: c.b, a: 0.25 },
                    offset: e.offset || { x: 0, y: 4 },
                    radius: e.radius || 4,
                    visible: true,
                    blendMode: "NORMAL"
                });
            }
        }
        if (validEffects.length) node.effects = validEffects;
    }

    if (spec.children && Array.isArray(spec.children)) {
      for (const childSpec of spec.children) {
        const childNode = createNodeFromSpec(childSpec);
        if (childNode) node.appendChild(childNode);
      }
    }
  }
  return node;
}

figma.ui.onmessage = async (msg) => {
  if (msg.type !== "convert-via-api") return;

  const { html, url } = msg;
  let viewportWidth = 1440;
  if (figma.currentPage.selection.length > 0) {
     const s = figma.currentPage.selection[0];
     if(s.width) viewportWidth = Math.floor(s.width);
  }

  try {
    // 1. Feedback inicial
    sendStatus("Conectando à IA... (Aguarde ~30s)", "loading");

    const apiUrl = "https://html-to-figma-chi.vercel.app/api/convert-html"; 
    
    const res = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ html, url, viewportWidth }),
    });

    if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || "Erro HTTP " + res.status);
    }

    // 2. Feedback de processamento
    sendStatus("IA respondeu! Construindo elementos no Figma...", "loading");

    const spec = await res.json();
    await ensureFonts();
    const rootNode = createNodeFromSpec(spec);

    if (rootNode) {
      if(rootNode.type === "FRAME") rootNode.resizeWithoutConstraints(viewportWidth, rootNode.height);
      figma.currentPage.appendChild(rootNode);
      figma.currentPage.selection = [rootNode];
      figma.viewport.scrollAndZoomIntoView([rootNode]);
      
      // 3. Sucesso final
      sendStatus("Pronto! Layout gerado com sucesso.", "success");
      figma.notify("Layout gerado! 🎉");
    } else {
      throw new Error("JSON inválido retornado pela IA.");
    }

  } catch (err) {
    console.error(err);
    sendStatus("Erro: " + err.message, "error");
    figma.notify("Falha na conversão ❌");
  }
};