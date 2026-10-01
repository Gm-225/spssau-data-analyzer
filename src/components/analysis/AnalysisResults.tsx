import { ResultTable } from "./ResultTable"
import type { AnalysisResult } from "@/lib/analysis-engine"

export function AnalysisResults({ result }: { result: AnalysisResult }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span>{result.methodName}</span>
        <span>·</span>
        <span>{new Date(result.timestamp).toLocaleString("zh-CN")}</span>
      </div>
      {result.tables.map((table, i) => (
        <ResultTable key={i} table={table} />
      ))}
    </div>
  )
}
