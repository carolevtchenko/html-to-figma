// code.js – versão em JavaScript puro, sem "type", sem TS

// Abre a interface do plugin
figma.showUI(__html__, { width: 480, height: 420 })

// Garante que as fontes necessárias estejam carregadas antes de escrever texto
async function ensureFonts() {
  try {
    await figma.loadFontAsync({ family: "Inter", style: "Regular" })
  } catch (e) {
    // se não tiver Inter, deixa a fonte padrão
    console.log("Não foi possível carregar Inter Regular, usando fonte padrão.", e)
  }

  try {
    await figma.loadFontAsync({ family: "Inter", style: "Medium" })
  } catch (e) {
    console.log("Não foi possível carregar Inter Medium, usando fonte padrão.", e)
  }
}

// Converte #RRGGBB para cores do Figma (0–1)
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

// Cria os nodes no Figma a partir do JSON que vem da API
async function createFigmaNodesFromSpec(spec, viewportWidth) {
  await ensureFonts()

  // Frame raiz
  const frame = figma.createFrame()
  frame.name = spec.name || "Generated Layout"

  // Usa a largura do frame selecionado, ou um fallback
  const width = typeof viewportWidth === "number" ? viewportWidth : 1440
  frame.resizeWithoutConstraints(width, 800)

  // Auto layout vertical/horizontal
  frame.layoutMode = spec.layout === "HORIZONTAL" ? "HORIZONTAL" : "VERTICAL"
  frame.primaryAxisSizingMode = "AUTO"
  frame.counterAxisSizingMode = "AUTO"
  frame.itemSpacing = spec.spacing != null ? spec.spacing : 16

  const padding = Array.isArray(spec.padding) ? spec.padding : [24, 24, 24, 24]
  frame.paddingTop = padding[0]
  frame.paddingRight = padding[1]
  frame.paddingBottom = padding[2]
  frame.paddingLeft = padding[3]

  const fillHex = Array.isArray(spec.fills) && spec.fills.length > 0 ? spec.fills[0] : "#FFFFFF"
  frame.fills = [
    {
      type: "SOLID",
      color: hexToFigmaColor(fillHex),
    },
  ]

  // Cria filhos (por enquanto só TEXT, que é o que a API já manda)
  if (Array.isArray(spec.children)) {
    for (const child of spec.children) {
      if (child.type === "TEXT") {
        const textNode = figma.createText()
        textNode.name = child.name || "Text"
        textNode.characters = child.text || ""
        textNode.fontSize = child.fontSize || 16
        textNode.fills = [
          {
            type: "SOLID",
            color: hexToFigmaColor(child.color || "#000000"),
          },
        ]

        if (child.bold) {
          try {
            textNode.fontName = { family: "Inter", style: "Medium" }
          } catch (e) {
            console.log("Erro ao aplicar fonte Medium, mantendo fonte padrão.", e)
          }
        }

        frame.appendChild(textNode)
      }
      // aqui depois dá pra ir adicionando suporte a outros tipos (FRAME dentro de FRAME, BUTTON etc)
    }
  }

  figma.currentPage.selection = [frame]
  figma.viewport.scrollAndZoomIntoView([frame])
}

// Recebe mensagens da UI
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
    await createFigmaNodesFromSpec(spec, viewportWidth)
    figma.notify("Layout gerado a partir do HTML 🎉")
  } catch (err) {
    console.error("Erro no plugin:", err)
    figma.notify("Erro ao converter HTML. Veja o console do Figma.")
  }
}
