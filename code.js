// code.ts – Figma Plugin

// Abre a UI
figma.showUI(__html__, { width: 480, height: 520 })

// Tipos básicos (ajusta se você já tem algo mais completo)
type TextSpec = {
  type: "TEXT"
  name: string
  text: string
  fontSize: number
  bold: boolean
  color: string
}

type FrameSpec = {
  type: "FRAME"
  name: string
  layout: "VERTICAL" | "HORIZONTAL"
  spacing: number
  padding: [number, number, number, number]
  fills: string[]
  children: Array<FrameSpec | TextSpec>
}

// Converte "#RRGGBB" em Paint do Figma
function colorFromHex(hex: string): Paint {
  const clean = hex.replace("#", "")
  const r = parseInt(clean.slice(0, 2), 16) / 255
  const g = parseInt(clean.slice(2, 4), 16) / 255
  const b = parseInt(clean.slice(4, 6), 16) / 255
  return {
    type: "SOLID",
    color: { r, g, b },
  }
}

// Cria TEXT a partir do spec
async function createTextNodeFromSpec(spec: TextSpec, parent: FrameNode) {
  await figma.loadFontAsync({ family: "Inter", style: "Regular" }).catch(() =>
    figma.loadFontAsync({ family: "Roboto", style: "Regular" })
  )

  const text = figma.createText()
  text.name = spec.name
  text.characters = spec.text

  text.fontSize = spec.fontSize
  text.fontName = {
    family: "Inter",
    style: spec.bold ? "Bold" : "Regular",
  }

  text.fills = [colorFromHex(spec.color)]
  parent.appendChild(text)
}

// Cria FRAME a partir do spec (recursivo)
async function createFrameFromSpec(spec: FrameSpec, parent: FrameNode | PageNode) {
  const frame = figma.createFrame()
  frame.name = spec.name
  frame.layoutMode = spec.layout === "VERTICAL" ? "VERTICAL" : "HORIZONTAL"
  frame.itemSpacing = spec.spacing
  frame.paddingTop = spec.padding[0]
  frame.paddingRight = spec.padding[1]
  frame.paddingBottom = spec.padding[2]
  frame.paddingLeft = spec.padding[3]
  frame.counterAxisSizingMode = "AUTO"
  frame.primaryAxisSizingMode = "AUTO"

  if (spec.fills && spec.fills.length > 0) {
    frame.fills = [colorFromHex(spec.fills[0])]
  } else {
    frame.fills = []
  }

  parent.appendChild(frame)

  for (const child of spec.children || []) {
    if (child.type === "FRAME") {
      await createFrameFromSpec(child as FrameSpec, frame)
    } else if (child.type === "TEXT") {
      await createTextNodeFromSpec(child as TextSpec, frame)
    }
  }

  return frame
}

// 📩 Handler de mensagens vindas da UI
figma.ui.onmessage = async (msg) => {
  if (msg.type !== "convert-via-api") return

  const { html, url } = msg

  // 🔹 AQUI entra o viewportWidth
  let viewportWidth = 1440
  const node = figma.currentPage.selection[0]
  if (node && "width" in node) {
    viewportWidth = node.width
  }

  try {
    const res = await fetch(
      "https://html-to-figma-chi.vercel.app/api/convert-html",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ html, url, viewportWidth }),
      }
    )

    if (!res.ok) {
      const text = await res.text()
      console.error("Erro da API:", res.status, text)
      figma.notify("API retornou erro: " + res.status)
      return
    }

    const spec = (await res.json()) as FrameSpec

    const page = figma.currentPage
    const frame = await createFrameFromSpec(spec, page)

    // usa viewportWidth para largura do frame raiz
    frame.resizeWithoutConstraints(viewportWidth, frame.height)

    figma.viewport.scrollAndZoomIntoView([frame])
    figma.notify("Layout criado a partir do HTML ✨")
  } catch (err) {
    console.error("Erro no plugin:", err)
    figma.notify("Falha ao chamar API. Veja o console.")
  }
}
