import { useEffect, useMemo, useState } from "react"
import { store } from "@/lib/store"
import { useAppState } from "@/hooks/useAppState"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  buildDemographicDefinition,
  buildScientificPlan,
  detectSmartPlan,
  type ScientificAnalysisStep,
  type ScientificQuestionnairePlan,
} from "@/lib/smart-analysis"
import {
  AlertTriangle, BarChart2, CheckCircle2, Database, LockKeyhole,
  ServerCog, ShieldCheck, Sparkles, Upload, WandSparkles,
} from "lucide-react"

const DEFAULT_PROMPT = "请对这份问卷数据做完整分析：PP为自变量、AA为因变量，PC和PI为并行中介，PV调节PP→AA直接路径；包括频数、描述统计、信度、效度、相关、Bootstrap中介、调节分析，以及CFA和AMOS结构方程模型，并按分析报告模板输出。"

const STEP_LABELS: Record<ScientificAnalysisStep, string> = {
  "data-quality": "数据质量",
  frequency: "人口学频数",
  "item-descriptive": "题项描述统计",
  reliability: "信度",
  efa: "主成分结构检查（PCA+Varimax）",
  "dimension-correlation": "维度相关",
  model: "研究模型",
  amos: "AMOS CFA/SEM",
}

const STEP_ORDER = Object.keys(STEP_LABELS) as ScientificAnalysisStep[]

type AmosStatus = Awaited<ReturnType<NonNullable<Window["analysisBridge"]>["getAmosStatus"]>>

function withoutConfirmation(plan: ScientificQuestionnairePlan): ScientificQuestionnairePlan {
  return {
    ...plan,
    scale: { ...plan.scale, confirmed: false },
    dimensions: plan.dimensions.map((dimension) => ({ ...dimension, reverseItemsConfirmed: false })),
    confirmation: { confirmed: false, confirmedAtUtc: null },
  }
}

function draftIssue(plan: ScientificQuestionnairePlan | null, frequencyRequested: boolean): string | null {
  if (!plan) return "尚未生成分析方案"
  if (plan.humanConfirmations.length) return plan.humanConfirmations[0]
  if (!plan.title.trim()) return "请填写报告标题"
  if (!Number.isInteger(plan.scale.min) || !Number.isInteger(plan.scale.max) || plan.scale.min >= plan.scale.max) {
    return "量表上下限必须是整数，且最大值大于最小值"
  }
  if (plan.scale.max - plan.scale.min > 20) return "量表范围过大，请复核编码"
  if (!plan.dimensions.length) return "至少需要一个量表维度"
  const allItems = plan.dimensions.flatMap((dimension) => dimension.items)
  if (new Set(allItems).size !== allItems.length) return "题项不能跨维度重复"
  if (plan.dimensions.some((dimension) => dimension.items.length < 2)) return "每个维度至少需要 2 个题项"
  if (frequencyRequested && plan.analysisOrder.length === 1 && !plan.demographics.length) {
    return "当前需求只请求人口学频数，请至少显式选择一个人口学字段"
  }
  return null
}

export function AiAssistantPage() {
  const state = useAppState()
  const [aiPrompt, setAiPrompt] = useState(DEFAULT_PROMPT)
  const [amosStatus, setAmosStatus] = useState<AmosStatus | null>(null)
  const [draftPlan, setDraftPlan] = useState<ScientificQuestionnairePlan | null>(null)
  const hasData = Boolean(state.currentData && state.currentData.rows.length > 0)
  const needsAmos = /amos|sem|cfa|结构方程|验证性因子/i.test(aiPrompt)
  const amosReady = Boolean(amosStatus?.configured && amosStatus.bridgeReady)
  const smartPlan = useMemo(
    () => state.currentData ? detectSmartPlan(state.currentData, aiPrompt) : null,
    [state.currentData, aiPrompt]
  )
  const planProblem = useMemo(
    () => draftIssue(draftPlan, Boolean(smartPlan?.sections.includes("频数分析"))),
    [draftPlan, smartPlan]
  )
  const planConfirmed = Boolean(draftPlan?.confirmation.confirmed)

  useEffect(() => {
    setDraftPlan(state.currentData ? buildScientificPlan(state.currentData, aiPrompt) : null)
  }, [state.currentData, aiPrompt])

  useEffect(() => {
    window.analysisBridge?.getAmosStatus().then(setAmosStatus).catch(() => setAmosStatus(null))
  }, [])

  const editPlan = (change: (plan: ScientificQuestionnairePlan) => ScientificQuestionnairePlan) => {
    setDraftPlan((current) => current ? withoutConfirmation(change(current)) : current)
  }

  const reconcileExcluded = (
    plan: ScientificQuestionnairePlan,
    demographics: ScientificQuestionnairePlan["demographics"],
    sampleIdColumn = plan.sampleIdColumn,
  ) => {
    const selected = new Set(demographics.map((item) => item.column))
    return (smartPlan?.demographics ?? []).filter((column) => column !== sampleIdColumn && !selected.has(column))
  }

  const toggleDemographic = (column: string) => {
    if (!state.currentData) return
    editPlan((plan) => {
      const selected = plan.demographics.some((item) => item.column === column)
      const demographics = selected
        ? plan.demographics.filter((item) => item.column !== column)
        : [...plan.demographics, buildDemographicDefinition(state.currentData!, column)]
      const shouldRunFrequency = demographics.length > 0 && Boolean(smartPlan?.sections.includes("频数分析"))
      const analysisOrder = STEP_ORDER.filter((step) => {
        if (step === "frequency") return shouldRunFrequency
        return plan.analysisOrder.includes(step)
      })
      return {
        ...plan,
        demographics,
        excludedColumns: reconcileExcluded(plan, demographics),
        analysisOrder,
      }
    })
  }

  const updateScale = (field: "min" | "max", value: number) => {
    editPlan((plan) => {
      const scale = { ...plan.scale, [field]: value }
      const validRange = Number.isInteger(scale.min) && Number.isInteger(scale.max) && scale.max > scale.min && scale.max - scale.min <= 20
      return {
        ...plan,
        scale: {
          ...scale,
          labels: validRange
            ? Object.fromEntries(Array.from({ length: scale.max - scale.min + 1 }, (_, index) => {
                const label = String(scale.min + index)
                return [label, label]
              }))
            : {},
        },
      }
    })
  }

  const toggleReverseItem = (dimensionId: string, item: string) => {
    editPlan((plan) => ({
      ...plan,
      dimensions: plan.dimensions.map((dimension) => {
        if (dimension.id !== dimensionId) return dimension
        const selected = dimension.reverseItems.includes(item)
        return {
          ...dimension,
          reverseItems: selected
            ? dimension.reverseItems.filter((candidate) => candidate !== item)
            : [...dimension.reverseItems, item],
        }
      }),
    }))
  }

  const confirmPlan = () => {
    if (!draftPlan || planProblem) {
      store.showToast(planProblem ?? "分析方案无效", 8000)
      return
    }
    const confirmedAtUtc = new Date().toISOString()
    setDraftPlan({
      ...draftPlan,
      scale: { ...draftPlan.scale, confirmed: true },
      dimensions: draftPlan.dimensions.map((dimension) => ({ ...dimension, reverseItemsConfirmed: true })),
      confirmation: { confirmed: true, confirmedAtUtc },
    })
    store.showToast("分析方案已确认；修改数据、需求或任一方案字段后需重新确认")
  }

  async function configureAmos() {
    if (!window.analysisBridge) return
    try {
      const configured = await window.analysisBridge.configureAmos()
      if (!configured.canceled) {
        setAmosStatus(await window.analysisBridge.getAmosStatus())
        store.showToast("Amos Engine 已配置")
      }
    } catch (error) {
      store.showToast(`Amos 配置失败: ${error instanceof Error ? error.message : "未知错误"}`, 8000)
    }
  }

  return (
    <div className="h-[calc(100vh-3.5rem)] min-w-0 overflow-x-hidden overflow-y-auto bg-muted/10">
      <div className="mx-auto w-full max-w-5xl min-w-0 px-4 py-6 sm:px-6 lg:py-10">
        <div className="mb-5 flex min-w-0 flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-primary">
              <Sparkles className="h-5 w-5 shrink-0" />
              <span className="text-sm font-medium">自然语言生成草案 · 人工确认后执行</span>
            </div>
            <h2 className="mt-1 text-2xl font-bold tracking-tight">AI 数据分析</h2>
            <p className="mt-1 break-words text-sm leading-6 text-muted-foreground">
              系统只负责生成可编辑草案；量表、反向题、人口学字段和模型由你确认后才进入科学管线。
            </p>
          </div>
          <Button variant="outline" size="sm" className="shrink-0 gap-1.5 self-start sm:self-auto" onClick={() => store.setPage("manual")}>
            <BarChart2 className="h-3.5 w-3.5" />
            手动分配变量
          </Button>
        </div>

        {!hasData ? (
          <Card className="min-w-0 overflow-hidden border-dashed">
            <CardContent className="flex flex-col items-center gap-3 px-4 py-14 text-center sm:px-6">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted">
                <Database className="h-7 w-7 text-muted-foreground/60" />
              </div>
              <div className="min-w-0">
                <p className="font-medium">先上传需要分析的数据</p>
                <p className="mt-1 break-words text-sm text-muted-foreground">支持 Excel 与 CSV；原始行只在本次任务运行期间临时使用。</p>
              </div>
              <Button className="gap-1.5" onClick={() => store.setPage("upload")}>
                <Upload className="h-4 w-4" />
                前往数据上传
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            <Card className="min-w-0 overflow-hidden border-primary/20 shadow-sm">
              <CardHeader className="min-w-0 pb-3">
                <div className="flex min-w-0 items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                    <Sparkles className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <CardTitle className="text-lg">第 1 步：描述分析需求</CardTitle>
                    <CardDescription className="mt-1 break-words leading-5">
                      修改需求会立即作废既有确认并重新生成方案草案
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="min-w-0 space-y-4">
                {window.analysisBridge && (
                  <div className="flex min-w-0 flex-col gap-2 rounded-lg border bg-background px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-center gap-2 text-xs">
                      {amosReady ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" /> : <ServerCog className="h-4 w-4 shrink-0 text-amber-600" />}
                      <div className="min-w-0">
                        <p className="font-medium text-foreground">{amosReady ? "本机 Amos Engine 已就绪" : "AMOS 分析需要先配置安装目录"}</p>
                        <p className="truncate text-muted-foreground" title={amosStatus?.amosHome ?? undefined}>
                          {amosStatus?.amosHome ?? (amosStatus?.bridgeReady === false ? "AMOS Bridge 尚未构建" : "请选择包含 Amos.EngineLib.dll 的目录")}
                        </p>
                      </div>
                    </div>
                    <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={configureAmos}>
                      {amosReady ? "更换目录" : "配置 Amos"}
                    </Button>
                  </div>
                )}
                <textarea
                  aria-label="分析需求"
                  value={aiPrompt}
                  onChange={(event) => setAiPrompt(event.target.value)}
                  className="min-h-[132px] w-full min-w-0 resize-y rounded-lg border bg-background px-3 py-2 text-sm leading-6 outline-none focus:ring-2 focus:ring-primary/30"
                  placeholder="例如：只做信度；SAT和VAL为自变量、LOY为因变量……"
                />
              </CardContent>
            </Card>

            {draftPlan && smartPlan && (
              <Card className="min-w-0 overflow-hidden" data-testid="scientific-plan-review">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <ShieldCheck className="h-5 w-5 text-primary" />
                    第 2 步：复核结构化分析方案
                  </CardTitle>
                  <CardDescription>未分类列默认排除；系统不会自动把姓名、联系方式或开放文本写入报告。</CardDescription>
                </CardHeader>
                <CardContent className="space-y-5">
                  {draftPlan.humanConfirmations.length > 0 && (
                    <div className="space-y-1 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-xs text-destructive" data-testid="plan-blocking-issues">
                      {draftPlan.humanConfirmations.map((issue) => (
                        <p key={issue} className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{issue}</p>
                      ))}
                    </div>
                  )}

                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="space-y-1 text-xs font-medium">
                      报告标题
                      <input
                        aria-label="报告标题"
                        value={draftPlan.title}
                        onChange={(event) => editPlan((plan) => ({ ...plan, title: event.target.value }))}
                        className="h-9 w-full rounded-md border bg-background px-3 text-sm font-normal"
                      />
                    </label>
                    <label className="space-y-1 text-xs font-medium">
                      样本 ID 列
                      <select
                        aria-label="样本 ID 列"
                        value={draftPlan.sampleIdColumn ?? ""}
                        onChange={(event) => editPlan((plan) => {
                          const sampleIdColumn = event.target.value || null
                          const demographics = plan.demographics.filter((item) => item.column !== sampleIdColumn)
                          return {
                            ...plan,
                            sampleIdColumn,
                            demographics,
                            excludedColumns: reconcileExcluded(plan, demographics, sampleIdColumn),
                          }
                        })}
                        className="h-9 w-full rounded-md border bg-background px-3 text-sm font-normal"
                      >
                        <option value="">不指定</option>
                        {state.currentData?.headers.map((header) => <option key={header} value={header}>{header}</option>)}
                      </select>
                    </label>
                  </div>

                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-semibold">量表范围与缺失规则</p>
                      <Badge variant={draftPlan.scale.confirmed ? "secondary" : "outline"}>{draftPlan.scale.confirmed ? "已确认" : "待确认"}</Badge>
                    </div>
                    <div className="grid gap-3 rounded-lg border bg-muted/20 p-3 sm:grid-cols-[8rem_8rem_minmax(0,1fr)]">
                      <label className="space-y-1 text-xs">最小值
                        <input aria-label="量表最小值" type="number" value={draftPlan.scale.min} onChange={(event) => updateScale("min", Number(event.target.value))} className="h-9 w-full rounded-md border bg-background px-3 text-sm" />
                      </label>
                      <label className="space-y-1 text-xs">最大值
                        <input aria-label="量表最大值" type="number" value={draftPlan.scale.max} onChange={(event) => updateScale("max", Number(event.target.value))} className="h-9 w-full rounded-md border bg-background px-3 text-sm" />
                      </label>
                      <div className="text-xs leading-5 text-muted-foreground">
                        <p className="font-medium text-foreground">完整题项维度均值</p>
                        <p>某维度任一题缺失时，该受访者的该维度得分记为缺失；相关按变量对删除。发布门：信度至少 max(30, 题项数×5)，相关每对至少 30，主成分结构检查至少 max(100, 题项数×5)，回归至少 max(30, 参数组数×10)。</p>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <p className="text-sm font-semibold">自动识别：维度、精确题项与反向题</p>
                    <div className="grid gap-3 md:grid-cols-2">
                      {draftPlan.dimensions.map((dimension) => (
                        <div key={dimension.id} className="min-w-0 rounded-lg border p-3">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline">{dimension.id}</Badge>
                            <input
                              aria-label={`${dimension.id} 维度名称`}
                              value={dimension.name}
                              onChange={(event) => editPlan((plan) => ({
                                ...plan,
                                dimensions: plan.dimensions.map((item) => item.id === dimension.id ? { ...item, name: event.target.value } : item),
                              }))}
                              className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm font-medium"
                            />
                          </div>
                          <p className="mt-2 text-[11px] leading-5 text-muted-foreground">勾选反向计分题；不勾选即明确确认“无反向题”。</p>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {dimension.items.map((item) => (
                              <label key={item} className="flex max-w-full cursor-pointer items-center gap-1 rounded-md border bg-background px-2 py-1 text-[11px]" title={item}>
                                <input
                                  type="checkbox"
                                  aria-label={`${item} 反向题`}
                                  checked={dimension.reverseItems.includes(item)}
                                  onChange={() => toggleReverseItem(dimension.id, item)}
                                />
                                <span className="max-w-48 truncate">{item}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <p className="text-sm font-semibold">人口学字段（默认全部不进入报告）</p>
                    <div className="flex flex-wrap gap-1.5 rounded-lg border bg-muted/20 p-3">
                      {smartPlan.demographics.filter((column) => column !== draftPlan.sampleIdColumn).length ? smartPlan.demographics
                        .filter((column) => column !== draftPlan.sampleIdColumn)
                        .map((column) => (
                          <label key={column} className="flex max-w-full cursor-pointer items-center gap-1.5 rounded-md border bg-background px-2 py-1.5 text-xs" title={column}>
                            <input
                              type="checkbox"
                              aria-label={`${column} 人口学字段`}
                              checked={draftPlan.demographics.some((item) => item.column === column)}
                              onChange={() => toggleDemographic(column)}
                            />
                            <span className="max-w-56 truncate">{column}</span>
                          </label>
                        )) : <span className="text-xs text-muted-foreground">没有可选的未分类字段</span>}
                    </div>
                    <p className="break-words text-[11px] leading-5 text-muted-foreground">
                      当前明确排除：{draftPlan.excludedColumns.length ? draftPlan.excludedColumns.join("、") : "无"}
                    </p>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="rounded-lg border bg-muted/20 p-3 text-xs leading-5">
                      <p><span className="font-medium">模型分配：</span>{smartPlan.modelLabel}</p>
                      {draftPlan.model.type === "parallel-mediation-with-direct-path-moderation" && (
                        <p className="mt-1 text-muted-foreground">Bootstrap={draftPlan.model.bootstrapSamples}；置信水平={draftPlan.model.confidenceLevel * 100}%</p>
                      )}
                    </div>
                    <div className="rounded-lg border bg-muted/20 p-3 text-xs leading-5">
                      <p className="font-medium">执行计划：</p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {draftPlan.analysisOrder.map((step) => <Badge key={step} variant="outline">{STEP_LABELS[step]}</Badge>)}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col gap-3 rounded-lg border border-primary/20 bg-primary/5 p-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-start gap-2 text-xs leading-5">
                      {planConfirmed ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> : <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-primary" />}
                      <p>
                        {planConfirmed
                          ? `方案已确认（${new Date(draftPlan.confirmation.confirmedAtUtc!).toLocaleString("zh-CN")}）。任何修改都会重新锁定执行。`
                          : planProblem ?? "请确认量表范围、反向题、人口学字段、模型和执行章节。"}
                      </p>
                    </div>
                    <Button type="button" variant={planConfirmed ? "outline" : "default"} onClick={confirmPlan} disabled={Boolean(planProblem)} className="shrink-0">
                      {planConfirmed ? "重新确认方案" : "确认分析方案"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            <Card className="min-w-0 overflow-hidden border-primary/20">
              <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 text-sm">
                  <p className="font-semibold">第 3 步：在本机科学管线执行</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">原始输入默认在成功或失败后立即删除；报告会附带不含原始行的任务溯源清单。</p>
                </div>
                <Button
                  onClick={() => draftPlan && store.runSmartAnalysis(aiPrompt, draftPlan)}
                  disabled={!hasData || state.isLoading || !planConfirmed || Boolean(planProblem) || (needsAmos && Boolean(window.analysisBridge) && !amosReady)}
                  className="min-h-11 shrink-0 gap-2"
                >
                  <WandSparkles className="h-5 w-5" />
                  <span>{state.isLoading ? "正在分析" : "一键分析"}</span>
                </Button>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  )
}
