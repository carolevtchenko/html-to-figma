// ========= Helpers de cor / fonte =========

function hexToRGB(hex) {
  if (!hex) return null
  const match = hex.trim().match(/^#([0-9a-f]{6})$/i)
  if (!match) return null
  const h = match[1]
  const r = parseInt(h.slice(0, 2), 16) / 255
  const g = parseInt(h.slice(2, 4), 16) / 255
  const b = parseInt(h.slice(4, 6), 16) / 255
  return { r: r, g: g, b: b }
}

async function ensureFont(isBold) {
  const style = isBold ? "Bold" : "Regular"
  await figma.loadFontAsync({ family: "Inter", style: style })
}

// ========= Builder a partir do JSON da API =========
//
// Espera um objeto no formato:
//
// {
//   type: "FRAME" | "TEXT",
//   ...
// }

async function buildNodeFromSpec(spec) {
  if (!spec || !spec.type) return null

  // ---- FRAME ----
  if (spec.type === "FRAME") {
    const frame = figma.createFrame()
    frame.name = spec.name || "Frame"

    const layout =
      spec.layout === "HORIZONTAL" || spec.layout === "VERTICAL"
        ? spec.layout
        : "VERTICAL"

    frame.layoutMode = layout
    frame.primaryAxisSizingMode = "AUTO"
    frame.counterAxisSizingMode = "AUTO"

    // Espaçamento entre itens
    if (typeof spec.spacing === "number") {
      frame.itemSpacing = spec.spacing
    }

    // Padding [top, right, bottom, left]
    if (Array.isArray(spec.padding) && spec.padding.length === 4) {
      const p = spec.padding
      frame.paddingTop = p[0]
      frame.paddingRight = p[1]
      frame.paddingBottom = p[2]
      frame.paddingLeft = p[3]
    } else {
      // default
      frame.paddingTop = 16
      frame.paddingRight = 16
      frame.paddingBottom = 16
      frame.paddingLeft = 16
    }

    // Fills (usa só a primeira cor)
    if (Array.isArray(spec.fills) && spec.fills.length > 0) {
      const color = hexToRGB(spec.fills[0])
      if (color) {
        frame.fills = [{ type: "SOLID", color: color }]
      } else {
        frame.fills = []
      }
    } else {
      frame.fills = []
    }

    // Largura fixa, se vier
    if (typeof spec.width === "number") {
      frame.counterAxisSizingMode = "FIXED"
      frame.resizeWithoutConstraints(spec.width, frame.height)
    }

    // Altura fixa, se vier
    if (typeof spec.height === "number") {
      frame.primaryAxisSizingMode = "FIXED"
      const h = spec.height > 0 ? spec.height : frame.height
      frame.resizeWithoutConstraints(frame.width, h)
    }

    // Children
    if (Array.isArray(spec.children)) {
      for (const childSpec of spec.children) {
        const childNode = await buildNodeFromSpec(childSpec)
        if (childNode) frame.appendChild(childNode)
      }
    }

    return frame
  }

  // ---- TEXT ----
  if (spec.type === "TEXT") {
    const text = spec.text || ""
    const fontSize =
      typeof spec.fontSize === "number" && spec.fontSize > 0
        ? spec.fontSize
        : 14
    const isBold = !!spec.bold

    await ensureFont(isBold)

    const node = figma.createText()
    node.name = spec.name || "Text"
    node.characters = text
    node.textAutoResize = "WIDTH_AND_HEIGHT"
    node.fontName = {
      family: "Inter",
      style: isBold ? "Bold" : "Regular",
    }
    node.fontSize = fontSize

    if (spec.color) {
      const color = hexToRGB(spec.color)
      if (color) {
        node.fills = [{ type: "SOLID", color: color }]
      }
    }

    return node
  }

  // Futuro: suportar IMAGES, COMPONENTS etc.
  return null
}

// ========= UI do plugin =========

figma.showUI(__html__, { width: 460, height: 430 })

figma.ui.onmessage = async (msg) => {
  if (msg.type === "convert-via-api") {
    const html = msg.html
    const url = msg.url || ""

    if (!html) {
      figma.notify("Nenhum HTML recebido da UI.")
      return
    }

    try {
      figma.notify("Enviando HTML para a API externa…")

      // 🔹 Troque pela URL real do seu projeto na Vercel:
      const response = await fetch(
        "https://SEU_DOMINIO.vercel.app/api/convert-html",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ html: html, url: url }),
        }
      )

      if (!response.ok) {
        figma.notify("Erro da API (" + response.status + "). Veja o console.")
        const text = await response.text()
        console.error("API error:", text)
        return
      }

      const spec = await response.json()

      const rootNode = await buildNodeFromSpec(spec)
      if (!rootNode) {
        figma.notify("A API retornou um spec vazio ou inválido.")
        return
      }

      figma.currentPage.appendChild(rootNode)
      figma.currentPage.selection = [rootNode]
      figma.viewport.scrollAndZoomIntoView([rootNode])

      figma.notify("Layout criado a partir da API ✨")
    } catch (err) {
      console.error(err)
      figma.notify("Erro chamando a API externa. Veja o console.")
    }
  }
}
