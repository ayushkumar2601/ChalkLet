"use client"

import { useState } from "react"
import { Separator } from "@/components/ui/separator"
import { Toolbar } from "./whiteboard/toolbar"
import { WhiteboardCanvas, type BackgroundType, type Tool, type BrushStyle } from "./whiteboard/canvas"
import { ThemeToggle } from "./theme-toggle"

export default function WhiteboardApp() {
  const [tool, setTool] = useState<Tool>("pen")
  const [color, setColor] = useState<string>("#111111")
  const [strokeWidth, setStrokeWidth] = useState<number>(3)
  const [brushStyle, setBrushStyle] = useState<BrushStyle>("round")
  const [background, setBackground] = useState<BackgroundType>("plain")
  const [backgroundColor, setBackgroundColor] = useState<string>("#ffffff") // new

  return (
    <div className="flex flex-col min-h-[100svh]">
      <header className="sticky top-0 z-10 w-full bg-card/80 backdrop-blur supports-[backdrop-filter]:bg-card/60 border-b border-border">
        <div className="mx-auto max-w-screen-2xl px-4 py-2 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/chalklet.png" alt="chalklet logo" className="h-6 w-6 opacity-90" />
            <span className="text-xl font-medium tracking-wide text-foreground">ChalkLet</span>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
          </div>
        </div>
        <Separator />
        <Toolbar
          tool={tool}
          onToolChange={setTool}
          color={color}
          onColorChange={setColor}
          strokeWidth={strokeWidth}
          onStrokeWidthChange={setStrokeWidth}
          brushStyle={brushStyle}
          onBrushStyleChange={setBrushStyle}
          background={background}
          onBackgroundChange={setBackground}
          backgroundColor={backgroundColor}
          onBackgroundColorChange={setBackgroundColor}
        />
      </header>

      <div className="flex-1 min-h-0">
        <WhiteboardCanvas
          tool={tool}
          color={color}
          strokeWidth={strokeWidth}
          brushStyle={brushStyle}
          background={background}
          backgroundColor={backgroundColor}
        />
      </div>
    </div>
  )
}
