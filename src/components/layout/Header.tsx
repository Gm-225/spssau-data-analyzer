import { useState } from "react"
import { store } from "@/lib/store"
import { useAppState } from "@/hooks/useAppState"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  Home,
  Upload,
  BarChart2,
  FileText,
  HelpCircle,
  Moon,
  Sparkles,
  Sun,
} from "lucide-react"

const navItems = [
  { id: "home" as const, label: "首页", icon: Home },
  { id: "upload" as const, label: "数据上传", icon: Upload },
  { id: "analysis" as const, label: "数据分析", icon: Sparkles },
  { id: "manual" as const, label: "手动分析", icon: BarChart2 },
  { id: "results" as const, label: "分析结果", icon: FileText },
]

interface HeaderProps {
  onOpenHelp: () => void
}

export function Header({ onOpenHelp }: HeaderProps) {
  const state = useAppState()
  const [dark, setDark] = useState(false)

  const toggleTheme = () => {
    const next = !dark
    setDark(next)
    document.documentElement.classList.toggle("dark", next)
  }

  return (
    <header className="sticky top-0 z-40 w-full border-b bg-background">
      <div className="flex h-14 min-w-0 items-center justify-between gap-2 px-3 sm:px-4">
        <div className="flex min-w-0 items-center gap-3 lg:gap-6">
          <div className="flex shrink-0 items-center gap-2">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary">
              <BarChart2 className="h-4 w-4 text-primary-foreground" />
            </div>
            <div className="flex flex-col leading-tight">
              <span className="text-sm font-bold tracking-tight">AI 数据分析器</span>
              <span className="hidden text-[10px] text-muted-foreground lg:block">本地科学计算与报告自动化</span>
            </div>
          </div>
          <nav className="hidden min-w-0 items-center gap-0.5 md:flex lg:gap-1">
            {navItems.map((item) => (
              <Button
                key={item.id}
                variant={state.currentPage === item.id ? "secondary" : "ghost"}
                size="sm"
                onClick={() => store.setPage(item.id)}
                className="gap-1.5"
              >
                <item.icon className="h-3.5 w-3.5" />
                {item.label}
              </Button>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleTheme}
            className="h-8 w-8"
          >
            {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onOpenHelp}
            className="h-8 w-8"
          >
            <HelpCircle className="h-4 w-4" />
          </Button>
        </div>
      </div>
      {/* Mobile nav */}
      <div className="flex md:hidden border-t">
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => store.setPage(item.id)}
            className={cn(
              "flex-1 flex flex-col items-center justify-center py-2 text-[10px] gap-0.5",
              state.currentPage === item.id
                ? "text-primary"
                : "text-muted-foreground"
            )}
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </button>
        ))}
      </div>
    </header>
  )
}
