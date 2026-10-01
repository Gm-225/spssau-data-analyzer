import { useState } from "react"
import { store } from "@/lib/store"
import { useAppState } from "@/hooks/useAppState"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { AnalysisResults } from "@/components/analysis/AnalysisResults"
import {
  FileText, BarChart2, Trash2, FileType, Download, CheckSquare, Square, Calendar, FileDown,
  AlertTriangle, Fingerprint,
} from "lucide-react"

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

export function ResultsPage() {
  const state = useAppState()
  const reports = state.analysisReports
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [currentId, setCurrentId] = useState<string | null>(
    state.currentReportId ?? (reports.length > 0 ? reports[reports.length - 1].id : null)
  )

  const currentReport = reports.find((r) => r.id === currentId)

  const openArtifact = async (artifactPath: string | undefined, label: string) => {
    if (!artifactPath || !window.analysisBridge) {
      store.showToast(`${label} 文件不可用`)
      return
    }
    try {
      await window.analysisBridge.openArtifact(artifactPath)
      store.showToast(`已打开${label}报告`)
    } catch (error) {
      store.showToast(`打开失败: ${error instanceof Error ? error.message : "未知错误"}`)
    }
  }

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const toggleSelectAll = () => {
    if (selectedIds.size === reports.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(reports.map((r) => r.id)))
    }
  }

  const clearSelected = () => {
    const ids = selectedIds
    const newReports = reports.filter((r) => !ids.has(r.id))
    // Need to update store - for now just clear selection
    setSelectedIds(new Set())
    // If current report is deleted, clear it
    if (currentId && ids.has(currentId)) {
      const remaining = newReports.length > 0 ? newReports[newReports.length - 1].id : null
      setCurrentId(remaining)
      store.setState({ analysisReports: newReports, currentReportId: remaining })
    } else {
      store.setState({ analysisReports: newReports })
    }
    store.showToast("已从当前列表移除；磁盘报告未删除")
  }

  const exportCSV = (report: typeof currentReport) => {
    if (!report) return
    let csv = ""
    for (const table of report.result.tables) {
      csv += `${table.title}\n`
      csv += table.headers.join(",") + "\n"
      csv += table.rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n")
      csv += "\n\n"
    }
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    const prefix = report.assurance === "basic-preview" ? "基础预览_" : ""
    a.href = url; a.download = `${prefix}${report.methodName}_${new Date(report.timestamp).toISOString().slice(0, 10)}.csv`
    a.click(); URL.revokeObjectURL(url)
    store.showToast("导出成功")
  }

  const exportWord = (report: typeof currentReport) => {
    if (!report) return
    let html = `<html><head><meta charset="utf-8"><style>
      @page{size:A4;margin:2.2cm 2cm}body{font-family:"SimSun","宋体",serif;font-size:12pt;line-height:1.8;color:#111}
      h1{text-align:center;font-size:20pt;margin:0 0 24pt}h2{font-size:15pt;margin:22pt 0 10pt}h3{font-size:12pt;margin:16pt 0 8pt}
      p{margin:6pt 0;text-align:justify;text-indent:2em}table{border-collapse:collapse;width:100%;margin:10pt 0 14pt;border-top:1.5pt solid #111;border-bottom:1.5pt solid #111}
      th,td{border:none;padding:4pt 6pt;text-align:center;vertical-align:middle}th{font-weight:bold;border-bottom:0.75pt solid #111}tr{page-break-inside:avoid}
      .meta{text-align:center;text-indent:0;color:#666;font-size:9pt;margin-bottom:18pt}
    </style></head><body>`
    html += `<h1>${escapeHtml(report.methodName)}</h1><p class="meta">${new Date(report.timestamp).toLocaleString("zh-CN")}</p>`
    if (report.assurance === "basic-preview") {
      html += `<p style="border:1px solid #b45309;background:#fffbeb;padding:10pt;text-indent:0"><strong>基础预览：</strong>本结果仅用于数据初看和人工复核，不是正式科学报告，不支持因果或模型结论。</p>`
    }
    for (const table of report.result.tables) {
      const isSection = table.type === "text" && /^\d+、/.test(table.title)
      html += `${isSection ? "<h2>" : "<h3>"}${escapeHtml(table.title)}${isSection ? "</h2>" : "</h3>"}`
      if (table.type === "text") {
        html += table.rows.map((row) => `<p>${row.map(escapeHtml).join(" ")}</p>`).join("")
      } else {
        html += `<table><thead><tr>${table.headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead><tbody>`
        html += table.rows.map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(c)}</td>`).join("")}</tr>`).join("")
        html += `</tbody></table>`
      }
    }
    html += `</body></html>`
    const blob = new Blob([html], { type: "application/msword" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    const prefix = report.assurance === "basic-preview" ? "基础预览_" : ""
    a.href = url; a.download = `${prefix}${report.methodName}_${new Date(report.timestamp).toISOString().slice(0, 10)}.doc`
    a.click(); URL.revokeObjectURL(url)
    store.showToast("导出成功")
  }

  return (
    <div className="flex h-[calc(100vh-3.5rem)]">
      {/* Left: Report History */}
      <div className="w-64 border-r flex flex-col shrink-0 bg-background">
        <div className="px-3 py-3 border-b space-y-2">
          <h3 className="text-sm font-semibold flex items-center gap-1.5">
            <FileText className="h-4 w-4 text-primary" />
            报告项目
          </h3>
          {reports.length > 0 && (
            <div className="flex items-center gap-1 flex-wrap">
              <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={toggleSelectAll}>
                {selectedIds.size === reports.length ? <CheckSquare className="h-3 w-3" /> : <Square className="h-3 w-3" />}
                全选
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs gap-1 text-destructive hover:text-destructive"
                disabled={selectedIds.size === 0}
                onClick={clearSelected}
              >
                <Trash2 className="h-3 w-3" />
                移出列表
              </Button>
            </div>
          )}
        </div>
        <ScrollArea className="flex-1">
          {reports.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 px-4 text-center gap-2">
              <FileText className="h-8 w-8 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">暂无报告项目</p>
              <p className="text-xs text-muted-foreground/60">进行数据分析后将自动添加到此处</p>
              <Button variant="outline" size="sm" onClick={() => store.setPage("analysis")}>
                前往分析
              </Button>
            </div>
          ) : (
            <div className="p-2 space-y-0.5">
              {reports.map((r) => (
                <div
                  key={r.id}
                  onClick={() => setCurrentId(r.id)}
                  className={`flex items-center gap-2 px-2 py-2 rounded-md cursor-pointer transition-colors group ${
                    currentId === r.id ? "bg-primary/10 ring-1 ring-primary/20" : "hover:bg-muted/50"
                  }`}
                >
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleSelect(r.id) }}
                    className="shrink-0"
                  >
                    {selectedIds.has(r.id) ? (
                      <CheckSquare className="h-3.5 w-3.5 text-primary" />
                    ) : (
                      <Square className="h-3.5 w-3.5 text-muted-foreground/40 group-hover:text-muted-foreground" />
                    )}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="flex min-w-0 items-center gap-1">
                      <p className="min-w-0 truncate text-xs font-medium">{r.methodName}</p>
                      {r.assurance === "basic-preview" && <span className="shrink-0 text-[9px] text-amber-700">预览</span>}
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      {new Date(r.timestamp).toLocaleString("zh-CN")}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </div>

      {/* Right: Results Display */}
      <div className="flex-1 flex flex-col bg-muted/10">
        {!currentReport ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center space-y-3">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted mx-auto">
                <BarChart2 className="h-8 w-8 text-muted-foreground/40" />
              </div>
              <p className="text-lg font-medium text-muted-foreground">选择左侧历史分析项目查看结果</p>
              <p className="text-sm text-muted-foreground/60">或进行新的数据分析</p>
              <Button variant="outline" size="sm" onClick={() => store.setPage("analysis")}>
                前往分析
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="px-4 py-3 border-b bg-background flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <h3 title={currentReport.methodName} className="truncate text-base font-semibold">{currentReport.methodName}</h3>
                  <Badge variant={currentReport.assurance === "scientific" ? "secondary" : "outline"} className="shrink-0 text-[10px]">
                    {currentReport.assurance === "scientific" ? "科学管线" : "基础预览"}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                  <Calendar className="h-3 w-3" />
                  {new Date(currentReport.timestamp).toLocaleString("zh-CN")}
                  {currentReport.provenance?.jobId && <span className="ml-1">任务 {currentReport.provenance.jobId.slice(0, 8)}</span>}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button variant="outline" size="sm" className="gap-1.5" onClick={() => exportCSV(currentReport)}>
                  <Download className="h-3.5 w-3.5" />
                  导出CSV
                </Button>
                {currentReport.artifacts?.docx ? (
                  <>
                    <Button variant="outline" size="sm" className="gap-1.5" onClick={() => openArtifact(currentReport.artifacts?.docx, "Word")}>
                      <FileType className="h-3.5 w-3.5" />
                      打开Word
                    </Button>
                    <Button variant="outline" size="sm" className="gap-1.5" onClick={() => openArtifact(currentReport.artifacts?.pdf, "PDF")}>
                      <FileDown className="h-3.5 w-3.5" />
                      打开PDF
                    </Button>
                  </>
                ) : (
                  <Button variant="outline" size="sm" className="gap-1.5" onClick={() => exportWord(currentReport)}>
                    <FileType className="h-3.5 w-3.5" />
                    导出Word
                  </Button>
                )}
                {currentReport.artifacts?.manifest && (
                  <Button variant="outline" size="sm" className="gap-1.5" onClick={() => openArtifact(currentReport.artifacts?.manifest, "任务追溯") }>
                    <Fingerprint className="h-3.5 w-3.5" />
                    查看追溯
                  </Button>
                )}
              </div>
            </div>
            <ScrollArea className="flex-1 p-4">
              {currentReport.assurance === "basic-preview" && (
                <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-xs leading-5 text-amber-950" data-testid="preview-report-warning">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <p><strong>基础预览：</strong>仅用于数据初看和人工复核，不是正式科学报告，不支持因果或模型结论。</p>
                </div>
              )}
              <AnalysisResults result={currentReport.result} />
            </ScrollArea>
          </>
        )}
      </div>
    </div>
  )
}
