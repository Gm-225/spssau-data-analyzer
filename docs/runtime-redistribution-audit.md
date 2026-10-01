# 科学运行时依赖与再分发审计（T-20260717-10）

审计对象是固定 PP/AA/PC/PI/PV pipeline 的 Windows 离线 sidecar，不代表对仓库全部实验功能的法律意见。版本以 `services/runtime-requirements.txt` 和实际构建 manifest 为准。

## 方案结论

采用 PyInstaller `onedir` 冻结独立科学 sidecar；不分发完整 `.venv`，不依赖客户机 Python，不随包分发 LibreOffice。PDF 使用开源 ReportLab 在进程内生成。PyInstaller 官方说明其 GPL 例外允许用 PyInstaller 打包商业应用，生成的 bundle 可使用应用自己的许可证；CPython 的 PSF 许可允许再分发，但必须保留许可与版权声明。

官方依据：

- PyInstaller 许可与商业 bundle 例外：<https://pyinstaller.org/en/stable/license.html>
- Python 历史与 PSF 许可：<https://docs.python.org/3/license.html>
- ReportLab 开源 Toolkit 为 BSD：<https://docs.reportlab.com/developerfaqs/>

## 实际运行依赖

| 组件 | 固定版本 | 用途 | 许可口径 | 处理 |
|---|---:|---|---|---|
| CPython | 3.12.13 | sidecar 解释器/标准库 | PSF License | PyInstaller 收集；随包保留许可 |
| NumPy | 2.5.1 | 线性代数、Bootstrap | BSD-3-Clause + wheel 内第三方声明 | 保留 wheel LICENSE/NOTICE |
| pandas | 3.0.3 | 表格与维度得分 | BSD-3-Clause | 保留许可 |
| SciPy | 1.18.0 | 分布、检验 | BSD-3-Clause；wheel 可能含 BLAS/LAPACK 等第三方组件 | 保留 wheel LICENSE/NOTICE 与构建清单 |
| openpyxl | 3.1.5 | pandas XLSX 引擎 | MIT | 保留许可 |
| python-docx | 1.2.0 | DOCX | MIT | 保留许可 |
| lxml | 6.1.1 | python-docx 依赖 | BSD-3-Clause | 保留许可 |
| Matplotlib | 3.11.0 | 模型图、调节图 | Matplotlib License（BSD 兼容） | 保留许可及数据文件 |
| Pillow | 12.3.0 | Matplotlib/ReportLab 图像 | MIT-CMU | 保留许可 |
| ReportLab | 5.0.0 | 进程内 PDF | BSD | 保留许可；不使用 GPL 的 pyRXP |
| 开源中文字体 | 构建 manifest 固定 | PDF/PNG 中文字形 | SIL OFL 1.1 | 字体文件与 OFL 文本随包，不使用 Windows 商业字体副本 |

`pypdfium2` 只用于外部验收渲染，不进入产品 sidecar；`statsmodels`、`patsy` 未被固定 pipeline 导入，也不进入产品 sidecar。PyInstaller 与 hooks 是构建工具，不把完整工具环境作为产品运行时分发。

## 必须随包的证据

- `runtime-manifest.json`：构建 Python、PyInstaller、平台、每个 runtime 文件 SHA-256、总大小。
- `licenses/`：本应用许可、Python、PyInstaller 构建说明、各直接/传递二进制包许可与字体 OFL。
- `runtime-package-inventory.json`：产品 sidecar 实际收集的 Python distributions 与版本。
- electron-builder 自带的 Electron/Chromium 许可文件继续保留，不删除。

## 已知边界

- 本次不做代码签名，也不作正式外部发布；未签名安装包可能触发 SmartScreen。
- 数值 wheel 可能包含多个上游二进制组件，正式销售前仍应对最终 onedir 中的许可文件做一次人工法务清单复核。
- 项目 `package.json` 声明 MIT，但仓库原先缺少根 `LICENSE`；本 Issue 只补齐安装包所需许可材料，不替用户决定未来商业授权条款。

