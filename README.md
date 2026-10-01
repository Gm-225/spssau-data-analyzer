# AI 数据分析器

本地桌面问卷分析工具。主流程是：上传 Excel/CSV → 用自然语言生成分析草案 → 人工复核量表、反向题、人口学字段与模型 → 确认后运行本机科学计算 → 生成结构化结果、真实 Word/PDF 和任务追溯清单。

## 当前已跑通的自动化模型

- X：PP（感知个性化）
- Y：AA（广告回避）
- 并行中介：PC（隐私担忧）、PI（感知侵扰）
- 调节变量：PV（广告感知价值），调节 PP→AA 直接路径
- 统计内容：数据质量、频数、描述统计、Cronbach's α/CITC、KMO/Bartlett、主成分与 Varimax、Pearson 相关、并行中介 5000 次 Bootstrap、调节回归、简单斜率
- 报告：A4、宋体/黑体、编号章节、三线表、表后解读、模型图和调节图

AI 指令用于生成结构化草案，例如“只做信度分析”会生成只包含数据识别与信度的待确认方案。真正执行范围以操作者确认后的方案为准，提示词不会在后台静默改变已确认步骤。

V2 通用基础主线不再绑定固定变量名。题项列使用同一英文字母前缀和连续编号，例如 `SAT1`、`SAT2`、`VAL1`、`LOY1`；上传后可输入：

```text
请做完整分析：SAT和VAL为自变量，LOY为因变量；SAT=满意度，VAL=感知价值，LOY=忠诚度。
```

系统会为本次任务生成独立分析方案。量表默认建议 1–5，但必须人工确认；反向题逐维度确认；未分类列默认排除，只有显式选择的人口学字段才进入频数表。通用主线可输出描述统计、信度、主成分结构检查（相关矩阵 PCA + Varimax，成分数按人工确认维度固定）、按变量对删除缺失的相关、多元回归（含标准化 β 与 VIF）及按实际数值变化的论文文字。这里的结构检查不是公因子法，也不使用平行分析自动确定因子数。通用中介/调节、CFA/SEM 和 SmartPLS 仍按已验证引擎分阶段开放，不会用近似或固定数值代替真实结果。

## 本机 Amos 一键分析

当前固定 PP/AA/PC/PI/PV 问卷方案已经接入本机 IBM SPSS Amos Engine。首次使用可在“AI 分析助手”页点击“配置 Amos”，选择包含 `Amos.EngineLib.dll` 的安装目录；也可运行：

```powershell
npm run amos:configure -- -AmosHome "D:\工作\spss"
```

上传题项级 Excel/CSV 后，需在需求中明确 PP/AA/PC/PI/PV 的固定角色并请求 AMOS/CFA/结构方程，复核精确题项列表后再确认执行。输出包含结构化 JSON、Amos 原始 XHTML、CFA/SEM 模型图、三线表、DOCX 和 PDF。

本功能不会把 IBM Amos 文件装进本应用，必须使用你自己已安装且可用的 Amos。当前 V1 只支持 PP4、AA3、PC4、PI5、PV4 的固定模型；PV 调节仍采用观测合成分数 OLS，不是潜变量交互。Likert 题项按近似连续变量使用 ML，不能把本功能表述为替代 Amos 的全部高级能力。

AMOS 专项验证：

```powershell
npm run test:amos
```

## 运行

最简单的方式是双击桌面快捷方式 `AI数据分析器.lnk`。

开发与验证命令：

```powershell
npm install
npm run build
npm start
npm test
npm run test:safety
npm run test:e2e
```

## 技术结构

- 桌面端：Electron + React + TypeScript + Vite
- 科学计算：项目本地 Python 环境，NumPy / pandas / SciPy
- 文档：python-docx 生成真实 DOCX，LibreOffice 转换 PDF
- 自动化接口：Electron IPC；`services/analysis_api` 与 `n8n/` 作为后续外围流程连接能力
- 任务追溯：每个科学任务生成 `job-manifest.json`，记录版本、输入/方案/产物哈希、实际范围和隐私状态，不记录原始行
- 分析记忆：默认关闭；只有显式设置 `ANALYZER_ENABLE_CASE_MEMORY=1` 才写入脱敏的任务哈希摘要

## 准确性边界

当前问卷样本已用独立公式复核 α、KMO 和回归系数，并验证固定种子的 Bootstrap 可复现。手动工作台仅开放描述统计“基础预览”；相关、回归、信效度、EFA/CFA、SEM、中介、调节、聚类等历史实现均被中央守卫阻断，不能生成交付结果。

原始 `input.json` 默认只在任务运行期间存在，成功或失败后立即删除；案例记忆默认关闭。报告、确认方案和 manifest 会保留在本机任务目录，“移出列表”不等于删除磁盘文件。完整规则见 [隐私与留存](docs/PRIVACY.md)。

AMOS synthetic 基准使用同一本机 Engine 得到 χ²(163)=200.797、CFI=.986、TLI=.984、RMSEA=.038；GFI=.890、AGFI=.858 和精确拟合检验 p=.023 提醒模型并非“所有指标都通过”。报告中的 RMR 是非标准化 RMR，不应写成 SRMR。正式客户数据上线前，仍应针对实际模型做一次人工复核。
