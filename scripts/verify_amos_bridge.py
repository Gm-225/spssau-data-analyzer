from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd


ROOT = Path(__file__).resolve().parents[1]
SAMPLE = ROOT / "examples" / "synthetic-questionnaire-seed20260717.xlsx"
PLAN = ROOT / "examples" / "questionnaire-plan.json"
BRIDGE = ROOT / "build" / "amos-bridge" / "amos-bridge.exe"
EXPECTED_ENGINE_SHA256 = "347c2a654ffc6a638ae85d7f85d0f4815df47c1ccf316b5119233a304c476edb"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="只使用 synthetic 样例复核本机 IBM SPSS Amos Engine 桥接")
    parser.add_argument("--amos-home", help="本机 Amos 安装目录；默认读取应用配置")
    parser.add_argument("--bootstrap", type=int, default=100, help="快速复核的 Amos Bootstrap 次数")
    parser.add_argument("--seed", type=int, default=20260717)
    parser.add_argument("--evidence-root", help="新证据目录；不得指向历史 outputs")
    return parser.parse_args()


def read_amos_home(explicit: str | None) -> Path:
    if explicit:
        return Path(explicit).expanduser().resolve()
    configured = os.environ.get("ANALYZER_AMOS_HOME", "").strip() or os.environ.get("AMOS_HOME", "").strip()
    if configured:
        return Path(configured).expanduser().resolve()
    local_app_data = Path(os.environ.get("LOCALAPPDATA", ""))
    config_path = local_app_data / "AI-Data-Analyzer" / "amos-engine.json"
    if not config_path.is_file():
        raise RuntimeError(f"未找到 Amos 配置：{config_path}；请先运行 npm run amos:configure")
    payload = json.loads(config_path.read_text(encoding="utf-8-sig"))
    return Path(str(payload.get("amosHome", ""))).expanduser().resolve()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def tree_snapshot(root: Path) -> list[dict[str, Any]]:
    if not root.exists():
        return []
    return [
        {
            "path": path.relative_to(root).as_posix(),
            "size": path.stat().st_size,
            "sha256": sha256(path),
        }
        for path in sorted(item for item in root.rglob("*") if item.is_file())
    ]


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    json.loads(path.read_text(encoding="utf-8"))


def cleanup_bridge_temps(case_dir: Path) -> None:
    for candidate in case_dir.glob(".amos-temp-*"):
        require(candidate.is_dir() and candidate.parent == case_dir, f"拒绝清理意外路径：{candidate}")
        shutil.rmtree(candidate)


def run(command: list[str], *, env: dict[str, str] | None = None, timeout: int = 300) -> dict[str, Any]:
    started = time.perf_counter()
    process = subprocess.run(
        command,
        cwd=ROOT,
        env=env,
        text=True,
        encoding="utf-8",
        errors="replace",
        capture_output=True,
        timeout=timeout,
        check=False,
    )
    return {
        "command": command,
        "returnCode": process.returncode,
        "durationSeconds": round(time.perf_counter() - started, 3),
        "stdout": process.stdout,
        "stderr": process.stderr,
    }


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def close(actual: float, expected: float, tolerance: float, label: str) -> None:
    require(abs(float(actual) - expected) <= tolerance, f"{label} 异常：{actual}，期望 {expected}±{tolerance}")


def parameter(payload: dict[str, Any], source: str, target: str) -> dict[str, Any]:
    matches = [row for row in payload["parameters"] if row["source"] == source and row["target"] == target]
    require(len(matches) == 1, f"路径 {source}→{target} 数量异常：{len(matches)}")
    return matches[0]


def bridge_command(
    amos_home: Path,
    input_path: Path,
    output_path: Path,
    raw_output: Path,
    bootstrap: int,
    seed: int,
) -> list[str]:
    return [
        str(BRIDGE),
        "--amos-home", str(amos_home),
        "--input", str(input_path),
        "--sheet", "data",
        "--output", str(output_path),
        "--raw-output", str(raw_output),
        "--bootstrap", str(bootstrap),
        "--seed", str(seed),
    ]


def assert_baseline(payload: dict[str, Any]) -> dict[str, Any]:
    engine = payload["engine"]
    status = payload["status"]
    fit = payload["fit"]
    require(engine["name"] == "IBM SPSS Amos Engine", "Engine 名称异常")
    require(engine["engineDllSha256"].lower() == EXPECTED_ENGINE_SHA256, "本机 Amos.EngineLib.dll 哈希与已验证版本不一致")
    require(engine["redistributedByAnalyzer"] is False, "分析器不得声称再分发 IBM Engine")
    require(status["returnCode"] == 0 and status["stable"] and status["admissible"], "Amos 模型未稳定得到可接受解")
    require(status["sampleSize"] == 160 and status["observedVariables"] == 20, "Amos 样本量或观测变量数异常")
    close(fit["CMIN"], 200.797, 0.001, "CMIN")
    require(fit["DF"] == 163, f"DF 异常：{fit['DF']}")
    close(fit["CMIN/DF"], 1.232, 0.001, "CMIN/DF")
    close(fit["CFI"], 0.986, 0.001, "CFI")
    close(fit["TLI"], 0.984, 0.001, "TLI")
    close(fit["RMSEA"], 0.038, 0.001, "RMSEA")

    pp_pc = parameter(payload, "PP", "PC")
    pp_pi = parameter(payload, "PP", "PI")
    pp_aa = parameter(payload, "PP", "AA")
    pv_aa = parameter(payload, "PV", "AA")
    pp2 = parameter(payload, "PP", "PP2")
    close(pp_pc["estimate"], 0.5546172002530827, 1e-9, "PP→PC B")
    close(pp_pc["standardized"], 0.5719895373792975, 1e-9, "PP→PC β")
    close(pp_pi["estimate"], 0.5344733654371658, 1e-9, "PP→PI B")
    close(pp_aa["estimate"], 0.2367679545231359, 1e-9, "PP→AA B")
    close(pp_aa["standardError"], 0.088, 1e-12, "PP→AA SE")
    close(pp_aa["pValue"], 0.007, 1e-12, "PP→AA p")
    close(pv_aa["standardized"], -0.18554184230923676, 1e-9, "PV→AA β")
    close(pp2["standardError"], 0.068, 1e-12, "PP2 loading SE")
    close(pp2["criticalRatio"], 15.086, 1e-12, "PP2 loading C.R.")
    return {
        "engineSha256": engine["engineDllSha256"],
        "fit": {key: fit[key] for key in ("CMIN", "DF", "CMIN/DF", "CFI", "TLI", "RMSEA")},
        "paths": {
            "PP->PC": {"B": pp_pc["estimate"], "beta": pp_pc["standardized"]},
            "PP->PI": {"B": pp_pi["estimate"], "beta": pp_pi["standardized"]},
            "PP->AA": {"B": pp_aa["estimate"], "SE": pp_aa["standardError"], "p": pp_aa["pValue"]},
            "PV->AA": {"B": pv_aa["estimate"], "beta": pv_aa["standardized"]},
        },
    }


def bootstrap_fingerprint(payload: dict[str, Any]) -> str:
    effects = payload["effects"]
    normalized = {
        name: effects[name]["bootstrap"]
        for name in ("direct", "viaPC", "viaPI", "totalIndirect", "total")
    }
    return hashlib.sha256(json.dumps(normalized, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()


def main() -> int:
    args = parse_args()
    require(1 <= args.bootstrap <= 20000, "--bootstrap 必须在 1 到 20000 之间")
    amos_home = read_amos_home(args.amos_home)
    require((amos_home / "Amos.EngineLib.dll").is_file(), f"无效 Amos 目录：{amos_home}")
    require(BRIDGE.is_file(), f"Amos Bridge 未构建：{BRIDGE}")
    require(SAMPLE.is_file() and PLAN.is_file(), "synthetic 样例或固定方案缺失")

    if args.evidence_root:
        evidence = Path(args.evidence_root).expanduser().resolve()
    else:
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        evidence = ROOT / "data" / "validation" / "T-20260717-14-amos" / f"automated-{stamp}"
    require(ROOT / "outputs" not in evidence.parents and evidence != ROOT / "outputs", "证据目录不得位于历史 outputs")
    require(not evidence.exists(), f"证据目录已存在，拒绝覆盖：{evidence}")
    evidence.mkdir(parents=True)

    outputs_before = tree_snapshot(ROOT / "outputs")
    write_json(evidence / "outputs-before.json", outputs_before)
    cases: list[dict[str, Any]] = []
    amos_plan = json.loads(PLAN.read_text(encoding="utf-8"))
    amos_plan["analysisOrder"] = ["data-quality", "amos"]
    amos_plan["confirmation"] = {"confirmed": True, "confirmedAtUtc": "2026-07-31T00:00:00.000Z"}
    amos_plan_path = evidence / "confirmed-amos-only-plan.json"
    write_json(amos_plan_path, amos_plan)

    source = pd.read_excel(SAMPLE, sheet_name=0)
    item_columns = [
        column
        for column in source.columns
        if str(column).split("_", 1)[0] in {"PP1", "PP2", "PP3", "PP4", "AA1", "AA2", "AA3", "PC1", "PC2", "PC3", "PC4", "PI1", "PI2", "PI3", "PI4", "PI5", "PV1", "PV2", "PV3", "PV4"}
    ]
    require(len(item_columns) == 20, f"synthetic 量表题项数量异常：{len(item_columns)}")
    sanitized = source[item_columns].copy()
    sanitized.columns = [str(column).split("_", 1)[0] for column in item_columns]
    sanitized_input = evidence / "synthetic-amos-input.xlsx"
    sanitized.to_excel(sanitized_input, sheet_name="data", index=False)

    baseline_payloads: list[dict[str, Any]] = []
    for suffix in ("a", "b"):
        case_dir = evidence / f"baseline-{suffix}"
        case_dir.mkdir()
        output = case_dir / "amos-engine-result.json"
        raw = case_dir / "AmosOutput.html"
        execution = run(bridge_command(amos_home, sanitized_input, output, raw, args.bootstrap, args.seed))
        cleanup_bridge_temps(case_dir)
        write_json(case_dir / "execution.json", execution)
        require(execution["returnCode"] == 0, f"baseline-{suffix} 失败：{execution['stderr']}")
        require(output.is_file() and raw.is_file(), f"baseline-{suffix} 未生成 JSON/AMOS 原始输出")
        payload = json.loads(output.read_text(encoding="utf-8"))
        baseline_payloads.append(payload)
        cases.append({"name": f"baseline-{suffix}", "passed": True, "durationSeconds": execution["durationSeconds"]})

    scientific_baseline = assert_baseline(baseline_payloads[0])
    second_baseline = assert_baseline(baseline_payloads[1])
    require(scientific_baseline == second_baseline, "两次固定种子点估计不一致")
    first_fingerprint = bootstrap_fingerprint(baseline_payloads[0])
    second_fingerprint = bootstrap_fingerprint(baseline_payloads[1])
    require(first_fingerprint == second_fingerprint, "两次固定种子 Bootstrap 结果不一致")
    require(baseline_payloads[0]["effects"]["validBootstrapSamples"] == args.bootstrap, "有效 Bootstrap 样本数异常")
    cases.append({"name": "fixed-seed-reproduction", "passed": True, "bootstrapFingerprint": first_fingerprint})

    rng = np.random.default_rng(args.seed)
    shuffled = sanitized.copy()
    order = rng.permutation(len(shuffled))
    aa_columns = [column for column in shuffled.columns if str(column).startswith("AA")]
    require(aa_columns == ["AA1", "AA2", "AA3"], "synthetic AA 列定义意外变化")
    shuffled.loc[:, aa_columns] = shuffled.loc[order, aa_columns].to_numpy()
    perturbed_input = evidence / "synthetic-perturbed-aa.xlsx"
    shuffled.to_excel(perturbed_input, sheet_name="data", index=False)
    sensitivity_dir = evidence / "sensitivity"
    sensitivity_dir.mkdir()
    sensitivity_output = sensitivity_dir / "amos-engine-result.json"
    sensitivity_raw = sensitivity_dir / "AmosOutput.html"
    sensitivity_execution = run(bridge_command(amos_home, perturbed_input, sensitivity_output, sensitivity_raw, 0, args.seed))
    cleanup_bridge_temps(sensitivity_dir)
    write_json(sensitivity_dir / "execution.json", sensitivity_execution)
    require(sensitivity_execution["returnCode"] == 0, f"数据敏感性拟合失败：{sensitivity_execution['stderr']}")
    sensitivity = json.loads(sensitivity_output.read_text(encoding="utf-8"))
    original_pp_aa = parameter(baseline_payloads[0], "PP", "AA")["standardized"]
    changed_pp_aa = parameter(sensitivity, "PP", "AA")["standardized"]
    require(abs(original_pp_aa - changed_pp_aa) >= 0.10, "扰动 AA 后 PP→AA 标准化路径未发生实质变化")
    require(baseline_payloads[0]["inputSha256"] != sensitivity["inputSha256"], "扰动输入哈希未发生变化")
    cases.append({
        "name": "data-sensitivity",
        "passed": True,
        "originalPpToAaBeta": original_pp_aa,
        "perturbedPpToAaBeta": changed_pp_aa,
        "originalCmin": baseline_payloads[0]["fit"]["CMIN"],
        "perturbedCmin": sensitivity["fit"]["CMIN"],
    })

    missing = sanitized.drop(columns=["PV4"])
    missing_input = evidence / "synthetic-missing-pv4.xlsx"
    missing.to_excel(missing_input, sheet_name="data", index=False)
    missing_dir = evidence / "invalid-missing-column"
    missing_dir.mkdir()
    missing_output = missing_dir / "amos-engine-result.json"
    missing_execution = run(bridge_command(amos_home, missing_input, missing_output, missing_dir / "AmosOutput.html", 0, args.seed))
    cleanup_bridge_temps(missing_dir)
    write_json(missing_dir / "execution.json", missing_execution)
    require(missing_execution["returnCode"] != 0 and not missing_output.exists(), "缺列输入必须失败且不得生成结果 JSON")
    cases.append({"name": "invalid-missing-column", "passed": True, "reportArtifacts": 0})

    wrong_dir = evidence / "invalid-amos-home"
    wrong_dir.mkdir()
    wrong_output = wrong_dir / "amos-engine-result.json"
    wrong_execution = run(bridge_command(wrong_dir, sanitized_input, wrong_output, wrong_dir / "AmosOutput.html", 0, args.seed))
    cleanup_bridge_temps(wrong_dir)
    write_json(wrong_dir / "execution.json", wrong_execution)
    require(wrong_execution["returnCode"] != 0 and not wrong_output.exists(), "无效 Amos 目录必须失败且不得生成结果 JSON")
    require("Amos.EngineLib.dll" in wrong_execution["stderr"], "无效 Amos 目录错误信息不可操作")
    cases.append({"name": "invalid-amos-home", "passed": True, "reportArtifacts": 0})

    small_input = evidence / "synthetic-small-n50.xlsx"
    source.head(50).to_excel(small_input, sheet_name="data", index=False)
    small_dir = evidence / "invalid-small-sample"
    small_dir.mkdir()
    pipeline_env = os.environ.copy()
    pipeline_env["ANALYZER_AMOS_HOME"] = str(amos_home)
    pipeline_env["ANALYZER_AMOS_BRIDGE"] = str(BRIDGE)
    pipeline_env["ANALYZER_AMOS_BOOTSTRAP_SAMPLES"] = str(args.bootstrap)
    pipeline_env["ANALYZER_ALLOW_TEST_OVERRIDES"] = "1"
    small_execution = run([
        sys.executable,
        str(ROOT / "services" / "questionnaire_pipeline.py"),
        "--input", str(small_input),
        "--plan", str(amos_plan_path),
        "--output-dir", str(small_dir),
        "--prompt", "只做 AMOS CFA 和结构方程分析",
        "--seed", str(args.seed),
    ], env=pipeline_env)
    write_json(small_dir / "execution.json", small_execution)
    forbidden = [small_dir / name for name in ("analysis-result.json", "amos-engine-result.json", "问卷数据分析报告.docx", "问卷数据分析报告.pdf")]
    require(small_execution["returnCode"] != 0 and not any(path.exists() for path in forbidden), "小样本必须失败且不得生成伪报告")
    require("100" in small_execution["stderr"], "小样本错误信息应明确至少 100 份")
    cases.append({"name": "invalid-small-sample", "passed": True, "reportArtifacts": 0})

    limited_dir = evidence / "limited-amos-only"
    limited_dir.mkdir()
    limited_execution = run([
        sys.executable,
        str(ROOT / "services" / "questionnaire_pipeline.py"),
        "--input", str(SAMPLE),
        "--plan", str(amos_plan_path),
        "--output-dir", str(limited_dir),
        "--prompt", "只做 AMOS CFA 和结构方程分析",
        "--seed", str(args.seed),
    ], env=pipeline_env, timeout=600)
    write_json(limited_dir / "execution.json", limited_execution)
    require(limited_execution["returnCode"] == 0, f"AMOS 限定分析失败：{limited_execution['stderr']}")
    limited_result = json.loads((limited_dir / "analysis-result.json").read_text(encoding="utf-8"))
    require(limited_result["raw"]["analysisScope"] == ["data-quality", "amos"], f"限定分析范围异常：{limited_result['raw']['analysisScope']}")
    titles = [section["title"] for section in limited_result["tables"]]
    require(not any("信度检验" in title or "探索因子" in title or "主成分结构检查" in title or "并行中介与调节" in title for title in titles), "只做 AMOS 时混入了未请求章节")
    limited_artifacts = [
        limited_dir / "analysis-result.json",
        limited_dir / "amos-engine-result.json",
        limited_dir / "AMOS原始输出.AmosOutput.html",
        limited_dir / "AMOS结构方程模型图.png",
        limited_dir / "问卷数据分析报告.docx",
        limited_dir / "问卷数据分析报告.pdf",
    ]
    require(all(path.is_file() for path in limited_artifacts), "AMOS 限定分析产物不完整")
    cases.append({"name": "limited-amos-only", "passed": True, "analysisScope": limited_result["raw"]["analysisScope"]})

    outputs_after = tree_snapshot(ROOT / "outputs")
    write_json(evidence / "outputs-after.json", outputs_after)
    require(outputs_before == outputs_after, "历史 outputs 前后哈希不一致")

    artifact_hashes = {
        path.relative_to(evidence).as_posix(): {"size": path.stat().st_size, "sha256": sha256(path)}
        for path in sorted(item for item in evidence.rglob("*") if item.is_file())
        if path.name not in {"verification-summary.json"}
    }
    summary = {
        "schemaVersion": 1,
        "passed": True,
        "sample": str(SAMPLE),
        "sampleSha256": sha256(SAMPLE),
        "amosHome": str(amos_home),
        "bridge": str(BRIDGE),
        "bridgeSha256": sha256(BRIDGE),
        "bootstrapSamples": args.bootstrap,
        "seed": args.seed,
        "scientificBaseline": scientific_baseline,
        "bootstrapFingerprint": first_fingerprint,
        "cases": cases,
        "historicalOutputsByteIdentical": True,
        "artifactHashes": artifact_hashes,
    }
    write_json(evidence / "verification-summary.json", summary)
    print(json.dumps({"passed": True, "evidenceRoot": str(evidence), "cases": cases}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (AssertionError, RuntimeError, ValueError, subprocess.TimeoutExpired) as error:
        print(f"AMOS verification failed: {error}", file=sys.stderr)
        raise SystemExit(2)
