// code.js - Versão Robusta com Feedback
figma.showUI(__html__, { width: 400, height: 450 });

// Função para avisar a UI sobre o progresso
function notifyUI(text, state = "loading") {
  figma.ui.postMessage({ type: 'status', text, state });
}

// Carregamento de Fontes Seguro (Não trava se uma falhar)
async function loadFontsSafe() {
  const fontsToLoad = [
    { family: "Inter", style: "Regular" },
    { family: "Inter", style: "Medium" },
    { family: "Inter", style: "Bold" },
    { family: "Roboto", style: "Regular" },
    { family: "Roboto", style: "Medium" },
    { family: "Roboto", style: "Bold" }
  ];

  for (const font of fontsToLoad) {
    try {
      await figma.loadFontAsync(font);
    } catch (e) {
      console.warn(`Fonte não disponível: ${font.family} ${font.style}. Ignorando.`);
    }
  }
}

// Conversor de Hex
function hexToFigma(hexStr) {
  if (!hexStr || typeof hexStr !== 'string') return { r: 0.8, g: 0.8, b: 0.8 }; // Cinza padrão se falhar
  const hex = hexStr.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16) / 255;
  const g = parseInt(hex.substring(2, 4), 16) / 255;
  const b = parseInt(hex.substring(4, 6), 16) / 255;
  return { r, g, b };
}

// Função Principal de Desenho
function drawNode(data) {
  if (!data) return null;

  // --- TIPO: TEXTO ---
  if (data.type === "TEXT") {
    const textNode = figma.createText();
    textNode.characters = data.content || " ";
    return textNode;
  }

  // --- TIPO: ÍCONE ---
  if (data.type === "ICON") {
    const frame = figma.createFrame();
    frame.name = "Icon";
    frame.resize(24, 24);
    
    // Fundo transparente
    frame.fills = [];
    
    // Quadrado placeholder para ver onde está o ícone
    const rect = figma.createRectangle();
    rect.resize(24, 24);
    rect.cornerRadius = 4;
    
    // Tenta aplicar cor se disponível
    if (data.styles && data.styles.color && data.styles.color.hex) {
       rect.fills = [{ type: 'SOLID', color: hexToFigma(data.styles.color.hex) }];
    } else {
       rect.fills = [{ type: 'SOLID', color: {r:0.5, g:0.5, b:0.5} }]; // Cinza se não tiver cor
    }
    
    frame.appendChild(rect);
    return frame;
  }

  // --- TIPO: FRAME ---
  const frame = figma.createFrame();
  const s = data.styles;
  frame.name = data.tag || "Frame";

  // Aplica Layout
  if (s.display === 'flex') {
    frame.layoutMode = (s.flexDirection && s.flexDirection.includes('row')) ? 'HORIZONTAL' : 'VERTICAL';
    
    frame.itemSpacing = s.gap || 0;
    frame.paddingTop = s.padding?.t || 0;
    frame.paddingRight = s.padding?.r || 0;
    frame.paddingBottom = s.padding?.b || 0;
    frame.paddingLeft = s.padding?.l || 0;

    // Alinhamento
    if (s.alignItems === 'center') frame.counterAxisAlignItems = 'CENTER';
    else if (s.alignItems === 'flex-end') frame.counterAxisAlignItems = 'MAX';
    else if (s.alignItems === 'flex-start') frame.counterAxisAlignItems = 'MIN';

    if (s.justifyContent === 'center') frame.primaryAxisAlignItems = 'CENTER';
    else if (s.justifyContent === 'space-between') frame.primaryAxisAlignItems = 'SPACE_BETWEEN';
    else if (s.justifyContent === 'flex-end') frame.primaryAxisAlignItems = 'MAX';
    
    frame.primaryAxisSizingMode = 'AUTO';
    frame.counterAxisSizingMode = 'AUTO';
  } else {
    // Tamanho fixo se não for flex
    const w = s.width > 0 ? s.width : 100;
    const h = s.height > 0 ? s.height : 100;
    frame.resize(w, h);
  }

  // Cor de Fundo
  if (s.bgColor && s.bgColor.hex) {
    frame.fills = [{ 
        type: 'SOLID', 
        color: hexToFigma(s.bgColor.hex), 
        opacity: s.bgColor.alpha !== undefined ? s.bgColor.alpha : 1 
    }];
  } else {
    frame.fills = []; // Transparente
  }

  // Borda / Radius
  if (s.borderRadius) frame.cornerRadius = s.borderRadius;

  // Filhos Recursivos
  if (data.children && Array.isArray(data.children)) {
    for (const childData of data.children) {
      // Tratamento especial para texto dentro de frame
      if (childData.type === "TEXT") {
        const tNode = figma.createText();
        tNode.characters = childData.content;
        
        if (s.fontSize) tNode.fontSize = s.fontSize;
        
        // Cor do texto
        if (s.color && s.color.hex) {
            tNode.fills = [{ type: 'SOLID', color: hexToFigma(s.color.hex) }];
        }
        
        // Font Weight simplificado
        let style = "Regular";
        const w = String(s.fontWeight);
        if (w === "700" || w === "bold") style = "Bold";
        if (w === "500" || w === "600") style = "Medium";
        
        // Tenta carregar fonte fallback se a principal falhar (já carregada no início)
        try { 
            tNode.fontName = { family: "Roboto", style: style }; 
        } catch(e) {
            try { tNode.fontName = { family: "Inter", style: style }; } catch(e2) {}
        }
        
        frame.appendChild(tNode);
      } 
      else {
        // Recursão normal
        const childNode = drawNode(childData);
        if (childNode) frame.appendChild(childNode);
      }
    }
  }

  return frame;
}

// Escuta evento da UI
figma.ui.onmessage = async (msg) => {
  if (msg.type === 'draw-layout') {
    try {
      notifyUI("Carregando fontes...", "loading");
      await loadFontsSafe();

      notifyUI("Desenhando elementos...", "loading");
      
      // Pequeno delay para a UI atualizar antes de travar no processamento
      setTimeout(() => {
          try {
              const root = drawNode(msg.data);
              
              if (root) {
                figma.currentPage.appendChild(root);
                figma.viewport.scrollAndZoomIntoView([root]);
                notifyUI("Sucesso! Layout desenhado.", "success");
                figma.notify("Layout finalizado! 🎉");
              } else {
                notifyUI("Erro: JSON vazio ou inválido.", "error");
              }
          } catch (drawError) {
              console.error(drawError);
              notifyUI("Erro ao desenhar: " + drawError.message, "error");
          }
      }, 100);

    } catch (e) {
      console.error(e);
      notifyUI("Erro fatal: " + e.message, "error");
    }
  }
};