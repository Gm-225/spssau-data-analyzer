# Issue 011 - 独立 SEM 引擎 V1

type: feature
status: inbox
main_flow: no
user_pain: 当目标电脑没有可用的本机 Amos 时，仍可能需要可再分发的独立 SEM 引擎；它不能冒充或承诺逐小数位复现 Amos。
owner: Codex / T-20260717-15

## 产品任务

用户上传题项级 Excel/CSV，用自然语言说明或确认潜变量、测量题项和结构路径，点击一次分析。应用使用随包的开源 SEM 引擎完成真实估计，生成结构化 JSON、模型图、三线表、DOCX 和 PDF，并明确标注“独立 SEM 引擎”，不冒充 IBM SPSS Amos。

## 2026-07-17 路线决策

- 用户已配置并选择继续使用本机官方 Amos；主线由 Issue 010 / T-20260717-14 承担。
- 本 Issue 暂停回到 inbox，不是完成状态；semopy 未接入项目、未进入 requirements、运行时或发布包。
- 只有未来明确需要“没有 Amos 也能运行”时再重新排期，并单独完成许可、科学基准和品牌口径验收。

## 引擎决策

- 首选 semopy 2.3.11：MIT 许可、Python 原生，适合当前 PyInstaller 科学 sidecar；复用现有 NumPy/pandas/SciPy。
- 数值解释采用 SEM 通用定义；以 semopy 官方示例和独立公式/第二引擎作科学基准。
- 不读取、执行或分发任何 AMOS 授权绕过材料。

## V1 主线

- 固定 synthetic 模型：PP、AA、PC、PI、PV 五个潜变量及其题项。
- 测量模型：每个题项只加载到指定潜变量；潜变量之间允许协方差。
- 结构模型：PP → PC、PI、AA；PC/PI → AA；V1 暂不实现潜变量交互调节，保留现有观测合成分数调节章节。
- 输出：收敛/可识别状态、样本量、χ²/df/p、GFI/AGFI/RMSEA/NFI/CFI/TLI、AIC/BIC、标准化/非标准化载荷与路径、SE/z/p、R²、AVE/CR、Bootstrap 直接/间接/总效应、路径图。
- 模板兼容项 IFI/RFI/PGFI/SRMR 只有在定义和基准验证完成后才输出；不得填固定演示值。

## 验收门槛

- [ ] `npm run test:sem` 使用 synthetic 数据运行真实 CFA/SEM，固定输入的关键结果可复现。
- [ ] 结果无固定拟合值；改变数据后参数和拟合度随之变化。
- [ ] JSON 含引擎名/版本、模型语法、收敛状态、估计器和数据处理说明。
- [ ] DOCX/PDF 覆盖模型图、拟合度、测量模型、结构路径和 Bootstrap 中介表；中文/三线表/页数渲染通过。
- [ ] 无效模型、缺列、样本不足、不收敛/非正定时报告产物 0，错误可操作。
- [ ] Electron AI 页可识别“做 CFA/SEM/结构方程”，展示模型确认摘要并调用科学 sidecar。
- [ ] PyInstaller/NSIS/Portable 离线运行，不依赖系统 Python、R、AMOS 或网络。
- [ ] 现有 PP/AA/PC/PI/PV 交付主线与历史 `outputs` 完整性不回退。

## 不包含

- 与 AMOS 逐小数位一致的承诺或 AMOS 品牌输出。
- Bayesian、潜类、增长、多层、多组不变性、类别变量 WLSMV。
- 自动根据修正指数放开路径。
- 潜变量交互项；后续单独验证后再进入。

## 安全与许可

- 仅使用 synthetic/官方公开示例；不得读取客户数据。
- semopy 及新增依赖必须进入再分发清单、许可目录和 runtime manifest。
- 失败时不得回退到前端演示性 CFA/SEM。
