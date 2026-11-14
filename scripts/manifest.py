"""Create the expected asset manifest only when explicitly requested."""
import argparse
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def entries() -> list[dict]:
    files = sorted(p for p in ROOT.glob("data/*") if p.is_file() and p.name != "manifest.json")
    return [{"path": p.relative_to(ROOT).as_posix(), "bytes": p.stat().st_size,
             "sha256": hashlib.sha256(p.read_bytes()).hexdigest()} for p in files if p.is_file()]


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true", required=True)
    parser.parse_args()
    value = {"schema_version": 1, "actual_initial_preparation_date": "2026-11-14", "assets": entries()}
    (ROOT / "data/manifest.json").write_text(json.dumps(value, indent=2) + "\n")
    print("Wrote", len(value["assets"]), "asset checksums")
