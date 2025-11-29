// code.ts – Figma plugin main

// Mostra a UI do ui.html
figma.showUI(__html__, {
  width: 520,
  height: 420,
})

// Tipos da especificação vinda da API
type TextSpec = {
  type: "TEXT"
  name?: string
  text: string
  fontSize?: number
  bold?: boolean
  color?: string
}

type FrameSpec = {
  type: "FRAME"
  name?: string
  layout?: "VERTICAL" | "HORIZONTAL"
  spacing?: number
  padding?: [number, number, number, number]
  fills?: string[]
  children?: NodeSpec[]
}

type NodeSpec = TextSpec | FrameSpec

// Converte "#RRGGBB" em Paint do Figma
function hexToPaint(hex: string): Paint {
  if (!hex) {
    return {
      type: "SOLID",
      color: { r: 1, g: 1, b: 1 },
    }
  }

  if (hex.startsWith("#")) hex = hex.slice(1)
  if (hex.length === 3) {
    hex = hex
      .split("")
      .map((c) => c + c)
      .join("")
  }

  const num = parseInt(hex, 16)
  const r = ((num >> 16) & 255) / 255
  const g = ((num >> 8) & 255) / 255
  const b = (num & 255) / 255

  return {
    type: "SOLID",
    color: { r, g, b },
  }
}

// Cria node Figma a partir de um spec
function createNodeFromSpec(spec: NodeSpec): SceneNode {
  if (spec.type === "TEXT") {
    const t = figma.createText()
    t.name = spec.name || "Text"
    t.fontName = {
      family: "Inter",
      style: spec.bold ? "Bold" : "Regular",
    }
    if (spec.fontSize) {
      t.fontSize = spec.fontSize
    }
    t.characters = spec.text || ""
    t.fills = [hexToPaint(spec.color || "#000000")]
    return t
  }

  if (spec.type === "FRAME") {
    const f = figma.createFrame()
    f.name = spec.name || "Frame"

    // Auto Layout
    f.layoutMode = spec.layout === "HORIZONTAL" ? "HORIZONTAL" : "VERTICAL"
    f.itemSpacing = spec.spacing ?? 16

    const [pt, pr, pb, pl] = spec.padding ?? [24, 24, 24, 24]
    f.paddingTop = pt
    f.paddingRight = pr
    f.paddingBottom = pb
    f.paddingLeft = pl

    if (spec.fills && spec.fills.length > 0) {
      f.fills = spec.fills.map(hexToPaint)
    } else {
      f.fills = [hexToPaint("#FFFFFF")]
    }

    if (Array.isArray(spec.children)) {
      for (const child of spec.children) {
        const node = createNodeFromSpec(child)
        f.appendChild(node)
      }
    }

    // tamanho deixa o Auto Layout cuidar – nada de resize(100,100)
    return f
  }

  // fallback
  const fallback = figma.createFrame()
  fallback.name = "Unsupported"
  return fallback
}

// Escuta mensagens da UI
figma.ui.onmessage = async (msg) => {
  if (msg.type !== "convert-via-api") return

  const { html, url } = msg

  try {
    figma.ui.postMessage({
      type: "status",
      message: "Chamando API…",
    })

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
      console.error("Erro na API:", res.status, text)
      figma.ui.postMessage({
        type: "error",
        message: `API retornou ${res.status}`,
      })
      return
    }

    const spec: FrameSpec = await res.json()
    console.log("Spec recebido da API:", spec)

    // 🔹 carrega fontes antes de criar qualquer TEXT
    await figma.loadFontAsync({ family: "Inter", style: "Regular" })
    await figma.loadFontAsync({ family: "Inter", style: "Bold" })

    const rootNode = createNodeFromSpec(spec)

    figma.currentPage.appendChild(rootNode)
    figma.currentPage.selection = [rootNode]
    figma.viewport.scrollAndZoomIntoView([rootNode])

    figma.ui.postMessage({
      type: "status",
      message: "Layout criado no canvas ✅",
    })
  } catch (err) {
    console.error("Erro no plugin:", err)
    figma.ui.postMessage({
      type: "error",
      message: String(err),
    })
  }
}
