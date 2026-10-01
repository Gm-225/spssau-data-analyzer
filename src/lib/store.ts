// Global state for the SPSSAU app
import type { AnalysisResult, AnalysisMethod } from "./analysis-engine"
import { runAnalysis } from "./analysis-engine"
import { getAnalysisApiUrl, runRemoteAnalysis, supportsRemoteAnalysis } from "./analysis-client"
import type { ScientificQuestionnairePlan } from "./smart-analysis"
import { getMethodInfo } from "./methods"

export interface Variable {
  name: string
  type: "numeric" | "categorical" | "string"
}

export interface AnalysisReport {
  id: string
  methodId: string
  methodName: string
  timestamp: number
  result: AnalysisResult
  assurance: "basic-preview" | "scientific"
  artifacts?: {
    result: string
    docx?: string
    pdf?: string
    manifest?: string
  }
  provenance?: ScientificAnalysisResponse["job"]
}

export interface AppState {
  currentPage: "home" | "upload" | "analysis" | "manual" | "results"
  currentData: { headers: string[]; rows: Record<string, unknown>[] } | null
  variables: Variable[]
  analysisReports: AnalysisReport[]
  currentReportId: string | null
  isLoading: boolean
  toastMessage: string | null
}

type Listener = () => void

class Store {
  private state: AppState = {
    currentPage: "home",
    currentData: null,
    variables: [],
    analysisReports: [],
    currentReportId: null,
    isLoading: false,
    toastMessage: null,
  }
  private listeners: Set<Listener> = new Set()
  private toastTimer: ReturnType<typeof setTimeout> | null = null

  getState(): AppState {
    return this.state
  }

  setState(partial: Partial<AppState>) {
    this.state = { ...this.state, ...partial }
    this.listeners.forEach((l) => l())
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  setPage(page: AppState["currentPage"]) {
    this.setState({ currentPage: page })
  }

  setData(data: AppState["currentData"]) {
    this.setState({ currentData: data })
  }

  showToast(message: string, durationMs = 3000) {
    if (this.toastTimer) clearTimeout(this.toastTimer)
    this.setState({ toastMessage: message })
    this.toastTimer = setTimeout(() => {
      this.toastTimer = null
      this.setState({ toastMessage: null })
    }, durationMs)
  }

  setLoading(loading: boolean) {
    this.setState({ isLoading: loading })
  }

  runAnalysis(methodId: string, methodName: string, dropZoneVars: Record<string, string[]>) {
    const { currentData } = this.state
    if (!currentData) {
      this.showToast("请先上传数据")
      return
    }
    const method = getMethodInfo(methodId)
    if (method.trustTier === "blocked") {
      this.showToast(`${method.title}尚未完成科学验证，当前版本禁止执行`, 8000)
      return
    }

    this.setLoading(true)

    // Use setTimeout to allow UI to update
    setTimeout(async () => {
      try {
        const useRemoteApi = Boolean(getAnalysisApiUrl()) && supportsRemoteAnalysis(methodId)
        const result = useRemoteApi
          ? await runRemoteAnalysis(methodId, currentData, dropZoneVars)
          : runAnalysis(methodId as AnalysisMethod, currentData, dropZoneVars)
        const report: AnalysisReport = {
          id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
          methodId,
          methodName,
          timestamp: Date.now(),
          result,
          assurance: method.trustTier === "verified" ? "scientific" : "basic-preview",
        }

        this.setState({
          analysisReports: [...this.state.analysisReports, report],
          currentReportId: report.id,
          isLoading: false,
        })

        this.showToast(useRemoteApi ? "分析完成并已持久化" : method.trustTier === "verified" ? "分析完成" : "基础预览完成，请勿直接作为正式结论")
        // Navigate to results
        this.setPage("results")
      } catch (error) {
        this.setLoading(false)
        this.showToast(`分析错误: ${error instanceof Error ? error.message : "未知错误"}`, 8000)
        console.error(error)
      }
    }, 100)
  }

  runSmartAnalysis(prompt: string, plan: ScientificQuestionnairePlan) {
    const { currentData } = this.state
    if (!currentData) {
      this.showToast("请先上传数据")
      return
    }
    if (!plan) {
      this.showToast("请先复核并确认分析方案", 8000)
      return
    }
    if (!window.analysisBridge) {
      this.showToast("科学分析仅可在带本地科学计算运行时的桌面版中执行", 8000)
      return
    }
    this.setLoading(true)
    setTimeout(async () => {
      try {
        const scientific = await window.analysisBridge!.runQuestionnaireAnalysis({
          ...currentData,
          prompt,
          plan,
        })
        const result = scientific.result
        const report: AnalysisReport = {
          id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
          methodId: "smart-report",
          methodName: scientific.result.methodName ?? "AI 一键分析报告",
          timestamp: Date.now(),
          result,
          assurance: "scientific",
          artifacts: scientific.artifacts,
          provenance: scientific.job,
        }
        this.setState({
          analysisReports: [...this.state.analysisReports, report],
          currentReportId: report.id,
          isLoading: false,
          currentPage: "results",
        })
        this.showToast(`科学分析完成：已生成 ${result.tables.length} 个结果模块和 Word/PDF 报告`)
      } catch (error) {
        this.setLoading(false)
        this.showToast(`一键分析失败: ${error instanceof Error ? error.message : "未知错误"}`, 8000)
      }
    }, 80)
  }
}

export const store = new Store()
