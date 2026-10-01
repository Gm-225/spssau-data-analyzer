# Issue 008 - 发布产物来源 E2E 闭环

type: bug
status: verified_waiting_controller_recheck
main_flow: yes
user_pain: 安装包和便携版虽然能生成，但既有自动验收实际回退到 win-unpacked，无法证明用户拿到的两个发布入口真的可用。
owner: Codex / T-20260717-10

## 产品任务

目标用户只会双击安装后的应用或 Portable.exe。验收必须从这两个真实发布入口启动，记录实际进程与文件来源，并证明至少一条真实分析流程能在各自来源内离线生成 JSON、DOCX、PDF。任何指定来源缺失、启动失败或被悄悄替换成 `release\win-unpacked` 都必须 hard fail。

## 独立验收退回原因

1. 原脚本虽然静默安装 NSIS，但没有设置 `ANALYZER_PACKAGED_APP_DIR`；`e2e-packaged.mjs` 回退到 `release\win-unpacked`。
2. Portable 只有文件、大小与哈希，没有从 Portable.exe 本体启动的用户主流程证据。
3. manifest/运行时损坏只有静态校验实现，没有可丢弃副本中的动态破坏证据。
4. 历史 `outputs` 快照存在编码乱码，不能稳定通过标准 JSON 解析。

## 来源契约

### NSIS

- 在全新 ASCII 证据根静默安装，安装目录必须位于该证据根内。
- 脚本必须解析并验证实际安装目录及 `AI数据分析器.exe`，计算 SHA-256。
- E2E 必须通过显式来源参数/环境变量接收该安装目录；禁止缺省回退。
- `sourceAppDir`、启动 EXE、报告目录和进程证据必须全部指向本次 NSIS 安装实体。

### Portable

- 入口必须是 `AI-Data-Analyzer-*-Portable.exe` 本体，而不是预先解包目录。
- 允许受控测试模式传递远程调试参数，但必须记录 wrapper 的路径、PID、父子关系、SHA-256，以及它实际启动的 Electron EXE 路径、PID、父 PID 和 SHA-256。
- 证据必须能区分 Portable wrapper 与内部 Electron 进程；禁止以 `win-unpacked` 代替。

## 场景矩阵

| 来源 | 必跑主流程 | 错误/完整性 | 科学与文档 | 网络与伪报告 |
|---|---|---|---|---|
| NSIS 实际安装目录 | synthetic XLSX 完整分析，生成 JSON/DOCX/PDF | 无效需求；可丢弃副本动态篡改 manifest/受保护运行时后拒绝分析 | 固定 seed、KMO、α、OLS、Bootstrap；完整报告结构/页数 | 外联 0；失败产物 0 |
| Portable.exe 本体 | synthetic CSV 只做信度，生成 JSON/DOCX/PDF | 缺少 AA3 | α 与完整分析一致；限定章节不泄漏、文档可打开 | 外联 0；失败产物 0 |

如执行成本允许，可在两个来源重复更多场景；但以上每行不得被另一来源替代。

## 验收标准

- [x] 一键脚本默认同时验证 NSIS 与 Portable；任一来源不存在或来源证据不一致即非零退出。
- [x] NSIS 的 `sourceAppDir`、实际 EXE、SHA-256 明确来自本次全新安装目录，不含 `release\win-unpacked`。
- [x] Portable 以 wrapper 本体启动，并记录 wrapper/内部 Electron 的路径、PID/父子关系和 SHA-256。
- [x] 两个来源各自至少生成一套真实 JSON/DOCX/PDF；矩阵合计覆盖完整分析、只做信度、无效需求、缺列。
- [x] 在可丢弃 NSIS 副本动态篡改 manifest 或受保护文件，分析被明确拒绝且报告产物为 0；正式安装源和 release 不修改。
- [x] 两来源均 PATH 隔离、代理阻断、外部网络请求 0，且伪报告数为 0。
- [x] 科学基准、固定种子复现和文档/PDF QA 通过。
- [x] `outputs` 前后快照以 UTF-8 无 BOM 或明确 UTF-8 写入，现场 PowerShell `ConvertFrom-Json` 与 Node `JSON.parse` 均成功，前后文件逐字节一致。
- [x] 保存新的 ASCII 证据根、总耗时、来源矩阵、产物哈希、进程链、截图与机器日志。
- [x] 保留既有失败及候选 run；不覆盖历史证据、不读取客户数据、不写正式 `data/reports`/`data/knowledge`。

## 默认单命令

```powershell
npm run verify:installable
```

该命令必须真实构建发布产物、全新安装 NSIS、从 Portable.exe 本体启动、执行双来源矩阵、动态破坏可丢弃副本、验证 UTF-8 证据并汇总结果。不得依赖额外参数才能避免 `win-unpacked` 回退。

## 安全与边界

- 只用 `examples/` 或脚本生成且明确标注 synthetic 的数据。
- 动态破坏只发生在新的可丢弃安装副本，验证后清理副本；不得修改 release、正式安装目录或源码运行时。
- 本 Issue 不扩张通用问卷、云端、会员、支付、自进化、n8n、营销、签名或外部发布。

## 验证证据

- 最终候选证据根：`D:\Desktop\Codex-Projects\AIAV\T10\r8-20260717-123106-p28908`。
- 默认单命令：`npm run verify:installable`；10 个阶段全部通过，退出码 0，总耗时 472.853 秒。
- Setup：184,051,461 B，SHA-256 `40CB61FBA249AA83E5917B573FBDF1F8C8C0651E9CD4465443B81BE4154BBF0A`。
- NSIS 实际安装源：`nsis-installed\AI数据分析器.exe`，SHA-256 `A57A6B8B653C7312CB775FF9D6EFB86D1CD81F440BFD2BFF171E9AFCBDBFFEE6`；`win-unpacked` 未用于 E2E。
- Portable wrapper：`release\AI-Data-Analyzer-2.0.1-x64-Portable.exe`，SHA-256 `3D3DE6FCC01542A2CAA45BAE187F656E5AB51F19F6DFC4196EE4CD6779D658D5`；wrapper PID 15424 启动内部 Electron PID 4836，父子链与两个文件哈希均落盘。
- NSIS 完整报告哈希：JSON `8D6513401A6CFB56DB5D820D5225353F98BB4CD8A48E602FAB4F2BBAB64E3F5A`；DOCX `0899DBBD8F52E9F339C75669E625FD88C012058430C4A7C046BF07EA887BC6FA`；PDF `0E0758C1E78156BE1707A07B3E74E6EFD3E8F07058812DDF7C2B37E5C699C3E1`。
- Portable 仅信度报告哈希：JSON `FFEB11C175195586987D9D90C5DE7A7F74FAD092E926D1C7BA9F79F51822EEF3`；DOCX `646BA247F10838A811E394FC0A8FA3B6136ECE67C9FC38914812A8098D06415C`；PDF `3C55AC0BA5F55FA0D884B1A2E150C7744BDDFE20DFBBDF953053093992F9081B`。
- 动态破坏：受保护 pipeline 从 `E73D9F7D42E42DFF46CD79EFF3A2B57F4724853A33BA8BA1EA5884AE22686762` 变为 `9A9B8B3A0C3043D07BB1ACA96F4AE0F4538528A961F517DC948AB4DB38103B5F`；应用明确拒绝，报告 0，可丢弃副本已删除，正式安装资源未变。
- 科学复现：seed 20260712、Bootstrap 5000；`seed/reliability/kmo/outcomeModel/indirect/slopes` 两次指纹均为 `891144508FB310E4A8776E84878C43E42B60A422EE71D1F1116EDED69AF96724`。
- 文档 QA：88 项通过、0 失败、0 警告；完整 PDF 8 页、限定 PDF 1 页，DOCX 结构/渲染、三线表、中文字体、模型图和调节图通过。
- 三个场景外联均为 0、伪报告均为 0；33 个 JSON 现场标准解析通过且无 BOM；三组历史 `outputs` 快照前后逐字节一致。
- 独立只读复验结论：技术验收通过，可标记“发布候选版，待总控复验”；产物未签名，仍不得外发。
