# Issue 004 - 问卷分析方案与并行中介调节模型

type: feature
status: done
main_flow: yes
owner: main

## 用户痛点

统计软件无法仅凭 Excel 判断维度、编码和研究路径，人工每次都要重新配置，AI 自由猜测又不可审计。

## 已确认模型

- X：PP 感知个性化
- Y：AA 广告回避
- 并行中介：PC 隐私担忧、PI 感知侵扰
- 调节变量：PV 广告感知价值
- 调节路径：PP → AA 的直接路径
- 等价结构：带并行中介的 PROCESS Model 5

## 验收标准

- [x] 人口学编码、量表范围、维度和路径写入版本化 JSON。
- [x] 明确均值中心化 PP、PV，并构造 PP×PV。
- [x] 明确两条 Bootstrap 间接效应和直接路径调节效应。
- [x] 使用 NumPy/SciPy/pandas 科学计算管线，不复用前端演示性中介/调节代码。
- [x] 输出 a1、a2、b1、b2、条件直接效应、两条间接效应及总间接效应。
- [x] 输出 PV 均值及 ±1SD 的简单斜率与交互图。
- [x] 5000 次 Bootstrap 在固定随机种子下可复现。
- [x] 报告核心数字可反查到 `analysis-result.json` 的 `raw` 字段。

## 验证

- 配置：`examples/questionnaire-plan.json`
- 统计验证：`npm run test:scientific`；使用独立 NumPy 公式复核 α、KMO 与 OLS，并重复运行 Bootstrap 对比。
- 当前基准：KMO=0.8443105453；PP α=0.8215637515；交互项 B=0.0158222642。
