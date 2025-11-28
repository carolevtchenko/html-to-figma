// code.js – HTML Page → Figma Auto Layout (API)

// Mostra a UI definida em ui.html
figma.showUI(__html__, { width: 480, height: 520 })

// Ouve mensagens vindas da UI
figma.ui.onmessage = async (msg) => {
  if (msg.type === "convert-via-api") {
    const { html, url } = msg

    try {
      const spec = await callBackend(html, url)
      console.log("Spec recebido da API:", spec)

      const rootNode = await createNodeFromSpec(spec)
      if (rootNode) {
        figma.currentPage.selection = [rootNode]
        figma.viewport.scrollAndZoomIntoView([rootNode])
        figma.notify("Layout criado a partir do HTML ✨")
      } else {
        figma.notify("A API não retornou um layout válido.")
      }
    } catch (err) {
      console.error("Erro no plugin:", err)
      figma.notify("Erro ao criar layout. Veja o console para detalhes.")
    }
  }
}

// Chama a API na Vercel
async function callBackend(html, url) {
  const res = await fetch(
    "https://html-to-figma-chi.vercel.app/api/convert-html",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ html, url }),
    }
  )

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`API error ${res.status}: ${text}`)
  }

  return await res.json()
}

// Cria a árvore de nós a partir do spec raiz
async function createNodeFromSpec(spec) {
  if (!spec || !spec.type) return null
  return await createNodeRecursive(spec)
}

// Recursivo: FRAME / TEXT
async function createNodeRecursive(spec) {
  if (spec.type === "FRAME") {
    const frame = figma.createFrame()
    frame.name = spec.name || "Frame"

    // Auto Layout
    frame.layoutMode = spec.layout === "HORIZONTAL" ? "HORIZONTAL" : "VERTICAL"
    frame.primaryAxisSizingMode = "AUTO"
    frame.counterAxisSizingMode = "AUTO"
    frame.itemSpacing = typeof spec.spacing === "number" ? spec.spacing : 16

    const padding = Array.isArray(spec.padding)
      ? spec.padding
      : [16, 16, 16, 16]
    frame.paddingTop = padding[0]
    frame.paddingRight = padding[1]
    frame.paddingBottom = padding[2]
    frame.paddingLeft = padding[3]

    if (Array.isArray(spec.fills) && spec.fills.length > 0) {
      frame.fills = [
        {
          type: "SOLID",
          color: hexToRgb(spec.fills[0]),
        },
      ]
    } else {
      frame.fills = [
        {
          type: "SOLID",
          color: { r: 1, g: 1, b: 1 },
        },
      ]
    }

    // Posição inicial mais ou menos no centro da viewport
    frame.x = figma.viewport.center.x
    frame.y = figma.viewport.center.y

    if (Array.isArray(spec.children)) {
      for (const childSpec of spec.children) {
        const child = await createNodeRecursive(childSpec)
        if (child) frame.appendChild(child)
      }
    }

    return frame
  }

  if (spec.type === "TEXT") {
    // 🔹 FIX PRINCIPAL: carregar a fonte ANTES de mexer em characters
    const regularFont = { family: "Inter", style: "Regular" }

    // Se você preferir SF Pro Text, troque aqui por:
    // const regularFont = { family: "SF Pro Text", style: "Regular" }
    await figma.loadFontAsync(regularFont)

    const text = figma.createText()
    text.name = spec.name || "Text"
    text.fontName = regularFont

    if (typeof spec.fontSize === "number") {
      text.fontSize = spec.fontSize
    }

    // Só depois de carregar a fonte e setar fontName
    text.characters = spec.text || ""

    if (spec.color) {
      text.fills = [
        {
          type: "SOLID",
          color: hexToRgb(spec.color),
        },
      ]
    }

    // Se o spec marcar como bold, tenta usar Inter Bold
    if (spec.bold) {
      try {
        const boldFont = { family: "Inter", style: "Bold" }
        await figma.loadFontAsync(boldFont)
        text.fontName = boldFont
      } catch (err) {
        console.warn(
          "Não foi possível carregar Inter Bold, mantendo Regular.",
          err
        )
      }
    }

    return text
  }

  // Outros tipos não são tratados
  return null
}

// Converte "#RRGGBB" para { r, g, b } no intervalo 0–1
function hexToRgb(hex) {
  if (!hex || typeof hex !== "string") {
    return { r: 1, g: 1, b: 1 }
  }

  let clean = hex.replace("#", "")
  if (clean.length === 3) {
    clean = clean
      .split("")
      .map((c) => c + c)
      .join("")
  }

  const r = parseInt(clean.slice(0, 2), 16) / 255
  const g = parseInt(clean.slice(2, 4), 16) / 255
  const b = parseInt(clean.slice(4, 6), 16) / 255

  return { r, g, b }
}
