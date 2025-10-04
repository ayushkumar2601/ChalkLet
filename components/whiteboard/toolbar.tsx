
"use client"

import { useMemo, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Paintbrush, Eraser, Move, Square, Circle, Slash, ArrowRight, Triangle, MousePointer } from "lucide-react"
import type { BackgroundType, Tool, BrushStyle } from "./canvas"

const COLORS = [
  "#4b5563", // soft charcoal gray
  "#fca5a5", // pastel rose pink
  "#93c5fd", // pastel blue
  "#6ee7b7", // mint green
  "#fde68a", // soft gold
  "#fdba74", // peach orange
  "#d8b4fe"  // lavender
]

const BG_COLORS = [
  "#fafafa", // light neutral white
  "#1F1F23", // dark pastel gray
  "#fef9c3", // pale yellow
  "#e0f2fe", // light sky blue
  "#fce7f3", // pastel pink
  "#dcfce7"  // minty green
]

export function Toolbar(props: {
  tool: Tool
  onToolChange: (t: Tool) => void
  color: string
  onColorChange: (c: string) => void
  strokeWidth: number
  onStrokeWidthChange: (n: number) => void
  brushStyle: BrushStyle
  onBrushStyleChange: (s: BrushStyle) => void
  background: BackgroundType
  onBackgroundChange: (b: BackgroundType) => void
  backgroundColor: string
  onBackgroundColorChange: (c: string) => void
}) {
  const colorOptions = useMemo(() => COLORS, [])
  const colorPickerRef = useRef<HTMLInputElement>(null)

  return (
    <div className="w-full bg-card text-foreground">
      <div className="mx-auto max-w-screen-2xl px-4 py-2 flex items-center justify-between gap-3">
        {/* TOOL SELECTOR */}
        <div className="flex items-center gap-2">
          <ToggleGroup type="single" value={props.tool} onValueChange={(v) => v && props.onToolChange(v as Tool)}>
            <ToggleGroupItem value="pen" aria-label="Pen">
              <Paintbrush className="size-4" />
            </ToggleGroupItem>
            <ToggleGroupItem value="eraser" aria-label="Eraser">
              <Eraser className="size-4" />
            </ToggleGroupItem>
            <ToggleGroupItem value="pan" aria-label="Pan">
              <Move className="size-4" />
            </ToggleGroupItem>
            <ToggleGroupItem value="rect" aria-label="Rectangle">
              <Square className="size-4" />
            </ToggleGroupItem>
            <ToggleGroupItem value="circle" aria-label="Circle">
              <Circle className="size-4" />
            </ToggleGroupItem>
            <ToggleGroupItem value="line" aria-label="Line">
              <Slash className="size-4" />
            </ToggleGroupItem>
            <ToggleGroupItem value="arrow" aria-label="Arrow">
              <ArrowRight className="size-4" />
            </ToggleGroupItem>
            <ToggleGroupItem value="triangle" aria-label="Triangle">
              <Triangle className="size-4" />
            </ToggleGroupItem>
            <ToggleGroupItem value="select" aria-label="Select">
              <MousePointer className="size-4" />
            </ToggleGroupItem>
            <ToggleGroupItem value="laser" aria-label="Laser Pointer">
              <span className="text-xs font-medium">Laser</span>
            </ToggleGroupItem>
          </ToggleGroup>
        </div>

        {/* OPTIONS */}
        <div className="hidden md:flex items-center gap-3">
          {/* Pen Colors */}
          <div className="flex items-center gap-2">
            {colorOptions.map((c) => (
              <Button
                key={c}
                size="icon"
                variant={props.color === c ? "default" : "outline"}
                onClick={() => props.onColorChange(c)}
                aria-label={`Color ${c}`}
                className="size-6 rounded-full p-0"
                style={{ backgroundColor: c }}
              />
            ))}

            {/* 🎨 Custom Color Picker */}
            <div className="relative mt-1.5">
              <input
                ref={colorPickerRef}
                type="color"
                value={props.color}
                onChange={(e) => props.onColorChange(e.target.value)}
                className="absolute opacity-0 w-0 h-0"
              />
              <Button
                size="icon"
                variant="outline"
                onClick={() => colorPickerRef.current?.click()}
                className="size-6 rounded-full p-0 border-dashed"
                style={{ backgroundColor: props.color }}
                title="Custom color"
              >
                <span className="sr-only">Custom color</span>
              </Button>
            </div>
          </div>

          <Separator orientation="vertical" className="h-6" />

          {/* Stroke Width */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Width</span>
            <div className="w-32">
              <Slider
                value={[props.strokeWidth]}
                min={1}
                max={24}
                step={1}
                onValueChange={(v) => props.onStrokeWidthChange(v[0] ?? props.strokeWidth)}
              />
            </div>
          </div>

          <Separator orientation="vertical" className="h-6" />

          {/* Brush Style */}
          <Select value={props.brushStyle} onValueChange={(v) => props.onBrushStyleChange(v as BrushStyle)}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="Brush style" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="round">Round</SelectItem>
              <SelectItem value="square">Square</SelectItem>
              <SelectItem value="dashed">Dashed</SelectItem>
            </SelectContent>
          </Select>

          <Separator orientation="vertical" className="h-6" />

          {/* Background Type */}
          <Select value={props.background} onValueChange={(v) => props.onBackgroundChange(v as BackgroundType)}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Background" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="plain">Plain</SelectItem>
              <SelectItem value="dotted">Dotted</SelectItem>
              <SelectItem value="grid">Grid</SelectItem>
              <SelectItem value="matrix">Matrix</SelectItem>
              <SelectItem value="ruled">Ruled</SelectItem>
            </SelectContent>
          </Select>

          <Separator orientation="vertical" className="h-6" />

          {/* Background Colors */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Page</span>
            <div className="flex items-center gap-1.5">
              {BG_COLORS.map((c) => (
                <Button
                  key={c}
                  size="icon"
                  variant={props.backgroundColor.toLowerCase() === c.toLowerCase() ? "default" : "outline"}
                  onClick={() => props.onBackgroundColorChange(c)}
                  aria-label={`Background ${c}`}
                  className="size-6 rounded-full p-0"
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
