import { runAnalysis, type AnalysisResult, type DataTable, type ResultTable } from "./analysis-engine"

export interface SmartPlanSummary {
  dimensions: { id: string; name: string; items: string[] }[]
  demographics: string[]
  sections: string[]
  modelLabel: string
  blockingIssues: string[]
}

export type ScientificAnalysisStep =
  | "data-quality"
  | "frequency"
  | "item-descriptive"
  | "reliability"
  | "efa"
  | "dimension-correlation"
  | "model"
  | "amos"

export interface ScientificQuestionnairePlan {
  schemaVersion: "2.0"
  planId: string
  title: string
  sampleIdColumn: string | null
  excludedColumns: string[]
  demographics: { column: string; labels: Record<string, string> }[]
  scale: {
    min: number
    max: number
    labels: Record<string, string>
    missingPolicy: "dimension-mean-requires-all-items"
    confirmed: boolean
  }
  dimensions: {
    id: string
    name: string
    columnPrefix: string
    expectedItems: number
    items: string[]
    reverseItems: string[]
    reverseItemsConfirmed: boolean
  }[]
  model: {
    type: "multiple-regression" | "parallel-mediation-with-direct-path-moderation" | "none"
    x?: string
    y?: string
    predictors?: string[]
    parallelMediators?: string[]
    moderator?: string
    moderatedPath?: string
    controls: string[]
    centering: string[]
    bootstrapSamples: number
    confidenceLevel: number
  }
  analysisOrder: ScientificAnalysisStep[]
  humanConfirmations: string[]
  confirmation: {
    confirmed: boolean
    confirmedAtUtc: string | null
  }
}

const dimensionNames: Record<string, string> = {
  PP: "感知个性化",
  AA: "广告回避",
  PC: "隐私担忧",
  PI: "感知侵扰",
  PV: "广告感知价值",
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function dimensionNameFromPrompt(id: string, prompt: string): string {
  const escaped = escapeRegExp(id)
  const parenthesized = prompt.match(new RegExp(`\\b${escaped}\\s*[（(]\\s*([^）)]+?)\\s*[）)]`, "i"))
  if (parenthesized?.[1]) return parenthesized[1].trim()
  const assigned = prompt.match(new RegExp(`\\b${escaped}\\s*[=:：]\\s*([\\u4e00-\\u9fa5A-Za-z0-9_-]{2,20})`, "i"))
  if (assigned?.[1]) return assigned[1].trim()
  return dimensionNames[id] ?? id
}

function dimensionGroups(data: DataTable, prompt: string) {
  const groups = new Map<string, string[]>()
  for (const header of data.headers) {
    const match = header.match(/^([A-Za-z]+)\d+(?:_|$)/)
    if (!match) continue
    const id = match[1].toUpperCase()
    groups.set(id, [...(groups.get(id) ?? []), header])
  }
  return [...groups.entries()]
    .filter(([, items]) => items.length >= 2)
    .map(([id, items]) => ({
      id,
      name: dimensionNameFromPrompt(id, prompt),
      items: [...items].sort((left, right) => {
        const leftIndex = Number(left.match(/^[A-Za-z]+(\d+)/)?.[1] ?? Number.MAX_SAFE_INTEGER)
        const rightIndex = Number(right.match(/^[A-Za-z]+(\d+)/)?.[1] ?? Number.MAX_SAFE_INTEGER)
        return leftIndex - rightIndex || left.localeCompare(right, "zh-CN")
      }),
    }))
}

function idsBeforeRole(prompt: string, role: string): string[] {
  const match = prompt.match(new RegExp(`([A-Za-z][A-Za-z0-9_]*(?:\\s*(?:、|,|，|和|及|/)\\s*[A-Za-z][A-Za-z0-9_]*)*)\\s*(?:为|作为)\\s*(?:并行)?${role}`, "i"))
  if (!match?.[1]) return []
  return match[1].split(/\s*(?:、|,|，|和|及|\/)\s*/).map((value) => value.toUpperCase())
}

function inferModel(prompt: string, dimensionIds: string[]): ScientificQuestionnairePlan["model"] {
  const xValues = idsBeforeRole(prompt, "自变量")
  const x = xValues[0]
  const y = idsBeforeRole(prompt, "因变量")[0]
  const mediators = idsBeforeRole(prompt, "中介(?:变量)?")
  const pathModeration = prompt.match(/\b([A-Za-z][A-Za-z0-9_]*)\s*调节\s*([A-Za-z][A-Za-z0-9_]*)\s*(?:→|->)\s*([A-Za-z][A-Za-z0-9_]*)/i)
  const moderator = idsBeforeRole(prompt, "调节(?:变量)?")[0] ?? pathModeration?.[1]?.toUpperCase()
  const existing = (value: string | undefined) => value && dimensionIds.includes(value) ? value : undefined
  const validX = existing(x)
  const validXValues = xValues.filter((id) => dimensionIds.includes(id))
  const validY = existing(y)
  const validMediators = mediators.filter((id) => dimensionIds.includes(id))
  const validModerator = existing(moderator)
  const isVerifiedAdvancedModel = validX === "PP" && validY === "AA"
    && validMediators.join(",") === "PC,PI" && validModerator === "PV"
  if (isVerifiedAdvancedModel) {
    return {
      type: "parallel-mediation-with-direct-path-moderation",
      x: validX,
      y: validY,
      predictors: [validX, ...validMediators, validModerator],
      parallelMediators: validMediators,
      moderator: validModerator,
      moderatedPath: `${validX}->${validY}`,
      controls: [],
      centering: [validX, validModerator],
      bootstrapSamples: 5000,
      confidenceLevel: 0.95,
    }
  }
  if (/中介|调节|mediat|moderat|process/i.test(prompt)) {
    return {
      type: "none",
      controls: [],
      centering: [],
      bootstrapSamples: 5000,
      confidenceLevel: 0.95,
    }
  }
  if (validX && validY) {
    return {
      type: "multiple-regression",
      x: validX,
      y: validY,
      predictors: [...new Set([...validXValues, ...validMediators, ...(validModerator ? [validModerator] : [])])],
      controls: [],
      centering: [],
      bootstrapSamples: 5000,
      confidenceLevel: 0.95,
    }
  }
  return {
    type: "none",
    controls: [],
    centering: [],
    bootstrapSamples: 5000,
    confidenceLevel: 0.95,
  }
}

const canonicalDemographicLabels: Record<string, Record<string, string>> = {
  性别: { "1": "男性", "2": "女性" },
  年龄: { "1": "18-25岁", "2": "26-35岁", "3": "36-45岁", "4": "45岁以上" },
  受教育程度: { "1": "高中及以下", "2": "专科", "3": "本科", "4": "硕士及以上" },
  职业: { "1": "学生", "2": "个体户、创业者", "3": "公司职员", "4": "国家机关、党政群体、企事业单位人员", "5": "其他" },
  收入: { "1": "3000以下", "2": "3000-4000", "3": "4001-5000", "4": "5000以上" },
}

function numberValue(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function detectSmartPlan(data: DataTable, prompt: string): SmartPlanSummary {
  const dimensions = dimensionGroups(data, prompt)
  const itemSet = new Set(dimensions.flatMap((dimension) => dimension.items))
  const demographics = data.headers.filter((header) =>
    !itemSet.has(header) && !/^(编号|序号|id)$/i.test(header.trim())
  )
  const wants = (pattern: RegExp) => pattern.test(prompt)
  const limitedRequest = wants(/只做|仅做|仅需|只需要|仅分析/)
  const comprehensive = !prompt.trim() || (!limitedRequest && wants(/完整|全部|常规|问卷|自动|综合|一键/))
  const sections = ["数据质量检查"]
  if (comprehensive || wants(/频数|人口|样本/)) sections.push("频数分析")
  if (comprehensive || wants(/描述|分布|正态/)) sections.push("描述统计")
  if (comprehensive || wants(/信度|alpha|α/i)) sections.push("信度检验")
  if ((comprehensive || wants(/效度|因子|efa/i)) && dimensions.length) sections.push("主成分结构检查（PCA+Varimax）")
  if ((comprehensive || wants(/相关/)) && dimensions.length >= 2) sections.push("相关性分析")
  const model = inferModel(prompt, dimensions.map((dimension) => dimension.id))
  if ((comprehensive || wants(/回归|影响|中介|调节/)) && model.type !== "none") {
    sections.push(wants(/中介|调节/) ? "并行中介与调节作用" : "线性回归分析")
  }
  if (wants(/amos|sem|cfa|结构方程|验证性因子/i)) sections.push("AMOS CFA/结构方程")
  const blockingIssues: string[] = []
  if (wants(/中介|调节|mediat|moderat|process/i) && model.type !== "parallel-mediation-with-direct-path-moderation") {
    blockingIssues.push("通用中介/调节尚未进入可信主线；当前仅支持已验证的 PP→AA、PC/PI 并行中介、PV 调节直接路径固定契约")
  }
  if (wants(/amos|sem|cfa|结构方程|验证性因子/i) && model.type !== "parallel-mediation-with-direct-path-moderation") {
    blockingIssues.push("AMOS/CFA/SEM 当前仅支持已验证的固定问卷契约，不能对通用模型自动执行")
  }
  if (prompt.trim() && sections.length === 1) {
    blockingIssues.push("未识别到可执行的分析需求；请明确填写描述统计、信度、效度、相关、回归，或使用已验证的固定高级模型")
  }
  if (!dimensions.length) {
    blockingIssues.push("未识别到至少包含 2 个题项的量表维度，请检查题项列名")
  }
  const modelLabel = model.type === "none"
    ? "未识别模型角色，请写明“X为自变量、Y为因变量”"
    : model.type === "multiple-regression"
      ? `X=${model.predictors?.join("+")} → Y=${model.y}`
      : `X=${model.x} → Y=${model.y}；M=${model.parallelMediators?.join("+")}；W=${model.moderator}`
  return { dimensions, demographics, sections, modelLabel, blockingIssues }
}

export function buildDemographicDefinition(data: DataTable, column: string) {
  const values = [...new Set(data.rows.map((row) => row[column]).filter((value) => value !== null && value !== undefined && value !== ""))]
  return {
    column,
    labels: canonicalDemographicLabels[column] ?? Object.fromEntries(values.map((value) => [String(value), String(value)])),
  }
}

export function buildScientificPlan(data: DataTable, prompt: string): ScientificQuestionnairePlan {
  const summary = detectSmartPlan(data, prompt)
  const itemSet = new Set(summary.dimensions.flatMap((dimension) => dimension.items))
  const model = inferModel(prompt, summary.dimensions.map((dimension) => dimension.id))
  const dimensionById = new Map(summary.dimensions.map((dimension) => [dimension.id, dimension]))
  const title = model.x && model.y
    ? `${dimensionById.get(model.x)?.name ?? model.x}对${dimensionById.get(model.y)?.name ?? model.y}的影响`
    : "问卷数据分析"
  const sampleIdColumn = data.headers.find((header) => /^(编号|序号|id)$/i.test(header.trim())) ?? null
  const analysisOrder: ScientificAnalysisStep[] = ["data-quality"]
  if (summary.sections.includes("描述统计")) analysisOrder.push("item-descriptive")
  if (summary.sections.includes("信度检验")) analysisOrder.push("reliability")
  if (summary.sections.includes("主成分结构检查（PCA+Varimax）")) analysisOrder.push("efa")
  if (summary.sections.includes("相关性分析")) analysisOrder.push("dimension-correlation")
  if ((summary.sections.includes("线性回归分析") || summary.sections.includes("并行中介与调节作用")) && model.type !== "none") analysisOrder.push("model")
  if (summary.sections.includes("AMOS CFA/结构方程")) analysisOrder.push("amos")
  return {
    schemaVersion: "2.0",
    planId: `auto-${summary.dimensions.map((dimension) => dimension.id).join("-").toLowerCase() || "questionnaire"}`,
    title,
    sampleIdColumn,
    excludedColumns: data.headers.filter((header) => !itemSet.has(header) && header !== sampleIdColumn),
    demographics: [],
    scale: {
      min: 1,
      max: 5,
      labels: Object.fromEntries(Array.from({ length: 5 }, (_, index) => {
        const value = String(index + 1)
        return [value, value]
      })),
      missingPolicy: "dimension-mean-requires-all-items",
      confirmed: false,
    },
    dimensions: summary.dimensions.map((dimension) => ({
      id: dimension.id,
      name: dimension.name,
      columnPrefix: dimension.id,
      expectedItems: dimension.items.length,
      items: dimension.items,
      reverseItems: [],
      reverseItemsConfirmed: false,
    })),
    model,
    analysisOrder,
    humanConfirmations: summary.blockingIssues,
    confirmation: {
      confirmed: false,
      confirmedAtUtc: null,
    },
  }
}

function addDimensionScores(data: DataTable, plan: SmartPlanSummary): DataTable {
  const headers = [...data.headers, ...plan.dimensions.map((dimension) => dimension.name)]
  const rows = data.rows.map((row) => {
    const next = { ...row }
    for (const dimension of plan.dimensions) {
      const values = dimension.items.map((item) => numberValue(row[item])).filter((value): value is number => value !== null)
      next[dimension.name] = values.length === dimension.items.length
        ? values.reduce((sum, value) => sum + value, 0) / values.length
        : null
    }
    return next
  })
  return { headers, rows }
}

function section(title: string, index: number, description: string): ResultTable {
  return { title: `${index}、${title}`, type: "text", headers: [], rows: [[description]] }
}

function interpret(result: AnalysisResult): string {
  const table = result.tables.find((item) => item.type === "table")
  if (!table || !table.rows.length) return "分析已完成，具体结果见下表。"
  if (result.methodId === "descriptive") {
    const means = table.rows.map((row) => Number(row[3])).filter(Number.isFinite)
    return means.length ? `共分析 ${means.length} 个题项，各题项的均值、标准差、偏度和峰度见下表。` : "描述统计结果见下表。"
  }
  if (result.methodId === "reliability") {
    const alpha = Number(table.rows[0]?.[0])
    return Number.isFinite(alpha) ? `该维度 Cronbach's α 为 ${alpha.toFixed(3)}，${alpha >= 0.7 ? "内部一致性达到常用标准" : "内部一致性需要进一步检查"}。` : "信度检验结果见下表。"
  }
  return "分析结果及统计判断见下表。"
}

export function buildSmartAnalysis(data: DataTable, prompt: string): { plan: SmartPlanSummary; result: AnalysisResult } {
  void data
  void prompt
  throw new Error("浏览器内 AI 报告回退已停用；请在带本地科学计算运行时的桌面版中确认方案后执行")
}
