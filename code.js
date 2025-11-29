// code.js – versão JS pura com construção recursiva dos nodes

figma.showUI(__html__, { width: 480, height: 420 })

async function ensureFonts() {
  try {
    await figma.loadFontAsync({ family: "Inter", style: "Regular" })
  } catch (e) {
    console.log("Não foi possível carregar Inter Regular, usando fonte padrão.", e)
  }

  try {
    await figma.loadFontAsync({ family: "Inter", style: "Medium" })
  } catch (e) {
    console.log("Não foi possível carregar Inter Medium, usando fonte padrão.", e)
  }
}

function hexToFigmaColor(hex) {
  if (!hex) hex = "#FFFFFF"
  let c = hex.replace("#", "")
  if (c.length === 3) {
    c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2]
  }
  const num = parseInt(c, 16)
  const r = ((num >> 16) & 255) / 255
  const g = ((num >> 8) & 255) / 255
  const b = (num & 255) / 255
  return { r, g, b }
}

// Cria um node a partir de um spec (FRAME, TEXT, etc), recursivamente
function createNodeFromSpec(spec) {
  if (!spec || !spec.type) return null

  if (spec.type === "TEXT") {
    const textNode = figma.createText()
    textNode.name = spec.name || "Text"
    textNode.characters = spec.text || ""
    if (spec.fontSize) textNode.fontSize = spec.fontSize
    textNode.fills = [
      {
        type: "SOLID",
        color: hexToFigmaColor(spec.color || "#000000"),
      },
    ]

    if (spec.bold) {
      try {
        textNode.fontName = { family: "Inter", style: "Medium" }
      } catch (e) {
        console.log("Erro ao aplicar fonte Medium, mantendo fonte padrão.", e)
      }
    }

    return textNode
  }

  if (spec.type === "FRAME") {
    const frame = figma.createFrame()
    frame.name = spec.name || "Frame"

    // auto layout
    frame.layoutMode = spec.layout === "HORIZONTAL" ? "HORIZONTAL" : "VERTICAL"
    frame.primaryAxisSizingMode = "AUTO"
    frame.counterAxisSizingMode = "AUTO"

    if (spec.spacing != null) frame.itemSpacing = spec.spacing

    const padding = Array.isArray(spec.padding) ? spec.padding : [24, 24, 24, 24]
    frame.paddingTop = padding[0]
    frame.paddingRight = padding[1]
    frame.paddingBottom = padding[2]
    frame.paddingLeft = padding[3]

    const fillHex =
      Array.isArray(spec.fills) && spec.fills.length > 0 ? spec.fills[0] : "#FFFFFF"
    frame.fills = [
      {
        type: "SOLID",
        color: hexToFigmaColor(fillHex),
      },
    ]

    if (Array.isArray(spec.children)) {
      for (const childSpec of spec.children) {
        const childNode = createNodeFromSpec(childSpec)
        if (childNode) {
          frame.appendChild(childNode)
        }
      }
    }

    return frame
  }

  // se vier outro tipo que ainda não tratamos, ignora
  return null
}

async function createFigmaNodesFromSpec(spec, viewportWidth) {
  await ensureFonts()

  // cria a árvore completa
  const rootNode = createNodeFromSpec(spec)
  if (!rootNode) {
    figma.notify("Spec vazio ou tipo não suportado.")
    return
  }

  // se o root for frame, ajusta largura com o viewport
  if (rootNode.type === "FRAME") {
    const width = typeof viewportWidth === "number" ? viewportWidth : 1440
    rootNode.resizeWithoutConstraints(width, rootNode.height)
  }

  figma.currentPage.appendChild(rootNode)
  figma.currentPage.selection = [rootNode]
  figma.viewport.scrollAndZoomIntoView([rootNode])
}

figma.ui.onmessage = async (msg) => {
  if (msg.type !== "convert-via-api") return

  const html = msg.html || ""
  const url = msg.url || ""

  // tenta usar a largura do frame selecionado como viewport
  let viewportWidth = 1440
  const selection = figma.currentPage.selection[0]
  if (selection && "width" in selection) {
    viewportWidth = selection.width
  }

  try {
    const res = await fetch("https://html-to-figma-chi.vercel.app/api/convert-html", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ html, url, viewportWidth }),
    })

    if (!res.ok) {
      throw new Error("HTTP " + res.status + " ao chamar API")
    }

    const spec = await res.json()
    console.log("Spec recebido da API:", spec)
    await createFigmaNodesFromSpec(spec, viewportWidth)
    figma.notify("Layout gerado a partir do HTML 🎉")
  } catch (err) {
    console.error("Erro no plugin:", err)
    figma.notify("Erro ao converter HTML. Veja o console do Figma.")
  }
}
