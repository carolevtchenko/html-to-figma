// code.js - Decodificador Minificado
figma.showUI(__html__, { width: 400, height: 450 });

function notifyUI(text, state = "loading") {
  figma.ui.postMessage({ type: 'status', text, state });
}

async function loadFonts() {
  await figma.loadFontAsync({ family: "Inter", style: "Regular" });
  await figma.loadFontAsync({ family: "Inter", style: "Medium" });
  await figma.loadFontAsync({ family: "Inter", style: "Bold" });
  await figma.loadFontAsync({ family: "Roboto", style: "Regular" });
  await figma.loadFontAsync({ family: "Roboto", style: "Medium" });
  await figma.loadFontAsync({ family: "Roboto", style: "Bold" });
}

function hexToFigma(hex) {
  if (!hex) return {r:0,g:0,b:0};
  hex = hex.replace('#','');
  return {
    r: parseInt(hex.substring(0,2),16)/255,
    g: parseInt(hex.substring(2,4),16)/255,
    b: parseInt(hex.substring(4,6),16)/255
  };
}

// O Mágico Decodificador das Chaves Curtas
function drawNode(d) {
  if (!d) return null;

  // t: type ("t"=TEXT, "f"=FRAME)
  if (d.t === "t" || d.type === "TEXT") {
    const node = figma.createText();
    node.characters = d.txt || d.text || " ";
    if (d.fs) node.fontSize = d.fs;
    
    if (d.f && d.f[0]) {
      node.fills = [{ type: 'SOLID', color: hexToFigma(d.f[0].c) }];
    }
    
    // Tenta aplicar Roboto
    try { node.fontName = { family: "Roboto", style: "Regular" }; } catch(e) {}
    
    // Alinhamento
    if (d.al === 'c') node.textAlignHorizontal = 'CENTER';
    if (d.al === 'r') node.textAlignHorizontal = 'RIGHT';
    
    return node;
  }

  const node = figma.createFrame();
  node.name = d.n || "Frame";

  // lm: layoutMode ("h", "v")
  if (d.lm === "h") node.layoutMode = "HORIZONTAL";
  else if (d.lm === "v") node.layoutMode = "VERTICAL";
  
  // g: gap
  if (d.g) node.itemSpacing = d.g;
  
  // p: padding [t, r, b, l]
  if (d.p && Array.isArray(d.p)) {
    node.paddingTop = d.p[0];
    node.paddingRight = d.p[1];
    node.paddingBottom = d.p[2];
    node.paddingLeft = d.p[3];
  }

  // lg: layoutGrow
  if (d.lg === 1) node.layoutGrow = 1;

  // Tamanhos fixos se não tiver grow
  if (!d.lg) {
      if (d.w) node.resize(d.w, node.height);
      if (d.h) node.resize(node.width, d.h);
      // Se tiver dimensões fixas e layout, define como FIXED
      if (node.layoutMode !== "NONE") {
          node.primaryAxisSizingMode = "FIXED";
          node.counterAxisSizingMode = "FIXED";
      }
  } else {
      // Se for Grow, ajusta para FILL
      node.primaryAxisSizingMode = "AUTO"; 
      node.layoutGrow = 1;
  }
  
  // f: fills
  if (d.f && d.f.length > 0) {
    node.fills = d.f.map(fill => ({
        type: 'SOLID',
        color: hexToFigma(fill.c),
        opacity: fill.o !== undefined ? fill.o : 1
    }));
  } else {
    node.fills = []; // Transparente
  }

  // s: strokes
  if (d.s && d.s.length > 0) {
    node.strokes = [{ type: 'SOLID', color: hexToFigma(d.s[0].c) }];
  }

  // r: radius
  if (d.r) node.cornerRadius = d.r;

  // ch: children
  if (d.ch && Array.isArray(d.ch)) {
    for (const childData of d.ch) {
      const child = drawNode(childData);
      if (child) {
          node.appendChild(child);
          // Reaplica grow no filho se necessário (Figma API quirk)
          if (childData.lg === 1) child.layoutGrow = 1;
      }
    }
  }

  return node;
}

figma.ui.onmessage = async (msg) => {
  if (msg.type === 'convert-via-api') {
    try {
      notifyUI("Enviando para IA...", "loading");
      
      const res = await fetch("https://html-to-figma-chi.vercel.app/api/convert-html", {
      // const res = await fetch("http://localhost:3000/api/convert-html", { // Use este se rodar local
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ html: msg.html, viewportWidth: 1440 })
      });

      if (!res.ok) throw new Error("Erro na API");
      
      notifyUI("Desenhando...", "loading");
      const spec = await res.json();
      
      await loadFonts();
      const root = drawNode(spec);
      
      if (root) {
          figma.currentPage.appendChild(root);
          figma.viewport.scrollAndZoomIntoView([root]);
          notifyUI("Sucesso!", "success");
      }
    } catch(e) {
      notifyUI("Erro: " + e.message, "error");
    }
  }
}