// Mostra a UI definida em ui.html
figma.showUI(__html__, { width: 520, height: 460 })

// Utilitário: converte "#RRGGBB" para cor do Figma (0–1)
function hexToFigmaColor(hex) {
  if (!hex || typeof hex !== "string") {
    return { r: 1, g: 1, b: 1 }
  }
  const clean = hex.replace("#", "")
  const r = parseInt(clean.slice(0, 2), 16) / 255
  const g = parseInt(clean.slice(2, 4), 16) / 255
  const b = parseInt(clean.slice(4, 6), 16) / 255
  return { r, g, b }
}

// Cria um TextNode a partir do spec vindo da API
function createTextNodeFromSpec(spec) {
  const textNode = figma.createText()

  textNode.name = spec.name || "Text"
  textNode.characters = spec.text || ""

  // Fonte padrão: Inter Regular/Bold
  if (spec.bold) {
    textNode.fontName = { family: "Inter", style: "Bold" }
  } else {
    textNode.fontName = { family: "Inter", style: "Regular" }
  }

  if (typeof spec.fontSize === "number") {
    textNode.fontSize = spec.fontSize
  }

  if (spec.color) {
    textNode.fills = [
      {
        type: "SOLID",
        color: hexToFigmaColor(spec.color),
      },
    ]
  }

  // Deixa o texto ajustar tamanho automaticamente
  textNode.textAutoResize = "WIDTH_AND_HEIGHT"

  return textNode
}

// Cria um Frame com Auto Layout a partir do spec
function createFrameFromSpec(spec) {
  const frame = figma.createFrame()

  frame.name = spec.name || "Frame from HTML"

  // Auto layout
  frame.layoutMode = spec.layout === "HORIZONTAL" ? "HORIZONTAL" : "VERTICAL"
  frame.primaryAxisSizingMode = "AUTO"
  frame.counterAxisSizingMode = "AUTO"
  frame.itemSpacing = typeof spec.spacing === "number" ? spec.spacing : 16

  if (Array.isArray(spec.padding) && spec.padding.length === 4) {
    frame.paddingTop = spec.padding[0]
    frame.paddingRight = spec.padding[1]
    frame.paddingBottom = spec.padding[2]
    frame.paddingLeft = spec.padding[3]
  } else {
    frame.paddingTop = 24
    frame.paddingRight = 24
    frame.paddingBottom = 24
    frame.paddingLeft = 24
  }

  if (Array.isArray(spec.fills) && typeof spec.fills[0] === "string") {
    frame.fills = [
      {
        type: "SOLID",
        color: hexToFigmaColor(spec.fills[0]),
      },
    ]
  } else {
    frame.fills = []
  }

  // Filhos
  if (Array.isArray(spec.children)) {
    spec.children.forEach((childSpec) => {
      let child = null
      if (childSpec.type === "TEXT") {
        child = createTextNodeFromSpec(childSpec)
      } else if (childSpec.type === "FRAME") {
        child = createFrameFromSpec(childSpec)
      }
      if (child) {
        frame.appendChild(child)
      }
    })
  }

  return frame
}

// Constrói tudo a partir do spec da API
async function buildFromSpec(spec) {
  // Garante fontes carregadas ANTES de mexer em characters/fontName
  await Promise.all([
    figma.loadFontAsync({ family: "Inter", style: "Regular" }),
    figma.loadFontAsync({ family: "Inter", style: "Bold" }),
  ])

  const rootFrame = createFrameFromSpec(spec)
  figma.currentPage.appendChild(rootFrame)

  // Centraliza na viewport
  rootFrame.x = figma.viewport.center.x
  rootFrame.y = figma.viewport.center.y
  figma.viewport.scrollAndZoomIntoView([rootFrame])
}

// Recebe mensagem da UI (html + url) e chama a API na Vercel
figma.ui.onmessage = async (msg) => {
  if (msg.type === "convert-via-api") {
    const { html, url } = msg
    // 🔹 PEGA A LARGURA DO FRAME SELECIONADO OU USA 1440
    let viewportWidth = 1440
    const node = figma.currentPage.selection[0]
    if (node && "width" in node) {
      viewportWidth = node.width
    }
    try {
      const response = await fetch(
        "https://html-to-figma-chi.vercel.app/api/convert-html",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            html: msg.html,
            url: msg.url || null,
            body: JSON.stringify({ html, url, viewportWidth }), // <- AGORA VAI

          }),
        }
      )

      if (!response.ok) {
        figma.notify("Erro HTTP da API: " + response.status)
        return
      }

      const spec = await response.json()

      if (!spec || spec.error) {
        figma.notify("Erro na resposta da API.")
        console.error("Spec com erro:", spec)
        return
      }

      await buildFromSpec(spec)
      figma.notify("Layout criado a partir do HTML ✨")
    } catch (err) {
      console.error("Erro no plugin:", err)
      figma.notify("Erro ao chamar a API. Veja o console.")
    }
  } else if (msg.type === "cancel") {
    figma.closePlugin()
  }
}
