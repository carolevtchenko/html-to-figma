// No arquivo code.js, substitua a função createNodeFromSpec inteira por esta:

function createNodeFromSpec(spec) {
  if (!spec || !spec.type) return null;
  let node;

  if (spec.type === "TEXT") {
    node = figma.createText();
    node.name = spec.name || "Text";
    node.characters = spec.text || " ";
    if (spec.fontSize) node.fontSize = spec.fontSize;
    
    if (spec.fontWeight === "Bold") {
        try { node.fontName = { family: "Inter", style: "Bold" }; } catch(e){}
    } else if (spec.fontWeight === "Medium") {
        try { node.fontName = { family: "Inter", style: "Medium" }; } catch(e){}
    }
    
    if (spec.textAlign === "CENTER") node.textAlignHorizontal = "CENTER";
    if (spec.textAlign === "RIGHT") node.textAlignHorizontal = "RIGHT";

    if (spec.fills && spec.fills.length) {
      node.fills = spec.fills.map(function(f) {
        return {
          type: "SOLID",
          color: hexToFigmaColor(f.color),
          opacity: (f.opacity !== undefined) ? f.opacity : 1
        };
      });
    }
  } 
  else if (spec.type === "FRAME" || spec.type === "RECTANGLE") {
    node = figma.createFrame();
    node.name = spec.name || "Container";
    
    if (spec.layoutMode && spec.layoutMode !== "NONE") {
      node.layoutMode = spec.layoutMode;
      node.itemSpacing = spec.itemSpacing || 0;
      node.primaryAxisSizingMode = (spec.primaryAxisSizingMode === "FIXED") ? "FIXED" : "AUTO";
      node.counterAxisSizingMode = (spec.counterAxisSizingMode === "FIXED") ? "FIXED" : "AUTO";
      
      if (spec.primaryAxisAlignItems) node.primaryAxisAlignItems = spec.primaryAxisAlignItems;
      if (spec.counterAxisAlignItems) node.counterAxisAlignItems = spec.counterAxisAlignItems;
      
      if (spec.padding) {
        node.paddingTop = spec.padding.top || 0;
        node.paddingRight = spec.padding.right || 0;
        node.paddingBottom = spec.padding.bottom || 0;
        node.paddingLeft = spec.padding.left || 0;
      }
    }

    // --- NOVA FUNCIONALIDADE: FILL CONTAINER ---
    // Isso impede que o layout fique achatado
    if (spec.layoutGrow === 1) {
        node.layoutGrow = 1; 
    }
    // ------------------------------------------

    if (spec.fills && spec.fills.length) {
      node.fills = spec.fills.map(function(f) {
        return {
          type: "SOLID",
          color: hexToFigmaColor(f.color),
          opacity: (f.opacity !== undefined) ? f.opacity : 1
        };
      });
    }

    if (spec.strokes && spec.strokes.length) {
      node.strokes = spec.strokes.map(function(s) {
        return { type: "SOLID", color: hexToFigmaColor(s.color) };
      });
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