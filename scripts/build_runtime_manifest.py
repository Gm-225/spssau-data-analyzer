from __future__ import annotations

import argparse
import hashlib
import importlib.metadata as metadata
import json
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


RUNTIME_DISTRIBUTIONS = (
    "numpy",
    "pandas",
    "scipy",
    "openpyxl",
    "python-docx",
    "matplotlib",
    "reportlab",
    "charset-normalizer",
    "python-dateutil",
    "six",
    "tzdata",
    "lxml",
    "typing-extensions",
    "contourpy",
    "cycler",
    "fonttools",
    "kiwisolver",
    "packaging",
    "pillow",
    "pyparsing",
    "et-xmlfile",
)

BUILD_DISTRIBUTIONS = (
    "pyinstaller",
    "pyinstaller-hooks-contrib",
)

FORBIDDEN_RUNTIME_PARTS = (
    "statsmodels",
    "patsy",
    "pypdfium2",
)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest().upper()


def relative_posix(path: Path, parent: Path) -> str:
    return path.relative_to(parent).as_posix()


def safe_copy(source: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, destination)


def is_license_file(path: Path) -> bool:
    name = path.name.lower()
    parts = {part.lower() for part in path.parts}
    return (
        "licenses" in parts
        or name.startswith(("license", "licence", "copying", "notice", "copyright"))
    )


def distribution_record(name: str, legal_root: Path) -> dict[str, Any]:
    distribution = metadata.distribution(name)
    canonical = distribution.metadata.get("Name", name)
    destination_root = legal_root / "python-packages" / canonical
    copied: list[dict[str, Any]] = []

    for item in distribution.files or ():
        item_path = Path(str(item))
        if not is_license_file(item_path):
            continue
        source = Path(distribution.locate_file(item))
        if not source.is_file():
            continue
        destination = destination_root / item_path
        safe_copy(source, destination)
        copied.append(
            {
                "path": relative_posix(destination, legal_root),
                "sha256": sha256(destination),
                "bytes": destination.stat().st_size,
            }
        )

    project_urls = distribution.metadata.get_all("Project-URL") or []
    return {
        "name": canonical,
        "version": distribution.version,
        "licenseExpression": distribution.metadata.get("License-Expression", ""),
        "licenseMetadata": distribution.metadata.get("License", ""),
        "homePage": distribution.metadata.get("Home-page", ""),
        "projectUrls": project_urls,
        "requires": sorted(distribution.requires or []),
        "copiedLicenseFiles": copied,
    }


def copy_project_legal(project_root: Path, legal_root: Path) -> list[dict[str, Any]]:
    sources = (
        (project_root / "LICENSE", legal_root / "APPLICATION_LICENSE.txt"),
        (
            project_root / "licenses" / "THIRD_PARTY_NOTICES.txt",
            legal_root / "THIRD_PARTY_NOTICES.txt",
        ),
        (
            project_root / "licenses" / "fonts" / "NotoSansSC-OFL.txt",
            legal_root / "fonts" / "NotoSansSC-OFL.txt",
        ),
        (Path(sys.base_prefix) / "LICENSE.txt", legal_root / "python" / "LICENSE.txt"),
    )
    copied: list[dict[str, Any]] = []
    for source, destination in sources:
        if not source.is_file():
            raise FileNotFoundError(f"Required legal file is missing: {source}")
        safe_copy(source, destination)
        copied.append(
            {
                "path": relative_posix(destination, legal_root),
                "sha256": sha256(destination),
                "bytes": destination.stat().st_size,
            }
        )
    return copied


def runtime_files(runtime_dir: Path) -> list[dict[str, Any]]:
    files: list[dict[str, Any]] = []
    for path in sorted(runtime_dir.rglob("*")):
        if not path.is_file():
            continue
        relative = relative_posix(path, runtime_dir)
        lowered = relative.lower()
        if any(part in lowered for part in FORBIDDEN_RUNTIME_PARTS):
            raise RuntimeError(f"Forbidden verification/development dependency entered runtime: {relative}")
        if "lxml" in lowered and ("/tests/" in lowered or lowered.endswith("/test.py")):
            raise RuntimeError(f"Forbidden lxml test material entered runtime: {relative}")
        files.append(
            {
                "path": relative,
                "sha256": sha256(path),
                "bytes": path.stat().st_size,
            }
        )
    if not files:
        raise RuntimeError(f"Frozen runtime is empty: {runtime_dir}")
    return files


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build the frozen science runtime manifest and legal inventory.")
    parser.add_argument("--project-root", type=Path, required=True)
    parser.add_argument("--runtime-dir", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--legal-dir", type=Path, required=True)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    project_root = args.project_root.resolve()
    runtime_dir = args.runtime_dir.resolve()
    manifest_path = args.manifest.resolve()
    legal_root = args.legal_dir.resolve()
    legal_root.mkdir(parents=True, exist_ok=True)

    records = [
        {**distribution_record(name, legal_root), "scope": "runtime"}
        for name in RUNTIME_DISTRIBUTIONS
    ]
    records.extend(
        {**distribution_record(name, legal_root), "scope": "build-only"}
        for name in BUILD_DISTRIBUTIONS
    )
    project_legal = copy_project_legal(project_root, legal_root)
    frozen_files = runtime_files(runtime_dir)

    critical_sources = (
        ("runtime/questionnaire-engine/questionnaire-engine.exe", runtime_dir / "questionnaire-engine.exe"),
        ("amos-bridge/amos-bridge.exe", project_root / "build" / "amos-bridge" / "amos-bridge.exe"),
        ("pipeline/questionnaire_pipeline.py", project_root / "services" / "questionnaire_pipeline.py"),
        ("config/questionnaire-plan.json", project_root / "examples" / "questionnaire-plan.json"),
        ("fonts/NotoSansSC-Regular.ttf", project_root / "assets" / "fonts" / "NotoSansSC-Regular.ttf"),
        ("fonts/NotoSansSC-Bold.ttf", project_root / "assets" / "fonts" / "NotoSansSC-Bold.ttf"),
    )
    critical_files: list[dict[str, Any]] = []
    for packaged_path, source in critical_sources:
        if not source.is_file():
            raise FileNotFoundError(f"Critical packaged resource is missing: {source}")
        critical_files.append(
            {
                "path": packaged_path,
                "sha256": sha256(source),
                "bytes": source.stat().st_size,
            }
        )

    timestamp = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    manifest = {
        "schemaVersion": 1,
        "product": "AI Data Analyzer fixed questionnaire runtime",
        "builtAtUtc": timestamp,
        "python": {
            "version": sys.version.split()[0],
            "implementation": sys.implementation.name,
            "architecture": "win-x64",
        },
        "runtime": {
            "layout": "pyinstaller-onedir",
            "entrypoint": "runtime/questionnaire-engine/questionnaire-engine.exe",
            "fileCount": len(frozen_files),
            "bytes": sum(item["bytes"] for item in frozen_files),
            "files": frozen_files,
        },
        "criticalFiles": critical_files,
        "dependencyInventory": records,
        "legalFiles": project_legal,
        "redistributionAudit": {
            "status": "engineering-reviewed",
            "legalAdvice": False,
            "excluded": list(FORBIDDEN_RUNTIME_PARTS),
            "notes": "Keep the full packaged licenses directory with every redistributed build.",
        },
    }
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    inventory_path = legal_root / "runtime-package-inventory.json"
    inventory_path.write_text(
        json.dumps(
            {
                "schemaVersion": 1,
                "builtAtUtc": timestamp,
                "runtimeFileCount": len(frozen_files),
                "runtimeBytes": sum(item["bytes"] for item in frozen_files),
                "criticalFiles": critical_files,
                "distributions": records,
                "legalFiles": project_legal,
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(
        json.dumps(
            {
                "manifest": str(manifest_path),
                "inventory": str(inventory_path),
                "runtimeFiles": len(frozen_files),
                "runtimeBytes": sum(item["bytes"] for item in frozen_files),
                "dependencies": len(records),
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
