export interface DropZoneConfig {
  id: string
  label: string
  multiple: boolean
  name?: string
}

export interface MethodConfig {
  id: string
  title: string
  description: string
  category: string
  dropZones: DropZoneConfig[]
  dynamicZone?: { idPrefix: string; labelPrefix: string; max: number }
  isTextMode?: boolean
  placeholder?: string
  automationReady?: boolean
  trustTier: "verified" | "basic-preview" | "blocked"
  trustLabel: "已验证" | "基础预览" | "尚未进入可信主线"
  trustDescription: string
}

type MethodDefinition = Omit<MethodConfig, "trustTier" | "trustLabel" | "trustDescription">

const BASIC_PREVIEW_METHODS = new Set(["descriptive"])
// 方法已通过独立参考软件交叉核验(2026-09-16)：CFA 标准化载荷/χ²/df/CFI/TLI/RMSEA/SRMR
// 与 semopy(ML) 在 2因子/3因子/5因子 共 39 项载荷上逐位对数一致
const VERIFIED_METHODS = new Set(["cfa"])

export const methodCategories = [
  {
    name: "描述统计",
    methods: ["frequency", "descriptive"],
  },
  {
    name: "相关与回归",
    methods: ["correlation", "partial-correlation", "linear-regression", "binary-logit"],
  },
  {
    name: "差异检验",
    methods: ["ttest-independent", "ttest-paired", "anova", "chi-square"],
  },
  {
    name: "信效度分析",
    methods: ["reliability", "validity", "efa", "cfa"],
  },
  {
    name: "结构方程",
    methods: ["mediation", "moderation", "path-analysis", "sem"],
  },
  {
    name: "其他方法",
    methods: ["cluster", "ipa"],
  },
]

export function getMethodInfo(methodId: string): MethodConfig {
  const methods: Record<string, MethodDefinition> = {
    frequency: { id: "frequency", title: "频数分析", description: "统计变量的数值分布情况", category: "描述统计", dropZones: [{ id: "frequency-variables", label: "分析变量", multiple: true }] },
    descriptive: { id: "descriptive", title: "描述性分析", description: "计算平均值、标准差等统计量", category: "描述统计", dropZones: [{ id: "analysis-variables", label: "分析变量", multiple: true }], automationReady: true },
    correlation: { id: "correlation", title: "相关分析", description: "分析变量之间的相关性", category: "相关与回归", dropZones: [{ id: "analysis-variables", label: "分析变量", multiple: true }] },
    "partial-correlation": { id: "partial-correlation", title: "偏相关分析", description: "控制某些变量的影响后，分析其他变量间的净相关关系", category: "相关与回归", dropZones: [{ id: "variables", label: "分析变量", multiple: true }, { id: "control", label: "控制变量", multiple: true }] },
    "linear-regression": { id: "linear-regression", title: "线性回归", description: "研究一个或多个自变量对因变量的影响关系", category: "相关与回归", dropZones: [{ id: "y-variable", label: "因变量(Y)", multiple: false }, { id: "x-variables", label: "自变量(X)", multiple: true }] },
    "binary-logit": { id: "binary-logit", title: "二元Logit回归", description: "因变量为二分类(0/1)时的回归分析", category: "相关与回归", dropZones: [{ id: "y-variable", label: "因变量(二分类)", multiple: false }, { id: "x-variables", label: "自变量(X)", multiple: true }] },
    "ttest-independent": { id: "ttest-independent", title: "独立样本T检验", description: "检验两组独立样本的均值是否存在显著差异", category: "差异检验", dropZones: [{ id: "y-variable", label: "检验变量(数值)", multiple: true }, { id: "x-variable", label: "分组变量(分类)", multiple: true }] },
    "ttest-paired": { id: "ttest-paired", title: "配对样本T检验", description: "检验配对样本(如实验前后)的均值是否存在显著差异", category: "差异检验", dropZones: [{ id: "pair1", label: "配对变量1", multiple: true }, { id: "pair2", label: "配对变量2", multiple: true }] },
    anova: { id: "anova", title: "方差分析", description: "检验多个分类组间的数值均值是否存在显著差异", category: "差异检验", dropZones: [{ id: "y-variable", label: "因变量(数值)", multiple: true }, { id: "x-variable", label: "分组变量(分类)", multiple: true }] },
    "chi-square": { id: "chi-square", title: "卡方检验", description: "分析两个分类变量之间是否相互独立", category: "差异检验", dropZones: [{ id: "x-variable", label: "X变量(分类)", multiple: true }, { id: "y-variable", label: "Y变量(因变量/分类)", multiple: false }] },
    reliability: { id: "reliability", title: "信度分析", description: "分析测量结果的一致性，使用Cronbach α系数", category: "信效度分析", dropZones: [{ id: "analysis-variables", label: "分析变量", multiple: true }] },
    validity: { id: "validity", title: "效度分析", description: "评估问卷量表的有效性，含KMO与Bartlett检验", category: "信效度分析", dropZones: [{ id: "analysisVars", label: "分析项", multiple: true }] },
    efa: { id: "efa", title: "探索性因子分析(EFA)", description: "探索数据内部潜在的因子结构", category: "信效度分析", dropZones: [{ id: "variables", label: "分析变量", multiple: true }] },
    cfa: { id: "cfa", title: "验证性因子分析(CFA)", description: "检验所假设的因子结构模型与实际数据的拟合程度", category: "信效度分析", dropZones: [{ id: "factor1", label: "因子1", multiple: true, name: "因子 1" }], dynamicZone: { idPrefix: "factor", labelPrefix: "因子", max: 8 } },
    mediation: { id: "mediation", title: "中介作用", description: "分析X对Y的影响是否通过中介变量M来传递", category: "结构方程", dropZones: [{ id: "x-variable", label: "自变量(X)", multiple: true }, { id: "m-variable", label: "中介变量(M)", multiple: true }, { id: "y-variable", label: "因变量(Y)", multiple: false }, { id: "control-variables", label: "控制变量", multiple: true }] },
    moderation: { id: "moderation", title: "调节作用", description: "分析X对Y的影响是否因调节变量M的不同而产生变化", category: "结构方程", dropZones: [{ id: "x-variable", label: "自变量(X)", multiple: false }, { id: "m-variable", label: "调节变量(M)", multiple: false }, { id: "y-variable", label: "因变量(Y)", multiple: false }] },
    "path-analysis": { id: "path-analysis", title: "路径分析", description: "分析变量间的直接与间接影响路径", category: "结构方程", dropZones: [{ id: "variables", label: "分析变量", multiple: true }] },
    sem: { id: "sem", title: "结构方程模型(AMOS)", description: "直接粘贴AMOS输出的文本结果，自动生成标准化报告", category: "结构方程", dropZones: [], isTextMode: true, placeholder: "请在此处粘贴AMOS输出的完整分析结果..." },
    cluster: { id: "cluster", title: "聚类分析", description: "将样本划分为具有相似特征的若干类别", category: "其他方法", dropZones: [{ id: "variables", label: "聚类变量", multiple: true }] },
    ipa: { id: "ipa", title: "IPA分析", description: "重要性-表现程度分析", category: "其他方法", dropZones: [{ id: "importance", label: "重要性变量", multiple: true }, { id: "performance", label: "表现变量", multiple: true }] },
  }
  const definition = methods[methodId] || {
    id: methodId,
    title: "未知方法",
    description: "请选择一个有效的分析方法",
    category: "",
    dropZones: [],
  }
  if (VERIFIED_METHODS.has(methodId)) {
    return {
      ...definition,
      trustTier: "verified",
      trustLabel: "已验证",
      trustDescription: "该方法已于 2026-09-16 通过独立参考软件(semopy, 极大似然)交叉核验：2/3/5 因子模型共 39 项标准化载荷、χ²、df、CFI、TLI、RMSEA、SRMR 全部对数一致，可用于正式报告。",
    }
  }
  if (BASIC_PREVIEW_METHODS.has(methodId)) {
    return {
      ...definition,
      trustTier: "basic-preview",
      trustLabel: "基础预览",
      trustDescription: "仅用于数据初看和人工复核，不等同于正式科学报告，不支持因果或模型结论。",
    }
  }
  return {
    ...definition,
    trustTier: "blocked",
    trustLabel: "尚未进入可信主线",
    trustDescription: "该方法尚未完成科学基线、边界条件和独立验证，当前版本禁止执行。",
  }
}
