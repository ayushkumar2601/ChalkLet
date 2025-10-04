import WhiteboardApp from "@/components/whiteboard-app"

export const dynamic = "force-static"

export default function Page() {
  return (
    <main className="min-h-[100svh] flex flex-col bg-background text-foreground">
      <WhiteboardApp />
    </main>
  )
}
