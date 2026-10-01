import { useState, useRef, useCallback } from "react"
import { store } from "@/lib/store"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { CloudUpload, FileSpreadsheet, Trash2, Eye, Upload, AlertCircle } from "lucide-react"

export function UploadPage() {
  const [dragActive, setDragActive] = useState(false)
  const [fileName, setFileName] = useState<string | null>(null)
  const [previewData, setPreviewData] = useState<{ headers: string[]; rows: Record<string, unknown>[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFile = useCallback(async (file: File) => {
    const ext = file.name.split(".").pop()?.toLowerCase()
    if (!ext || !["xlsx", "xls", "csv"].includes(ext)) {
      setError("不支持的文件格式，请上传 .xlsx / .xls / .csv 文件")
      return
    }
    setError(null)
    setFileName(file.name)
    store.setLoading(true)

    try {
      const buffer = await file.arrayBuffer()
      let data: { headers: string[]; rows: Record<string, unknown>[] }
      
      if (ext === "csv") {
        const text = new TextDecoder("utf-8").decode(buffer)
        const result = (window as any).Papa.parse(text, { header: true, skipEmptyLines: true })
        data = { headers: result.meta.fields || [], rows: result.data }
      } else {
        const workbook = (window as any).XLSX.read(buffer, { type: "array" })
        const sheet = workbook.Sheets[workbook.SheetNames[0]]
        const jsonData = (window as any).XLSX.utils.sheet_to_json(sheet)
        if (jsonData.length > 0) {
          data = { headers: Object.keys(jsonData[0] as object), rows: jsonData }
        } else {
          data = { headers: [], rows: [] }
        }
      }

      setPreviewData(data)
      store.setData(data)
      store.showToast(`成功加载：${data.rows.length} 行 × ${data.headers.length} 列`)
    } catch (e) {
      setError("文件解析失败，请检查文件格式")
      console.error(e)
    } finally {
      store.setLoading(false)
    }
  }, [])

  const clearData = () => {
    setFileName(null)
    setPreviewData(null)
    setError(null)
    store.setData(null)
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-12">
      <div className="text-center mb-8">
        <h2 className="text-2xl font-bold tracking-tight flex items-center justify-center gap-2">
          <CloudUpload className="h-6 w-6 text-primary" />
          数据上传
        </h2>
        <p className="mt-2 text-muted-foreground">支持 Excel (.xlsx/.xls) 和 CSV (.csv) 格式</p>
      </div>

      <Card
        className={`
          relative border-2 border-dashed transition-all
          ${dragActive ? "border-primary bg-primary/5 scale-[1.01]" : "border-muted-foreground/25"}
          ${fileName ? "border-solid border-border" : ""}
        `}
        onDragOver={(e) => { e.preventDefault(); setDragActive(true) }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragActive(false)
          const file = e.dataTransfer.files?.[0]
          if (file) handleFile(file)
        }}
      >
        {!fileName ? (
          <CardContent className="flex flex-col items-center justify-center py-16 gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted">
              <CloudUpload className="h-8 w-8 text-muted-foreground" />
            </div>
            <div className="text-center">
              <p className="text-lg font-medium">拖拽文件到此处或点击上传</p>
              <p className="text-sm text-muted-foreground mt-1">
                支持 .xlsx / .xls / .csv 格式
              </p>
            </div>
            <Button onClick={() => fileInputRef.current?.click()} className="gap-2">
              <Upload className="h-4 w-4" />
              选择文件
            </Button>
            <Input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) handleFile(file)
              }}
            />
          </CardContent>
        ) : (
          <CardContent className="py-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                  <FileSpreadsheet className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="font-medium">{fileName}</p>
                  {previewData && (
                    <p className="text-xs text-muted-foreground">
                      {previewData.rows.length} 行 × {previewData.headers.length} 列
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} className="gap-1.5">
                  <Upload className="h-3.5 w-3.5" />
                  更换
                </Button>
                <Button variant="outline" size="sm" onClick={clearData} className="gap-1.5 text-destructive hover:text-destructive">
                  <Trash2 className="h-3.5 w-3.5" />
                  清除
                </Button>
              </div>
              <Input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) handleFile(file)
                }}
              />
            </div>
            <Separator className="mb-4" />
            {/* Data Preview */}
            {previewData && previewData.rows.length > 0 && (
              <div className="rounded-lg border overflow-hidden">
                <div className="overflow-x-auto max-h-64">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted/50">
                        <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground w-10">#</th>
                        {previewData.headers.map((h) => (
                          <th key={h} title={h} className="max-w-[240px] truncate px-3 py-2 text-left text-xs font-medium whitespace-nowrap">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {previewData.rows.slice(0, 50).map((row, i) => (
                        <tr key={i} className="border-t hover:bg-muted/30 transition-colors">
                          <td className="px-3 py-1.5 text-xs text-muted-foreground">{i + 1}</td>
                          {previewData.headers.map((h) => (
                            <td key={h} className="px-3 py-1.5 text-xs whitespace-nowrap max-w-[200px] truncate">
                              {String(row[h] ?? "")}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {previewData.rows.length > 50 && (
                  <div className="bg-muted/30 px-4 py-2 text-center text-xs text-muted-foreground">
                    仅显示前 50 行，共 {previewData.rows.length} 行
                  </div>
                )}
              </div>
            )}
          </CardContent>
        )}
      </Card>

      {error && (
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" />
          {error}
        </div>
      )}

      {previewData && (
        <div className="mt-6 flex justify-center">
          <Button size="lg" onClick={() => store.setPage("analysis")} className="gap-2 h-12 px-8 rounded-full">
            <Eye className="h-5 w-5" />
            前往数据分析
          </Button>
        </div>
      )}
    </div>
  )
}
