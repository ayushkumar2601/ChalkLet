"use client"

import type React from "react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

export type Tool = "pen" | "eraser" | "rect" | "circle" | "line" | "arrow" | "triangle" | "pan" | "select" | "laser"
export type BrushStyle = "round" | "square" | "dashed"
export type BackgroundType = "plain" | "dotted" | "grid" | "matrix" | "ruled"

type LineItem = {
  tool: "pen"
  points: number[] // world coords: [x,y,x,y,...]
  color: string
  strokeWidth: number
  brushStyle: BrushStyle
}

type RectItem = {
  x: number
  y: number
  width: number
  height: number
  stroke: string
  strokeWidth: number
  dashed?: boolean
}
type CircleItem = { x: number; y: number; radius: number; stroke: string; strokeWidth: number; dashed?: boolean }
type SimpleLineItem = {
  x1: number
  y1: number
  x2: number
  y2: number
  stroke: string
  strokeWidth: number
  dashed?: boolean
}
type ArrowItem = SimpleLineItem
type TriangleItem = {
  x1: number
  y1: number
  x2: number
  y2: number
  x3: number
  y3: number
  stroke: string
  strokeWidth: number
  dashed?: boolean
}

function hexToRgb(hex: string) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim())
  if (!m) return { r: 255, g: 255, b: 255 }
  return { r: Number.parseInt(m[1], 16), g: Number.parseInt(m[2], 16), b: Number.parseInt(m[3], 16) }
}
function luminanceFromHex(hex: string) {
  const { r, g, b } = hexToRgb(hex)
  // simple relative luminance approximation
  const [R, G, B] = [r, g, b].map((v) => v / 255)
  return 0.2126 * R + 0.7152 * G + 0.0722 * B
}
function patternColorFor(bg: string) {
  const L = luminanceFromHex(bg)
  return L > 0.5 ? "rgba(0,0,0,0.12)" : "rgba(255,255,255,0.14)"
}

function bgStyle(type: BackgroundType, bg: string): React.CSSProperties {
  return { backgroundColor: bg }
}

export function WhiteboardCanvas({
  tool,
  color,
  strokeWidth,
  brushStyle,
  background,
  backgroundColor,
}: {
  tool: Tool
  color: string
  strokeWidth: number
  brushStyle: BrushStyle
  background: BackgroundType
  backgroundColor: string
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null)

  // world transform
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const isPanningRef = useRef(false)
  const panLastRef = useRef<{ x: number; y: number } | null>(null)

  // drawing state
  const [lines, setLines] = useState<LineItem[]>([])
  const [rects, setRects] = useState<RectItem[]>([])
  const [circles, setCircles] = useState<CircleItem[]>([])
  const [simpleLines, setSimpleLines] = useState<SimpleLineItem[]>([])
  const [arrows, setArrows] = useState<ArrowItem[]>([])
  const [triangles, setTriangles] = useState<TriangleItem[]>([])
  const [draft, setDraft] = useState<any | null>(null)
  const drawing = useRef(false)
  const erasingPathRef = useRef<number[]>([]) // collect eraser path in world coords
  const laserRef = useRef<Array<{ x: number; y: number; t: number }>>([])

  const [selected, setSelected] = useState<null | {
    kind: "rect" | "circle" | "line" | "arrow" | "triangle"
    idx: number
  }>(null)
  const interactionRef = useRef<null | {
    mode: "moving" | "resizing"
    handle?: number // 0: tl, 1: tr, 2: br, 3: bl
    start: { x: number; y: number }
    original: any
  }>(null)

  // device pixel ratio and resize handling
  const dprRef = useRef(1)

  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return
    const rect = container.getBoundingClientRect()
    const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 3)) // cap for perf
    dprRef.current = dpr
    canvas.width = Math.max(1, Math.floor(rect.width * dpr))
    canvas.height = Math.max(1, Math.floor(rect.height * dpr))
    canvas.style.width = `${Math.floor(rect.width)}px`
    canvas.style.height = `${Math.floor(rect.height)}px`

    const ctx = canvas.getContext("2d")
    if (!ctx) return
    ctxRef.current = ctx
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0) // scale to CSS pixels
  }, [])

  useEffect(() => {
    resizeCanvas()
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resizeCanvas) : null
    if (ro && containerRef.current) ro.observe(containerRef.current)
    return () => {
      if (ro && containerRef.current) ro.unobserve(containerRef.current)
    }
  }, [resizeCanvas])

  const dashed = useMemo(() => (brushStyle === "dashed" ? [12, 8] : ([] as number[])), [brushStyle])
  const lineCap = brushStyle === "square" ? "butt" : "round"
  const lineJoin = brushStyle === "square" ? "miter" : "round"

  // convert client -> canvas css pixels -> world coords
  const getWorldPoint = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = canvasRef.current
      if (!canvas) return { x: 0, y: 0 }
      const rect = canvas.getBoundingClientRect()
      const xCss = clientX - rect.left
      const yCss = clientY - rect.top
      return {
        x: (xCss - offset.x) / scale,
        y: (yCss - offset.y) / scale,
      }
    },
    [offset.x, offset.y, scale],
  )

  // wheel zoom with zoom-to-pointer
  const MIN_SCALE = 0.5
  const MAX_SCALE = 3
  const SCALE_BY = 1.05

  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLCanvasElement>) => {
      e.preventDefault()
      const direction = e.deltaY > 0 ? -1 : 1
      const pointerCss = { x: e.clientX, y: e.clientY }
      const before = getWorldPoint(pointerCss.x, pointerCss.y)

      const raw = direction > 0 ? scale * SCALE_BY : scale / SCALE_BY
      const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, raw))
      setScale(newScale)

      const canvas = canvasRef.current
      if (!canvas) return
      const rect = canvas.getBoundingClientRect()
      const xCss = pointerCss.x - rect.left
      const yCss = pointerCss.y - rect.top

      // keep world point under cursor after zoom
      const newOffset = {
        x: xCss - before.x * newScale,
        y: yCss - before.y * newScale,
      }
      setOffset(newOffset)
    },
    [getWorldPoint, scale],
  )

  type Snapshot = {
    lines: LineItem[]
    rects: RectItem[]
    circles: CircleItem[]
    simpleLines: SimpleLineItem[]
    arrows: ArrowItem[]
    triangles: TriangleItem[]
  }
  const historyRef = useRef<Snapshot[]>([])
  const MAX_HISTORY = 100
  const pushHistory = useCallback(() => {
    // Deep clone minimal shape state so Ctrl+Z can restore precisely
    const snap: Snapshot = {
      lines: JSON.parse(JSON.stringify(lines)),
      rects: JSON.parse(JSON.stringify(rects)),
      circles: JSON.parse(JSON.stringify(circles)),
      simpleLines: JSON.parse(JSON.stringify(simpleLines)),
      arrows: JSON.parse(JSON.stringify(arrows)),
      triangles: JSON.parse(JSON.stringify(triangles)),
    }
    historyRef.current.push(snap)
    if (historyRef.current.length > MAX_HISTORY) {
      historyRef.current.shift()
    }
  }, [lines, rects, circles, simpleLines, arrows, triangles])

  const startDrawing = useCallback(
    (pos: { x: number; y: number }) => {
      if (tool === "pen") {
        const newLine: LineItem = {
          tool: "pen",
          points: [pos.x, pos.y],
          color,
          strokeWidth,
          brushStyle,
        }
        setLines((prev) => [...prev, newLine])
        drawing.current = true
      } else if (tool === "eraser") {
        erasingPathRef.current = [pos.x, pos.y]
        drawing.current = true
      } else if (tool === "rect") {
        setDraft({ type: "rect", x: pos.x, y: pos.y, width: 0, height: 0 })
      } else if (tool === "circle") {
        setDraft({ type: "circle", x: pos.x, y: pos.y, radius: 0 })
      } else if (tool === "line") {
        setDraft({ type: "line", x1: pos.x, y1: pos.y, x2: pos.x, y2: pos.y })
      } else if (tool === "arrow") {
        setDraft({ type: "arrow", x1: pos.x, y1: pos.y, x2: pos.x, y2: pos.y })
      } else if (tool === "triangle") {
        setDraft({ type: "triangle", x1: pos.x, y1: pos.y, x2: pos.x, y2: pos.y, x3: pos.x, y3: pos.y })
      } else if (tool === "laser") {
        const now = performance.now()
        laserRef.current.push({ x: pos.x, y: pos.y, t: now })
        drawing.current = true
      }
    },
    [tool, color, strokeWidth, brushStyle],
  )

  const updateDrawing = useCallback(
    (pos: { x: number; y: number }) => {
      if (tool === "pen") {
        if (!drawing.current) return
        setLines((prev) => {
          const last = prev[prev.length - 1]
          if (!last) return prev
          const updated = { ...last, points: [...last.points, pos.x, pos.y] }
          return [...prev.slice(0, -1), updated]
        })
      } else if (tool === "eraser") {
        // handled in onPointerMove for real-time deletion
      } else if (draft) {
        // existing draft updates
        if (draft.type === "rect") {
          setDraft({ ...draft, width: pos.x - draft.x, height: pos.y - draft.y })
        } else if (draft.type === "circle") {
          const dx = pos.x - draft.x
          const dy = pos.y - draft.y
          const r = Math.sqrt(dx * dx + dy * dy)
          setDraft({ ...draft, radius: r })
        } else if (draft.type === "line" || draft.type === "arrow") {
          setDraft({ ...draft, x2: pos.x, y2: pos.y })
        } else if (draft.type === "triangle") {
          const x1 = draft.x1
          const y1 = draft.y1
          const x2 = pos.x
          const y2 = pos.y
          const x3 = x1 * 2 - x2
          const y3 = y2
          setDraft({ ...draft, x2, y2, x3, y3 })
        }
      }
    },
    [tool, draft],
  )

  const applyEraserDeletion = useCallback((path: number[], threshold: number) => {
    if (path.length < 2) return
    const t = Math.max(2, threshold) // min threshold for reliable hit
    // Filter lines (only pen strokes)
    setLines((prev) => {
      const result: LineItem[] = []
      for (const l of prev) {
        if (l.tool !== "pen") {
          result.push(l)
          continue
        }
        const segments = splitPolylineByEraser(l.points, path, Math.max(t, l.strokeWidth / 2))
        if (segments.length === 0) continue
        for (const seg of segments) {
          result.push({ ...l, points: seg })
        }
      }
      return result
    })

    // Keep shape deletion for now (eraser removes the shape if you touch its border)
    setRects((prev) =>
      prev.filter(
        (r) =>
          !path.some((_, i) => {
            if (i % 2 === 1) return false
            return rectHit(r, path[i], path[i + 1], t)
          }),
      ),
    )
    setCircles((prev) =>
      prev.filter(
        (c) =>
          !path.some((_, i) => {
            if (i % 2 === 1) return false
            return circleHit(c, path[i], path[i + 1], t)
          }),
      ),
    )
    setSimpleLines((prev) =>
      prev.filter(
        (l) =>
          !path.some((_, i) => {
            if (i % 2 === 1) return false
            return lineHit(l, path[i], path[i + 1], Math.max(t, l.strokeWidth / 2))
          }),
      ),
    )
    setArrows((prev) =>
      prev.filter(
        (a) =>
          !path.some((_, i) => {
            if (i % 2 === 1) return false
            return lineHit(a, path[i], path[i + 1], Math.max(t, a.strokeWidth / 2))
          }),
      ),
    )
    setTriangles((prev) =>
      prev.filter(
        (tr) =>
          !path.some((_, i) => {
            if (i % 2 === 1) return false
            return triangleHit(tr, path[i], path[i + 1], t)
          }),
      ),
    )
  }, [])

  const endDrawing = useCallback(() => {
    if (tool === "eraser") {
      erasingPathRef.current = []
      drawing.current = false
      return
    }
    if (tool === "laser") {
      drawing.current = false
      return
    }
    drawing.current = false
    if (!draft) return
    // finalize shapes using current arrays (snapshot was pushed on pointerDown)
    if (draft.type === "rect") {
      setRects([
        ...rects,
        {
          x: draft.x,
          y: draft.y,
          width: draft.width,
          height: draft.height,
          stroke: color,
          strokeWidth,
          dashed: brushStyle === "dashed",
        },
      ])
    } else if (draft.type === "circle") {
      setCircles([
        ...circles,
        { x: draft.x, y: draft.y, radius: draft.radius, stroke: color, strokeWidth, dashed: brushStyle === "dashed" },
      ])
    } else if (draft.type === "line") {
      setSimpleLines([
        ...simpleLines,
        {
          x1: draft.x1,
          y1: draft.y1,
          x2: draft.x2,
          y2: draft.y2,
          stroke: color,
          strokeWidth,
          dashed: brushStyle === "dashed",
        },
      ])
    } else if (draft.type === "arrow") {
      setArrows([
        ...arrows,
        {
          x1: draft.x1,
          y1: draft.y1,
          x2: draft.x2,
          y2: draft.y2,
          stroke: color,
          strokeWidth,
          dashed: brushStyle === "dashed",
        },
      ])
    } else if (draft.type === "triangle") {
      setTriangles([
        ...triangles,
        {
          x1: draft.x1,
          y1: draft.y1,
          x2: draft.x2,
          y2: draft.y2,
          x3: draft.x3,
          y3: draft.y3,
          stroke: color,
          strokeWidth,
          dashed: brushStyle === "dashed",
        },
      ])
    }
    setDraft(null)
  }, [tool, draft, color, strokeWidth, brushStyle, applyEraserDeletion, rects, circles, simpleLines, arrows, triangles])

  const getRectBBox = (r: RectItem) => {
    const x0 = Math.min(r.x, r.x + r.width)
    const y0 = Math.min(r.y, r.y + r.height)
    const x1 = Math.max(r.x, r.x + r.width)
    const y1 = Math.max(r.y, r.y + r.height)
    return { x0, y0, x1, y1 }
  }
  const getCircleBBox = (c: CircleItem) => ({
    x0: c.x - c.radius,
    y0: c.y - c.radius,
    x1: c.x + c.radius,
    y1: c.y + c.radius,
  })
  const getLineBBox = (l: SimpleLineItem) => ({
    x0: Math.min(l.x1, l.x2),
    y0: Math.min(l.y1, l.y2),
    x1: Math.max(l.x1, l.x2),
    y1: Math.max(l.y1, l.y2),
  })
  const getTriBBox = (t: TriangleItem) => ({
    x0: Math.min(t.x1, t.x2, t.x3),
    y0: Math.min(t.y1, t.y2, t.y3),
    x1: Math.max(t.x1, t.x2, t.x3),
    y1: Math.max(t.y1, t.y2, t.y3),
  })

  const getSelectedBBox = useCallback(() => {
    if (!selected) return null
    if (selected.kind === "rect") return getRectBBox(rects[selected.idx])
    if (selected.kind === "circle") return getCircleBBox(circles[selected.idx])
    if (selected.kind === "line") return getLineBBox(simpleLines[selected.idx])
    if (selected.kind === "arrow") return getLineBBox(arrows[selected.idx])
    if (selected.kind === "triangle") return getTriBBox(triangles[selected.idx])
    return null
  }, [selected, rects, circles, simpleLines, arrows, triangles])

  // distance helpers for hit-testing
  function distPointToSeg(px: number, py: number, x1: number, y1: number, x2: number, y2: number) {
    const dx = x2 - x1
    const dy = y2 - y1
    const len2 = dx * dx + dy * dy
    if (len2 === 0) return Math.hypot(px - x1, py - y1)
    let t = ((px - x1) * dx + (py - y1) * dy) / len2
    t = Math.max(0, Math.min(1, t))
    const x = x1 + t * dx
    const y = y1 + t * dy
    return Math.hypot(px - x, py - y)
  }
  function polylineHit(points: number[], px: number, py: number, thresh: number) {
    for (let i = 0; i + 3 < points.length; i += 2) {
      if (distPointToSeg(px, py, points[i], points[i + 1], points[i + 2], points[i + 3]) <= thresh) return true
    }
    return false
  }
  function rectHit(r: RectItem, px: number, py: number, t: number) {
    const { x, y, width, height } = r
    return (
      distPointToSeg(px, py, x, y, x + width, y) <= t ||
      distPointToSeg(px, py, x + width, y, x + width, y + height) <= t ||
      distPointToSeg(px, py, x + width, y + height, x, y + height) <= t ||
      distPointToSeg(px, py, x, y + height, x, y) <= t
    )
  }
  function circleHit(c: CircleItem, px: number, py: number, t: number) {
    const d = Math.hypot(px - c.x, py - c.y)
    return Math.abs(d - c.radius) <= t
  }
  function lineHit(l: SimpleLineItem, px: number, py: number, t: number) {
    return distPointToSeg(px, py, l.x1, l.y1, l.x2, l.y2) <= t
  }
  function triangleHit(tr: TriangleItem, px: number, py: number, t: number) {
    return (
      distPointToSeg(px, py, tr.x1, tr.y1, tr.x2, tr.y2) <= t ||
      distPointToSeg(px, py, tr.x2, tr.y2, tr.x3, tr.y3) <= t ||
      distPointToSeg(px, py, tr.x3, tr.y3, tr.x1, tr.y1) <= t
    )
  }

  const handleUnderPointer = (px: number, py: number) => {
    const bbox = getSelectedBBox()
    if (!bbox) return { hit: false as const }
    const hs = Math.max(6 / scale, 4 / scale)
    const handles = [
      { x: bbox.x0, y: bbox.y0, id: 0 },
      { x: bbox.x1, y: bbox.y0, id: 1 },
      { x: bbox.x1, y: bbox.y1, id: 2 },
      { x: bbox.x0, y: bbox.y1, id: 3 },
    ]
    for (const h of handles) {
      if (px >= h.x - hs && px <= h.x + hs && py >= h.y - hs && py <= h.y + hs) {
        return { hit: true as const, id: h.id }
      }
    }
    return { hit: false as const }
  }

  const shapeUnderPointer = (px: number, py: number) => {
    // check top-most first: freehand lines (last), triangles, arrows, simple lines, circles, rects
    for (let i = lines.length - 1; i >= 0; i--) {
      if (polylineHit(lines[i].points, px, py, Math.max(4 / scale, lines[i].strokeWidth / 2))) {
        // we allow selecting lines for moving, but we won't implement resize for freehand in this pass
        return { kind: "pen" as const, idx: i }
      }
    }
    for (let i = triangles.length - 1; i >= 0; i--)
      if (triangleHit(triangles[i], px, py, 6 / scale)) return { kind: "triangle" as const, idx: i }
    for (let i = arrows.length - 1; i >= 0; i--)
      if (lineHit(arrows[i], px, py, 6 / scale)) return { kind: "arrow" as const, idx: i }
    for (let i = simpleLines.length - 1; i >= 0; i--)
      if (lineHit(simpleLines[i], px, py, 6 / scale)) return { kind: "line" as const, idx: i }
    for (let i = circles.length - 1; i >= 0; i--)
      if (circleHit(circles[i], px, py, 6 / scale)) return { kind: "circle" as const, idx: i }
    for (let i = rects.length - 1; i >= 0; i--)
      if (rectHit(rects[i], px, py, 6 / scale)) return { kind: "rect" as const, idx: i }
    return null
  }

  // render loop
  useEffect(() => {
    let raf = 0
    const render = () => {
      const ctx = ctxRef.current
      const canvas = canvasRef.current
      if (!ctx || !canvas) {
        raf = requestAnimationFrame(render)
        return
      }
      // clear in CSS pixels
      ctx.save()
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.restore()

      // go to world transform (CSS px -> world)
      ctx.save()
      ctx.translate(offset.x, offset.y)
      ctx.scale(scale, scale)

      // ----- background (world space) -----
      const dpr = dprRef.current || 1
      const cssW = canvas.width / dpr
      const cssH = canvas.height / dpr
      const viewW = cssW / scale
      const viewH = cssH / scale
      const minX = -offset.x / scale
      const minY = -offset.y / scale

      // fill page color
      ctx.fillStyle = backgroundColor
      ctx.fillRect(minX, minY, viewW, viewH)

      // draw pattern
      const step = 24 // world units between lines/dots
      const pColor = patternColorFor(backgroundColor)
      const startX = Math.floor(minX / step) * step
      const startY = Math.floor(minY / step) * step
      const endX = minX + viewW + step
      const endY = minY + viewH + step

      if (background === "dotted") {
        ctx.fillStyle = pColor
        const r = 1 // world radius; scales visually with zoom
        for (let x = startX; x < endX; x += step) {
          for (let y = startY; y < endY; y += step) {
            ctx.beginPath()
            ctx.arc(x, y, r, 0, Math.PI * 2)
            ctx.fill()
          }
        }
      } else if (background === "grid") {
        ctx.strokeStyle = pColor
        ctx.lineWidth = 1
        // verticals
        for (let x = startX; x < endX; x += step) {
          ctx.beginPath()
          ctx.moveTo(x, startY)
          ctx.lineTo(x, endY)
          ctx.stroke()
        }
        // horizontals
        for (let y = startY; y < endY; y += step) {
          ctx.beginPath()
          ctx.moveTo(startX, y)
          ctx.lineTo(endX, y)
          ctx.stroke()
        }
      } else if (background === "ruled") {
        ctx.strokeStyle = pColor
        ctx.lineWidth = 1
        for (let y = startY; y < endY; y += step) {
          ctx.beginPath()
          ctx.moveTo(startX, y)
          ctx.lineTo(endX, y)
          ctx.stroke()
        }
      } else if (background === "matrix") {
        // simple diagonal crosshatch (approximate 60deg/-60deg)
        ctx.strokeStyle = pColor
        ctx.lineWidth = 1
        // slope +1
        for (let y = startY - (endX - startX); y < endY + (endX - startX); y += step) {
          ctx.beginPath()
          ctx.moveTo(startX, y)
          ctx.lineTo(endX, y + (endX - startX))
          ctx.stroke()
        }
        // slope -1
        for (let y = startY + (endX - startX); y > startY - (endX - startX); y -= step) {
          ctx.beginPath()
          ctx.moveTo(startX, y)
          ctx.lineTo(endX, y - (endX - startX))
          ctx.stroke()
        }
      }
      // ----- end background -----

      // shapes
      const applyStroke = (stroke: string, width: number, dashedLocal?: boolean) => {
        ctx.strokeStyle = stroke
        ctx.lineWidth = width
        ctx.setLineDash(dashedLocal ? dashed : [])
        ctx.lineCap = lineCap as CanvasLineCap
        ctx.lineJoin = lineJoin as CanvasLineJoin
      }

      // rects
      for (const r of rects) {
        applyStroke(r.stroke, r.strokeWidth, r.dashed)
        ctx.strokeRect(r.x, r.y, r.width, r.height)
      }

      // circles
      for (const c of circles) {
        applyStroke(c.stroke, c.strokeWidth, c.dashed)
        ctx.beginPath()
        ctx.arc(c.x, c.y, c.radius, 0, Math.PI * 2)
        ctx.stroke()
      }

      // simple lines
      for (const l of simpleLines) {
        applyStroke(l.stroke, l.strokeWidth, l.dashed)
        ctx.beginPath()
        ctx.moveTo(l.x1, l.y1)
        ctx.lineTo(l.x2, l.y2)
        ctx.stroke()
      }

      // arrows
      for (const a of arrows) {
        applyStroke(a.stroke, a.strokeWidth, a.dashed)
        // main line
        ctx.beginPath()
        ctx.moveTo(a.x1, a.y1)
        ctx.lineTo(a.x2, a.y2)
        ctx.stroke()
        // arrowhead
        const angle = Math.atan2(a.y2 - a.y1, a.x2 - a.x1)
        const len = 10 + Math.max(0, a.strokeWidth - 2) // scale arrowhead a bit
        const aw = len * 0.6
        ctx.beginPath()
        ctx.moveTo(a.x2, a.y2)
        ctx.lineTo(a.x2 - len * Math.cos(angle - Math.PI / 8), a.y2 - len * Math.sin(angle - Math.PI / 8))
        ctx.lineTo(a.x2 - len * Math.cos(angle + Math.PI / 8), a.y2 - len * Math.sin(angle + Math.PI / 8))
        ctx.lineTo(a.x2, a.y2)
        ctx.closePath()
        ctx.fillStyle = a.stroke
        ctx.fill()
      }

      // triangles
      for (const t of triangles) {
        applyStroke(t.stroke, t.strokeWidth, t.dashed)
        ctx.beginPath()
        ctx.moveTo(t.x1, t.y1)
        ctx.lineTo(t.x2, t.y2)
        ctx.lineTo(t.x3, t.y3)
        ctx.closePath()
        ctx.stroke()
      }

      // freehand lines and eraser
      for (const l of lines) {
        ctx.save()
        ctx.globalCompositeOperation = l.tool === "eraser" ? "destination-out" : "source-over"
        applyStroke(l.tool === "eraser" ? "rgba(0,0,0,1)" : l.color, l.strokeWidth, l.brushStyle === "dashed")
        ctx.beginPath()
        const pts = l.points
        if (pts.length >= 2) {
          ctx.moveTo(pts[0], pts[1])
          for (let i = 2; i < pts.length; i += 2) {
            ctx.lineTo(pts[i], pts[i + 1])
          }
          ctx.stroke()
        }
        ctx.restore()
      }

      // draft (preview)
      if (draft) {
        ctx.save()
        applyStroke(color, strokeWidth, brushStyle === "dashed")
        if (draft.type === "rect") {
          ctx.strokeRect(draft.x, draft.y, draft.width, draft.height)
        } else if (draft.type === "circle") {
          ctx.beginPath()
          ctx.arc(draft.x, draft.y, draft.radius, 0, Math.PI * 2)
          ctx.stroke()
        } else if (draft.type === "line") {
          ctx.beginPath()
          ctx.moveTo(draft.x1, draft.y1)
          ctx.lineTo(draft.x2, draft.y2)
          ctx.stroke()
        } else if (draft.type === "arrow") {
          ctx.beginPath()
          ctx.moveTo(draft.x1, draft.y1)
          ctx.lineTo(draft.x2, draft.y2)
          ctx.stroke()
          const angle = Math.atan2(draft.y2 - draft.y1, draft.x2 - draft.x1)
          const len = 10 + Math.max(0, strokeWidth - 2)
          ctx.beginPath()
          ctx.moveTo(draft.x2, draft.y2)
          ctx.lineTo(draft.x2 - len * Math.cos(angle - Math.PI / 8), draft.y2 - len * Math.sin(angle - Math.PI / 8))
          ctx.lineTo(draft.x2 - len * Math.cos(angle + Math.PI / 8), draft.y2 - len * Math.sin(angle + Math.PI / 8))
          ctx.lineTo(draft.x2, draft.y2)
          ctx.closePath()
          ctx.fillStyle = color
          ctx.fill()
        } else if (draft.type === "triangle") {
          ctx.beginPath()
          ctx.moveTo(draft.x1, draft.y1)
          ctx.lineTo(draft.x2, draft.y2)
          ctx.lineTo(draft.x3, draft.y3)
          ctx.closePath()
          ctx.stroke()
        }
        ctx.restore()
      }

      // selection overlay (in world space)
      if (tool === "select" && selected) {
        const bbox = getSelectedBBox()
        if (bbox) {
          const { x0, y0, x1, y1 } = bbox
          const w = x1 - x0
          const h = y1 - y0
          ctx.save()
          ctx.setLineDash([6, 4])
          ctx.strokeStyle = "#3b82f6"
          ctx.lineWidth = 1 / scale
          ctx.strokeRect(x0, y0, w, h)
          ctx.setLineDash([])

          // draw 4 corner handles with constant screen size
          const hs = Math.max(6 / scale, 4 / scale)
          const handles = [
            { x: x0, y: y0 }, // tl (0)
            { x: x1, y: y0 }, // tr (1)
            { x: x1, y: y1 }, // br (2)
            { x: x0, y: y1 }, // bl (3)
          ]
          ctx.fillStyle = "#3b82f6"
          ctx.strokeStyle = "#ffffff"
          for (const h of handles) {
            ctx.fillRect(h.x - hs / 2, h.y - hs / 2, hs, hs)
            ctx.strokeRect(h.x - hs / 2, h.y - hs / 2, hs, hs)
          }
          ctx.restore()
        }
      }

      // draw eraser radius preview
      if (tool === "eraser" && eraserCursorRef.current) {
        const { x, y } = eraserCursorRef.current
        const r = Math.max(strokeWidth, 6)
        ctx.save()
        ctx.beginPath()
        ctx.arc(x, y, r, 0, Math.PI * 2)
        ctx.strokeStyle = "rgba(239,68,68,0.9)" // red ring
        ctx.lineWidth = 1 / scale
        ctx.stroke()
        // soft margin fill
        ctx.fillStyle = "rgba(239,68,68,0.08)"
        ctx.fill()
        ctx.restore()
      }

      const now = performance.now()
      const ttl = 900 // ms trail lifetime
      const pts = laserRef.current
      // prune old
      if (pts.length) {
        const pruned = pts.filter((p) => now - p.t < ttl)
        if (pruned.length !== pts.length) laserRef.current = pruned
      }
      if (laserRef.current.length > 1) {
        ctx.save()
        // draw in world space with constant-ish screen width
        ctx.lineJoin = "round"
        ctx.lineCap = "round"
        for (let i = 1; i < laserRef.current.length; i++) {
          const p0 = laserRef.current[i - 1]
          const p1 = laserRef.current[i]
          const age = now - p1.t
          const alpha = Math.max(0, 1 - age / ttl)
          ctx.strokeStyle = `rgba(244,63,94,${0.45 * alpha})` // rose-500 glow
          ctx.lineWidth = Math.max(2 / scale, 1 / scale)
          ctx.beginPath()
          ctx.moveTo(p0.x, p0.y)
          ctx.lineTo(p1.x, p1.y)
          ctx.stroke()
        }
        // head dot
        const head = laserRef.current[laserRef.current.length - 1]
        const headAlpha = Math.max(0.2, 0.7)
        ctx.fillStyle = `rgba(244,63,94,${headAlpha})`
        ctx.beginPath()
        ctx.arc(head.x, head.y, Math.max(4 / scale, 2 / scale), 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()
      }

      ctx.restore()
      raf = requestAnimationFrame(render)
    }
    raf = requestAnimationFrame(render)
    return () => cancelAnimationFrame(raf)
  }, [
    arrows,
    circles,
    color,
    dashed,
    draft,
    lineCap,
    lineJoin,
    lines,
    rects,
    scale,
    simpleLines,
    strokeWidth,
    brushStyle,
    offset.x,
    offset.y,
    triangles,
    tool,
    selected,
    getSelectedBBox,
    background,
    backgroundColor,
  ])

  const eraserCursorRef = useRef<null | { x: number; y: number }>(null)

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      e.preventDefault()
      try {
        e.currentTarget.setPointerCapture(e.pointerId)
      } catch {}
      if (tool === "pan") {
        isPanningRef.current = true
        panLastRef.current = { x: e.clientX, y: e.clientY }
        return
      }
      const pos = getWorldPoint(e.clientX, e.clientY)

      if (tool === "select") {
        // selection interactions start — snapshot before change
        const hit = selected ? handleUnderPointer(pos.x, pos.y) : { hit: false as const }
        if (selected && hit.hit) {
          pushHistory()
          interactionRef.current = {
            mode: "resizing",
            handle: hit.id,
            start: pos,
            original:
              selected.kind === "rect"
                ? { ...rects[selected.idx] }
                : selected.kind === "circle"
                  ? { ...circles[selected.idx] }
                  : selected.kind === "line"
                    ? { ...simpleLines[selected.idx] }
                    : selected.kind === "arrow"
                      ? { ...arrows[selected.idx] }
                      : { ...triangles[selected.idx] },
          }
          return
        }
        const hitShape = shapeUnderPointer(pos.x, pos.y)
        if (hitShape && hitShape.kind !== "pen") {
          pushHistory()
          setSelected({ kind: hitShape.kind, idx: hitShape.idx })
          interactionRef.current = {
            mode: "moving",
            start: pos,
            original:
              hitShape.kind === "rect"
                ? { ...rects[hitShape.idx] }
                : hitShape.kind === "circle"
                  ? { ...circles[hitShape.idx] }
                  : hitShape.kind === "line"
                    ? { ...simpleLines[hitShape.idx] }
                    : hitShape.kind === "arrow"
                      ? { ...arrows[hitShape.idx] }
                      : { ...triangles[hitShape.idx] },
          }
          return
        } else {
          setSelected(null)
          interactionRef.current = null
          return
        }
      }

      if (tool !== "laser") {
        // snapshot before start of draw/erase so undo removes this operation
        pushHistory()
      }

      if (tool === "eraser") {
        // start eraser stroke; real-time deletion occurs in move
        erasingPathRef.current = [pos.x, pos.y]
        eraserCursorRef.current = pos
        drawing.current = true
        return
      }

      if (tool === "laser") {
        const now = performance.now()
        laserRef.current.push({ x: pos.x, y: pos.y, t: now })
        drawing.current = true
        return
      }

      startDrawing(pos)
    },
    [getWorldPoint, tool, selected, rects, circles, simpleLines, arrows, triangles, startDrawing, pushHistory],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (tool === "pan" && isPanningRef.current && panLastRef.current) {
        const dx = e.clientX - panLastRef.current.x
        const dy = e.clientY - panLastRef.current.y
        setOffset((prev) => ({ x: prev.x + dx, y: prev.y + dy }))
        panLastRef.current = { x: e.clientX, y: e.clientY }
        return
      }
      const pos = getWorldPoint(e.clientX, e.clientY)
      if (tool === "eraser") {
        eraserCursorRef.current = pos
      }

      const ia = interactionRef.current
      if (tool === "select" && ia && selected) {
        const dx = pos.x - ia.start.x
        const dy = pos.y - ia.start.y

        if (ia.mode === "moving") {
          if (selected.kind === "rect") {
            const o = ia.original as RectItem
            setRects((prev) => {
              const copy = prev.slice()
              copy[selected.idx] = { ...o, x: o.x + dx, y: o.y + dy }
              return copy
            })
          } else if (selected.kind === "circle") {
            const o = ia.original as CircleItem
            setCircles((prev) => {
              const copy = prev.slice()
              copy[selected.idx] = { ...o, x: o.x + dx, y: o.y + dy }
              return copy
            })
          } else if (selected.kind === "line") {
            const o = ia.original as SimpleLineItem
            setSimpleLines((prev) => {
              const copy = prev.slice()
              copy[selected.idx] = { ...o, x1: o.x1 + dx, y1: o.y1 + dy, x2: o.x2 + dx, y2: o.y2 + dy }
              return copy
            })
          } else if (selected.kind === "arrow") {
            const o = ia.original as ArrowItem
            setArrows((prev) => {
              const copy = prev.slice()
              copy[selected.idx] = { ...o, x1: o.x1 + dx, y1: o.y1 + dy, x2: o.x2 + dx, y2: o.y2 + dy }
              return copy
            })
          } else if (selected.kind === "triangle") {
            const o = ia.original as TriangleItem
            setTriangles((prev) => {
              const copy = prev.slice()
              copy[selected.idx] = {
                ...o,
                x1: o.x1 + dx,
                y1: o.y1 + dy,
                x2: o.x2 + dx,
                y2: o.y2 + dy,
                x3: o.x3 + dx,
                y3: o.y3 + dy,
              }
              return copy
            })
          }
          return
        }

        if (ia.mode === "resizing" && ia.handle != null) {
          if (selected.kind === "rect") {
            const o = ia.original as RectItem
            // compute bbox then adjust corners by handle
            let { x0, y0, x1, y1 } = getRectBBox(o)
            if (ia.handle === 0) {
              x0 = Math.min(x1 - 1, x0 + dx)
              y0 = Math.min(y1 - 1, y0 + dy)
            } else if (ia.handle === 1) {
              x1 = Math.max(x0 + 1, x1 + dx)
              y0 = Math.min(y1 - 1, y0 + dy)
            } else if (ia.handle === 2) {
              x1 = Math.max(x0 + 1, x1 + dx)
              y1 = Math.max(y0 + 1, y1 + dy)
            } else if (ia.handle === 3) {
              x0 = Math.min(x1 - 1, x0 + dx)
              y1 = Math.max(y0 + 1, y1 + dy)
            }
            setRects((prev) => {
              const copy = prev.slice()
              copy[selected.idx] = { ...o, x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
              return copy
            })
          } else if (selected.kind === "circle") {
            const o = ia.original as CircleItem
            // adjust radius from center to dragged corner
            const center = { x: o.x, y: o.y }
            const target = { x: pos.x, y: pos.y }
            const r = Math.max(1, Math.hypot(target.x - center.x, target.y - center.y))
            setCircles((prev) => {
              const copy = prev.slice()
              copy[selected.idx] = { ...o, radius: r }
              return copy
            })
          } else if (selected.kind === "line" || selected.kind === "arrow") {
            const o = ia.original as SimpleLineItem
            // handles 0..3 map to endpoints; use nearest endpoint by handle
            let x1 = o.x1,
              y1 = o.y1,
              x2 = o.x2,
              y2 = o.y2
            if (ia.handle === 0 || ia.handle === 3) {
              x1 = o.x1 + dx
              y1 = o.y1 + dy
            } else {
              x2 = o.x2 + dx
              y2 = o.y2 + dy
            }
            const updater = (prev: SimpleLineItem[]) => {
              const copy = prev.slice()
              copy[selected.idx] = { ...o, x1, y1, x2, y2 }
              return copy
            }
            if (selected.kind === "line") setSimpleLines(updater)
            else setArrows(updater as any)
          } else if (selected.kind === "triangle") {
            const o = ia.original as TriangleItem
            // move the nearest corner to the pointer
            const pts = [
              { x: o.x1, y: o.y1, k: "1" as const },
              { x: o.x2, y: o.y2, k: "2" as const },
              { x: o.x3, y: o.y3, k: "3" as const },
            ]
            let idx = 0
            let best = Number.POSITIVE_INFINITY
            pts.forEach((p, i) => {
              const d = Math.hypot(p.x - ia.start.x, p.y - ia.start.y)
              if (d < best) {
                best = d
                idx = i
              }
            })
            const nx = pts[idx].x + dx
            const ny = pts[idx].y + dy
            setTriangles((prev) => {
              const copy = prev.slice()
              if (idx === 0) copy[selected.idx] = { ...o, x1: nx, y1: ny }
              if (idx === 1) copy[selected.idx] = { ...o, x2: nx, y2: ny }
              if (idx === 2) copy[selected.idx] = { ...o, x3: nx, y3: ny }
              return copy
            })
          }
          return
        }
      }

      if (tool === "laser" && drawing.current) {
        const now = performance.now()
        const last = laserRef.current[laserRef.current.length - 1]
        // throttle density: add when moved enough
        if (!last || Math.hypot(pos.x - last.x, pos.y - last.y) > 0.5 / scale) {
          laserRef.current.push({ x: pos.x, y: pos.y, t: now })
          // keep memory in check
          if (laserRef.current.length > 1200) laserRef.current.splice(0, 200)
        }
        return
      }

      if (tool === "eraser" && drawing.current) {
        const ep = erasingPathRef.current
        const lx = ep[ep.length - 2]
        const ly = ep[ep.length - 1]
        if (lx != null && ly != null) {
          const dx = pos.x - lx
          const dy = pos.y - ly
          const dist = Math.hypot(dx, dy)
          // interpolate for smoothness: roughly every (strokeWidth * 0.4)
          const step = Math.max(0.8, strokeWidth * 0.4)
          const steps = Math.max(1, Math.floor(dist / step))
          for (let i = 1; i <= steps; i++) {
            const ix = lx + (dx * i) / steps
            const iy = ly + (dy * i) / steps
            ep.push(ix, iy)
            // apply deletion for the latest tiny segment
            applyEraserDeletion([ep[ep.length - 4], ep[ep.length - 3], ix, iy], strokeWidth)
          }
        } else {
          ep.push(pos.x, pos.y)
        }
        return
      }

      // existing update for drawing or draft
      if (drawing.current || draft) {
        updateDrawing(pos)
      }
    },
    [tool, getWorldPoint, selected, updateDrawing, draft, scale, strokeWidth, applyEraserDeletion],
  )

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (tool === "pan") {
        isPanningRef.current = false
        panLastRef.current = null
        try {
          e.currentTarget.releasePointerCapture(e.pointerId)
        } catch {}
        return
      }
      if (tool === "select") {
        interactionRef.current = null
        return
      }
      if (tool === "laser") {
        drawing.current = false
        try {
          e.currentTarget.releasePointerCapture(e.pointerId)
        } catch {}
        return
      }
      endDrawing()
    },
    [tool, endDrawing],
  )

  const onPointerLeave = useCallback(() => {
    drawing.current = false
    isPanningRef.current = false
    panLastRef.current = null
    interactionRef.current = null // reset selection interaction
    setDraft(null)
  }, [])

  function splitPolylineByEraser(points: number[], path: number[], radius: number): number[][] {
    if (points.length < 4) return [points]
    const keep: boolean[] = []
    for (let i = 0; i < points.length; i += 2) {
      const px = points[i]
      const py = points[i + 1]
      let near = false
      for (let j = 0; j + 1 < path.length; j += 2) {
        const ex = path[j]
        const ey = path[j + 1]
        if (Math.hypot(px - ex, py - ey) <= radius) {
          near = true
          break
        }
      }
      keep.push(!near)
    }
    // Build contiguous segments with at least 2 points (4 numbers)
    const segments: number[][] = []
    let cur: number[] = []
    for (let i = 0; i < keep.length; i++) {
      if (keep[i]) {
        cur.push(points[i * 2], points[i * 2 + 1])
      } else {
        if (cur.length >= 4) segments.push(cur)
        cur = []
      }
    }
    if (cur.length >= 4) segments.push(cur)
    // Ensure each segment starts with a moveable path; if segment has only 2 points, drop it
    return segments.filter((seg) => seg.length >= 4)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isUndo = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z"
      if (!isUndo) return
      e.preventDefault()
      const snap = historyRef.current.pop()
      if (!snap) return
      setLines(snap.lines)
      setRects(snap.rects)
      setCircles(snap.circles)
      setSimpleLines(snap.simpleLines)
      setArrows(snap.arrows)
      setTriangles(snap.triangles)
      setDraft(null)
      setSelected(null)
      interactionRef.current = null
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  return (
    <div ref={containerRef} className="size-full" style={{ backgroundColor, position: "relative" }}>
      <canvas
        ref={canvasRef}
        onWheel={handleWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerLeave}
        style={{
          width: "100%",
          height: "100%",
          touchAction: "none",
          display: "block",
          cursor: tool === "pan" ? "grab" : tool === "select" ? "default" : "crosshair",
        }}
        aria-label="Whiteboard canvas"
      />
    </div>
  )
}
