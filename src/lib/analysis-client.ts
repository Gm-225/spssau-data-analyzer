import type { AnalysisResult, AnalysisVariables, DataTable } from "./analysis-engine"

interface AnalysisJobResponse {
  apiVersion: "v1"
  id: string
  status: "completed" | "failed"
  result?: AnalysisResult
  error?: {
    code: string
    message: string
  }
}

interface ApiErrorResponse {
  error?: {
    code?: string
    message?: string
  }
}

export function getAnalysisApiUrl(): string | null {
  const value = import.meta.env.VITE_ANALYSIS_API_URL?.trim()
  return value ? value.replace(/\/$/, "") : null
}

export function supportsRemoteAnalysis(methodId: string): boolean {
  return methodId === "descriptive"
}

export async function runRemoteAnalysis(
  methodId: string,
  data: DataTable,
  variables: AnalysisVariables
): Promise<AnalysisResult> {
  const apiUrl = getAnalysisApiUrl()
  if (!apiUrl) throw new Error("未配置分析 API 地址")

  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 30_000)
  let response: Response
  try {
    response = await fetch(`${apiUrl}/v1/analysis-jobs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": crypto.randomUUID(),
      },
      body: JSON.stringify({
        methodId,
        source: "desktop-ui",
        data,
        variables,
      }),
      signal: controller.signal,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("分析 API 响应超时，请检查服务状态")
    }
    throw new Error("无法连接分析 API，请确认服务已启动")
  } finally {
    window.clearTimeout(timeout)
  }

  const payload = (await response.json().catch(() => ({}))) as AnalysisJobResponse & ApiErrorResponse
  if (!response.ok) {
    throw new Error(payload.error?.message || `分析 API 请求失败 (${response.status})`)
  }
  if (payload.status !== "completed" || !payload.result) {
    throw new Error(payload.error?.message || "分析 API 未返回完整结果")
  }
  return payload.result
}
