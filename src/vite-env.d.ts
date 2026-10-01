/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ANALYSIS_API_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

interface ScientificAnalysisResponse {
  result: import("./lib/analysis-engine").AnalysisResult
  artifacts: {
    result: string
    docx?: string
    pdf?: string
    manifest?: string
  }
  job: {
    jobId: string
    status: "succeeded"
    manifestPath: string
    rawInputRetained: boolean
    caseMemoryStored: boolean
  }
}

interface Window {
  analysisBridge?: {
    runQuestionnaireAnalysis(payload: {
      headers: string[]
      rows: Record<string, unknown>[]
      prompt: string
      plan?: import("./lib/smart-analysis").ScientificQuestionnairePlan
    }): Promise<ScientificAnalysisResponse>
    openArtifact(path: string): Promise<boolean>
    getAmosStatus(): Promise<{
      configured: boolean
      amosHome: string | null
      bridgeReady: boolean
      configPath: string
    }>
    configureAmos(): Promise<{
      canceled: boolean
      configured?: boolean
      amosHome?: string
    }>
  }
}
