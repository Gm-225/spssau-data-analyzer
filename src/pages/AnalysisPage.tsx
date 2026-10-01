import { useState } from "react"
import { store } from "@/lib/store"
import { useAppState } from "@/hooks/useAppState"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { methodCategories, getMethodInfo, type DropZoneConfig } from "@/lib/methods"
import { cn } from "@/lib/utils"
import {
  BarChart2, Play, ChevronDown, ChevronRight, Variable,
  GripVertical, X, Plus, Info, Sparkles, AlertTriangle, LockKeyhole,
} from "lucide-react"

export function AnalysisPage() {
  const state = useAppState()
  const [selectedMethod, setSelectedMethod] = useState<string | null>(null)
  const [collapsedCats, setCollapsedCats] = useState<Set<string>>(new Set())
  const [selectedVars, setSelectedVars] = useState<Set<string>>(new Set())
  const [lastClickedIndex, setLastClickedIndex] = useState<number>(-1)
  const [dropZoneVars, setDropZoneVars] = useState<Record<string, string[]>>({})
  const [extraZoneIds, setExtraZoneIds] = useState<string[]>([])

  const methodInfo = selectedMethod ? getMethodInfo(selectedMethod) : null
  const dynamicZoneCfg = methodInfo?.dynamicZone
  const extraZones: DropZoneConfig[] = dynamicZoneCfg
    ? extraZoneIds.map((id) => ({
        id,
        label: `${dynamicZoneCfg.labelPrefix}${id.slice(dynamicZoneCfg.idPrefix.length)}`,
        multiple: true,
      }))
    : []
  const allZones = [...(methodInfo?.dropZones ?? []), ...extraZones]
  const variables = state.currentData?.headers.map((h) => ({
    name: h,
    type: guessType(state.currentData?.rows.map((r) => r[h]) ?? []),
  })) ?? []

  const toggleCategory = (cat: string) => {
    setCollapsedCats((prev) => {
      const next = new Set(prev)
      if (next.has(cat)) next.delete(cat); else next.add(cat)
      return next
    })
  }

  const handleMethodSelect = (methodId: string) => {
    setSelectedMethod(methodId)
    setDropZoneVars({})
    setExtraZoneIds([])
  }

  const removeZone = (zoneId: string) => {
    setExtraZoneIds((prev) => prev.filter((id) => id !== zoneId))
    setDropZoneVars((prev) => {
      const next = { ...prev }
      delete next[zoneId]
      return next
    })
  }

  const handleVarClick = (varName: string, index: number, e: React.MouseEvent) => {
    if (e.shiftKey && lastClickedIndex >= 0) {
      const start = Math.min(lastClickedIndex, index)
      const end = Math.max(lastClickedIndex, index)
      const rangeVars = variables.slice(start, end + 1).map((v) => v.name)
      setSelectedVars((prev) => {
        const next = new Set(e.ctrlKey || e.metaKey ? prev : [])
        rangeVars.forEach((v) => next.add(v))
        return next
      })
    } else if (e.ctrlKey || e.metaKey) {
      setSelectedVars((prev) => {
        const next = new Set(prev)
        if (next.has(varName)) next.delete(varName); else next.add(varName)
        return next
      })
    } else {
      setSelectedVars(new Set([varName]))
    }
    setLastClickedIndex(index)
  }

  const addToZone = (zoneId: string) => {
    if (selectedVars.size === 0) return
    setDropZoneVars((prev) => {
      const current = prev[zoneId] ?? []
      const existing = new Set(current)
      const toAdd = [...selectedVars].filter((v) => !existing.has(v))
      return { ...prev, [zoneId]: [...current, ...toAdd] }
    })
  }

  const removeFromZone = (zoneId: string, varName: string) => {
    setDropZoneVars((prev) => ({
      ...prev,
      [zoneId]: (prev[zoneId] ?? []).filter((v) => v !== varName),
    }))
  }

  const handleRunAnalysis = () => {
    if (!selectedMethod) {
      store.showToast("请先选择一个分析方法")
      return
    }
    if (!state.currentData) {
      store.showToast("请先上传数据")
      return
    }
    const info = getMethodInfo(selectedMethod)
    if (info.trustTier === "blocked") {
      store.showToast(`${info.title}尚未完成科学验证，当前版本禁止执行`, 8000)
      return
    }
    if (!info.isTextMode) {
      const emptyZones = info.dropZones.filter(
        (z) => !dropZoneVars[z.id] || dropZoneVars[z.id].length === 0
      )
      if (emptyZones.length > 0) {
        store.showToast(`请为以下区域添加变量: ${emptyZones.map((z) => z.label).join(", ")}`)
        return
      }
    }
    store.runAnalysis(selectedMethod, info.title, dropZoneVars)
  }

  const hasData = state.currentData && state.currentData.rows.length > 0

  return (
    <div className="flex h-[calc(100vh-3.5rem)] min-w-0 overflow-hidden">
      {/* Left: Method List */}
      <div className="flex w-56 shrink-0 flex-col overflow-hidden border-r bg-muted/20">
        <div className="px-3 py-3 border-b">
          <h3 className="text-sm font-semibold flex items-center gap-1.5">
            <BarChart2 className="h-4 w-4 text-primary" />
            分析方法
          </h3>
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <div className="p-2 space-y-1">
            {methodCategories.map((cat) => {
              const isCollapsed = collapsedCats.has(cat.name)
              return (
                <div key={cat.name}>
                  <button
                    onClick={() => toggleCategory(cat.name)}
                    className="flex w-full items-center gap-1 px-2 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground rounded-md hover:bg-muted/50 transition-colors"
                  >
                    {isCollapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                    {cat.name}
                  </button>
                  {!isCollapsed && (
                    <div className="ml-2 space-y-0.5">
                      {cat.methods.map((m) => {
                        const info = getMethodInfo(m)
                        return (
                          <button
                            key={m}
                            onClick={() => handleMethodSelect(m)}
                            className={cn(
                              "flex w-full min-w-0 items-center justify-between gap-1.5 px-2.5 py-1.5 text-left text-sm rounded-md transition-colors",
                              selectedMethod === m
                                ? "bg-primary/10 text-primary font-medium"
                                : "hover:bg-muted/50 text-foreground/80"
                            )}
                          >
                            <span className="min-w-0 truncate">{info.title}</span>
                            <span className={cn(
                              "shrink-0 text-[9px]",
                              info.trustTier === "verified" ? "text-emerald-700"
                                : info.trustTier === "basic-preview" ? "text-amber-700"
                                : "text-muted-foreground/60"
                            )}>
                              {info.trustTier === "verified" ? "已验证" : info.trustTier === "basic-preview" ? "预览" : "锁定"}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </ScrollArea>
      </div>

      {/* Center: Variable List */}
      <div className="flex w-56 min-w-0 shrink-0 flex-col overflow-hidden border-r bg-background">
        <div className="px-3 py-3 border-b flex items-center justify-between">
          <h3 className="text-sm font-semibold flex items-center gap-1.5">
            <Variable className="h-4 w-4 text-muted-foreground" />
            变量列表
          </h3>
          {selectedVars.size > 0 && (
            <Badge variant="secondary" className="text-[10px]">{selectedVars.size}</Badge>
          )}
        </div>
        <ScrollArea className="min-h-0 min-w-0 flex-1">
          {!hasData ? (
            <div className="flex flex-col items-center justify-center py-12 px-4 text-center gap-2">
              <Info className="h-8 w-8 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">请先上传数据</p>
              <Button variant="outline" size="sm" onClick={() => store.setPage("upload")}>
                前往上传
              </Button>
            </div>
          ) : (
            <div className="w-56 max-w-full min-w-0 space-y-0.5 overflow-hidden p-2">
              {variables.map((v, i) => (
                <div
                  key={v.name}
                  title={v.name}
                  onClick={(e) => handleVarClick(v.name, i, e)}
                  className={cn(
                    "flex w-full min-w-0 items-center gap-2 overflow-hidden rounded-md px-2 py-1.5 text-sm cursor-pointer transition-colors select-none",
                    selectedVars.has(v.name)
                      ? "bg-primary/10 text-primary font-medium ring-1 ring-primary/20"
                      : "hover:bg-muted/50"
                  )}
                >
                  <span className="min-w-0 truncate flex-1">{v.name}</span>
                  <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 shrink-0">
                    {v.type === "numeric" ? "数值" : "分类"}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </div>

      {/* Right: Drop Zone Area */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-muted/10">
        {!methodInfo ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center space-y-3">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted mx-auto">
                <BarChart2 className="h-8 w-8 text-muted-foreground/40" />
              </div>
              <p className="text-lg font-medium text-muted-foreground">从左侧选择分析方法</p>
              <p className="max-w-md text-sm leading-6 text-muted-foreground/70">
                手动工作台当前开放"已验证"与"基础预览"两档方法；带"锁定"标记的方法在完成科学基线和独立基准前暂不可运行。
              </p>
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => store.setPage("analysis")}>
                <Sparkles className="h-3.5 w-3.5" />
                使用 AI 自动分析
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="min-w-0 border-b bg-background px-4 py-3">
              <div className="flex min-w-0 items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="truncate text-base font-semibold" title={methodInfo.title}>{methodInfo.title}</h3>
                    {methodInfo.trustTier === "verified" ? (
                      <Badge className="text-[10px] bg-emerald-100 text-emerald-800 hover:bg-emerald-100">已验证</Badge>
                    ) : methodInfo.trustTier === "basic-preview" ? (
                      <Badge variant="secondary" className="text-[10px]">基础预览</Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px]">尚未进入可信主线</Badge>
                    )}
                  </div>
                  <p className="truncate text-xs text-muted-foreground mt-0.5" title={methodInfo.description}>{methodInfo.description}</p>
                </div>
                <Button
                  onClick={handleRunAnalysis}
                  className="shrink-0 gap-2"
                  size="sm"
                  disabled={state.isLoading || methodInfo.trustTier === "blocked"}
                >
                  {methodInfo.trustTier === "blocked" ? <LockKeyhole className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                  {state.isLoading ? "分析中..." : methodInfo.trustTier === "blocked" ? "暂不可运行" : methodInfo.trustTier === "verified" ? "开始分析" : "开始预览"}
                </Button>
              </div>
            </div>
            <div
              data-testid="manual-trust-boundary"
              className={cn(
                "flex items-start gap-2 border-b px-4 py-2.5 text-xs leading-5",
                methodInfo.trustTier === "verified"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-950"
                  : methodInfo.trustTier === "basic-preview"
                  ? "border-amber-200 bg-amber-50 text-amber-950"
                  : "border-destructive/20 bg-destructive/5 text-destructive"
              )}
            >
              {methodInfo.trustTier === "verified" ? (
                <Sparkles className="mt-0.5 h-4 w-4 shrink-0" />
              ) : (
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              )}
              <p>{methodInfo.trustDescription}</p>
            </div>
            <ScrollArea className="min-h-0 min-w-0 flex-1 p-4">
              {methodInfo.isTextMode ? (
                <Card>
                  <CardContent className="pt-6">
                    <textarea
                      className="w-full min-h-[300px] rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-y"
                      placeholder={methodInfo.placeholder}
                    />
                  </CardContent>
                </Card>
              ) : (
                <>
                <div className="grid min-w-0 gap-4 sm:grid-cols-2">
                  {allZones.map((zone) => {
                    const zoneVars = dropZoneVars[zone.id] ?? []
                    const isDynamic = extraZoneIds.includes(zone.id)
                    return (
                      <Card key={zone.id} className={cn(
                        "transition-all",
                        zoneVars.length === 0 && "border-dashed"
                      )}>
                        <CardHeader className="pb-2">
                          <CardTitle className="text-sm flex items-center justify-between">
                            <span>{zone.label}</span>
                            <div className="flex items-center gap-1.5">
                              <Badge variant="secondary" className="text-[10px]">
                                {zone.multiple ? "多选" : "单选"}
                              </Badge>
                              {isDynamic && (
                                <button
                                  onClick={() => removeZone(zone.id)}
                                  title="移除此因子"
                                  className="text-muted-foreground hover:text-destructive transition-colors"
                                >
                                  <X className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </div>
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          {zoneVars.length === 0 ? (
                            <div className="flex flex-col items-center gap-2 py-4">
                              <p className="text-xs text-muted-foreground">添加变量到此处</p>
                              {selectedVars.size > 0 && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => addToZone(zone.id)}
                                  className="gap-1"
                                >
                                  <Plus className="h-3 w-3" />
                                  添加已选 ({selectedVars.size})
                                </Button>
                              )}
                            </div>
                          ) : (
                            <div className="space-y-1.5">
                              {zoneVars.map((v) => (
                                <div key={v} title={v} className="flex min-w-0 items-center gap-2 px-2 py-1.5 rounded-md bg-muted/50 text-sm group">
                                  <GripVertical className="h-3 w-3 text-muted-foreground/50 shrink-0" />
                                  <span className="min-w-0 flex-1 truncate">{v}</span>
                                  <button
                                    onClick={() => removeFromZone(zone.id, v)}
                                    className="opacity-0 group-hover:opacity-100 transition-opacity"
                                  >
                                    <X className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                                  </button>
                                </div>
                              ))}
                              {zone.multiple && selectedVars.size > 0 && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => addToZone(zone.id)}
                                  className="w-full gap-1 text-xs h-7"
                                >
                                  <Plus className="h-3 w-3" />
                                  继续添加
                                </Button>
                              )}
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    )
                  })}
                </div>
                {dynamicZoneCfg && methodInfo.dropZones.length + extraZoneIds.length < dynamicZoneCfg.max && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-1 gap-1"
                    onClick={() =>
                      setExtraZoneIds((prev) => [
                        ...prev,
                        `${dynamicZoneCfg.idPrefix}${methodInfo.dropZones.length + prev.length + 1}`,
                      ])
                    }
                  >
                    <Plus className="h-3.5 w-3.5" />
                    添加因子
                  </Button>
                )}
                </>
              )}
            </ScrollArea>
          </>
        )}
      </div>
    </div>
  )
}

function guessType(values: unknown[]): "numeric" | "categorical" {
  let numCount = 0
  const valid = values.filter((v) => v !== null && v !== undefined && v !== "")
  if (valid.length === 0) return "categorical"
  for (const v of valid) {
    if (typeof v === "number" || (typeof v === "string" && !isNaN(Number(v)))) {
      numCount++
    }
  }
  return numCount / valid.length > 0.7 ? "numeric" : "categorical"
}
