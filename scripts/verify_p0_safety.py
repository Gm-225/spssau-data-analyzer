from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd


ROOT = Path(__file__).resolve().parents[1]
PIPELINE = ROOT / "services" / "questionnaire_pipeline.py"


def make_frame(seed: int = 20260731, count: int = 48) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    sat = rng.normal(size=count)
    val = 0.3 * sat + rng.normal(scale=0.9, size=count)
    loy = 0.55 * sat + 0.25 * val + rng.normal(scale=0.7, size=count)

    def items(latent: np.ndarray, prefix: str) -> dict[str, np.ndarray]:
        return {
            f"{prefix}{index}": np.clip(np.rint(3 + latent + rng.normal(scale=0.55, size=count)), 1, 5).astype(object)
            for index in range(1, 4)
        }

    return pd.DataFrame({
        "编号": np.arange(1, count + 1),
        "姓名": [f"PII_SENTINEL_NAME_{index}" for index in range(count)],
        "手机号": [f"PII_SENTINEL_PHONE_{index}" for index in range(count)],
        "开放文本": [f"PII_SENTINEL_TEXT_{index}" for index in range(count)],
        **items(sat, "SAT"),
        **items(val, "VAL"),
        **items(loy, "LOY"),
    })


def plan(*, steps: list[str], model: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "schemaVersion": "2.0",
        "planId": "p0-synthetic-boundary",
        "title": "P0 合成边界验证",
        "sampleIdColumn": "编号",
        "excludedColumns": ["姓名", "手机号", "开放文本"],
        "demographics": [],
        "scale": {
            "min": 1,
            "max": 5,
            "labels": {str(value): str(value) for value in range(1, 6)},
            "missingPolicy": "dimension-mean-requires-all-items",
            "confirmed": True,
        },
        "dimensions": [
            {"id": "SAT", "name": "满意度", "columnPrefix": "SAT", "expectedItems": 3, "items": ["SAT1", "SAT2", "SAT3"], "reverseItems": [], "reverseItemsConfirmed": True},
            {"id": "VAL", "name": "感知价值", "columnPrefix": "VAL", "expectedItems": 3, "items": ["VAL1", "VAL2", "VAL3"], "reverseItems": [], "reverseItemsConfirmed": True},
            {"id": "LOY", "name": "忠诚度", "columnPrefix": "LOY", "expectedItems": 3, "items": ["LOY1", "LOY2", "LOY3"], "reverseItems": [], "reverseItemsConfirmed": True},
        ],
        "model": model or {
            "type": "none",
            "controls": [],
            "centering": [],
            "bootstrapSamples": 5000,
            "confidenceLevel": 0.95,
        },
        "analysisOrder": steps,
        "humanConfirmations": [],
        "confirmation": {"confirmed": True, "confirmedAtUtc": "2026-07-31T00:00:00.000Z"},
    }


def json_rows(frame: pd.DataFrame) -> list[dict[str, Any]]:
    sanitized = frame.astype(object).where(pd.notna(frame), None)
    return sanitized.to_dict(orient="records")


def run_case(root: Path, name: str, frame: pd.DataFrame, selected_plan: dict[str, Any], *, expect_success: bool) -> tuple[dict[str, Any] | None, str]:
    case_root = root / name
    case_root.mkdir()
    input_path = case_root / "synthetic-input.json"
    plan_path = case_root / "confirmed-plan.json"
    output = case_root / "output"
    output.mkdir()
    input_path.write_text(json.dumps({"headers": frame.columns.tolist(), "rows": json_rows(frame)}, ensure_ascii=False), encoding="utf-8")
    plan_path.write_text(json.dumps(selected_plan, ensure_ascii=False, indent=2), encoding="utf-8")
    completed = subprocess.run(
        [
            sys.executable,
            str(PIPELINE),
            "--input-json", str(input_path),
            "--plan", str(plan_path),
            "--output-dir", str(output),
            "--no-documents",
        ],
        cwd=ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=120,
    )
    message = (completed.stderr or completed.stdout).strip().splitlines()[-1] if (completed.stderr or completed.stdout).strip() else ""
    artifacts = [output / "analysis-result.json", output / "问卷数据分析报告.docx", output / "问卷数据分析报告.pdf"]
    if expect_success:
        if completed.returncode:
            raise AssertionError(f"{name} 应成功：{message}")
        result_path = output / "analysis-result.json"
        if not result_path.is_file():
            raise AssertionError(f"{name} 未生成 analysis-result.json")
        return json.loads(result_path.read_text(encoding="utf-8")), message
    if completed.returncode == 0:
        raise AssertionError(f"{name} 应失败但返回成功")
    if any(artifact.exists() for artifact in artifacts):
        raise AssertionError(f"{name} 失败后生成了伪报告")
    return None, message


def main() -> int:
    parser = argparse.ArgumentParser(description="P0 科学、隐私和失败关闭 synthetic 验证")
    parser.add_argument("--evidence-root")
    args = parser.parse_args()
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    evidence = Path(args.evidence_root).resolve() if args.evidence_root else ROOT / "data" / "validation" / "T-20260731-12-p0-safety" / f"safety-{stamp}"
    if evidence.exists():
        raise SystemExit(f"证据目录已存在，拒绝覆盖：{evidence}")
    evidence.mkdir(parents=True)
    frame = make_frame()
    cases: list[dict[str, Any]] = []

    missing = frame.copy()
    missing.loc[0, "SAT1"] = None
    missing.loc[1, "VAL1"] = None
    missing.loc[2, "LOY1"] = None
    result, _ = run_case(evidence, "pairwise-missing-correlation", missing, plan(steps=["data-quality", "dimension-correlation"]), expect_success=True)
    assert result is not None
    try:
        serialized = json.dumps(result, ensure_ascii=False, allow_nan=False)
    except ValueError as error:
        raise AssertionError(f"错位缺失相关结果包含非有限数值：{error}") from error
    if "PII_SENTINEL" in serialized or any(name in serialized for name in ("姓名", "手机号", "开放文本")):
        raise AssertionError("默认排除字段泄露到结果 JSON")
    pair_sizes = result["raw"]["effectiveSampleSizes"]["correlationByPair"]
    if len(set(pair_sizes.values())) < 2:
        raise AssertionError(f"相关有效样本量未反映按变量对删除：{pair_sizes}")
    cases.append({"name": "pairwise-missing-correlation", "status": "passed", "pairwiseN": pair_sizes})

    efa_result, _ = run_case(
        evidence,
        "efa-method-provenance",
        make_frame(count=120),
        plan(steps=["data-quality", "efa"]),
        expect_success=True,
    )
    assert efa_result is not None
    efa_method = efa_result["raw"].get("efaMethod")
    expected_efa_method = {
        "extraction": "principal-components-from-correlation-matrix",
        "rotation": "varimax",
        "factorCount": 3,
        "factorCountSource": "confirmed-dimension-count",
        "commonFactorModel": False,
        "dataDrivenFactorCount": False,
    }
    if efa_method != expected_efa_method:
        raise AssertionError(f"EFA/PCA 方法 provenance 不完整：{efa_method}")
    efa_section = next((item for item in efa_result["tables"] if item.get("title", "").endswith("主成分结构检查（PCA+Varimax）")), None)
    efa_text = efa_section["rows"][0][0] if efa_section else ""
    if not all(token in efa_text for token in ("主成分提取", "确认", "不是公因子", "平行分析")):
        raise AssertionError(f"EFA/PCA 报告边界说明不完整：{efa_text}")
    cases.append({"name": "efa-method-provenance", "status": "passed", "method": efa_method})

    out_of_range = frame.copy()
    out_of_range.loc[0, "SAT1"] = 99
    _, message = run_case(evidence, "out-of-range", out_of_range, plan(steps=["data-quality", "item-descriptive"]), expect_success=False)
    if "超出量表范围" not in message:
        raise AssertionError(f"越界值错误不明确：{message}")
    cases.append({"name": "out-of-range", "status": "passed", "message": message})

    nonnumeric = frame.copy()
    nonnumeric.loc[0, "SAT1"] = "NOT_A_NUMBER"
    _, message = run_case(evidence, "nonnumeric-item", nonnumeric, plan(steps=["data-quality", "item-descriptive"]), expect_success=False)
    if "无法解析为数值" not in message:
        raise AssertionError(f"非数值题项错误不明确：{message}")
    cases.append({"name": "nonnumeric-item", "status": "passed", "message": message})

    invalid_reverse = plan(steps=["data-quality", "reliability"])
    invalid_reverse["dimensions"][0]["reverseItems"] = ["VAL1"]
    _, message = run_case(evidence, "cross-dimension-reverse", frame, invalid_reverse, expect_success=False)
    if "反向题不属于该维度" not in message:
        raise AssertionError(f"跨维度反向题错误不明确：{message}")
    cases.append({"name": "cross-dimension-reverse", "status": "passed", "message": message})

    regression_model = {
        "type": "multiple-regression",
        "x": "SAT",
        "y": "LOY",
        "predictors": ["SAT", "VAL"],
        "controls": [],
        "centering": [],
        "bootstrapSamples": 5000,
        "confidenceLevel": 0.95,
    }
    zero_outcome = frame.copy()
    for column in ("LOY1", "LOY2", "LOY3"):
        zero_outcome[column] = 3
    _, message = run_case(evidence, "zero-variance-outcome", zero_outcome, plan(steps=["data-quality", "model"], model=regression_model), expect_success=False)
    if "因变量为零方差" not in message:
        raise AssertionError(f"零方差错误不明确：{message}")
    cases.append({"name": "zero-variance-outcome", "status": "passed", "message": message})

    collinear = frame.copy()
    for index in range(1, 4):
        collinear[f"VAL{index}"] = collinear[f"SAT{index}"]
    _, message = run_case(evidence, "collinear-predictors", collinear, plan(steps=["data-quality", "model"], model=regression_model), expect_success=False)
    if "完全共线" not in message:
        raise AssertionError(f"完全共线错误不明确：{message}")
    cases.append({"name": "collinear-predictors", "status": "passed", "message": message})

    _, message = run_case(evidence, "small-regression-sample", frame.head(4), plan(steps=["data-quality", "model"], model=regression_model), expect_success=False)
    if "完整样本不足" not in message:
        raise AssertionError(f"小样本错误不明确：{message}")
    cases.append({"name": "small-regression-sample", "status": "passed", "message": message})

    unconfirmed = plan(steps=["data-quality", "item-descriptive"])
    unconfirmed["confirmation"] = {"confirmed": False, "confirmedAtUtc": None}
    _, message = run_case(evidence, "unconfirmed-plan", frame, unconfirmed, expect_success=False)
    if "尚未由操作者确认" not in message:
        raise AssertionError(f"未确认方案错误不明确：{message}")
    cases.append({"name": "unconfirmed-plan", "status": "passed", "message": message})

    summary = {
        "status": "passed",
        "syntheticOnly": True,
        "evidenceRoot": str(evidence),
        "caseCount": len(cases),
        "cases": cases,
    }
    (evidence / "machine-summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
