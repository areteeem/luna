"""Build the browser CSPICE artifact with Emscripten 4.0.15 and NAIF N0067."""
import concurrent.futures
import os
from pathlib import Path
import subprocess
import sys
from spice_wasm_abi import patch_abi

root = Path(__file__).resolve().parents[2]
spice = Path(sys.argv[1]).resolve()
src = spice / "src/cspice"
obj = root / "work/toolchain/objects"
obj.mkdir(parents=True, exist_ok=True)
out = Path(sys.argv[2]).resolve() if len(sys.argv) > 2 else root / "app/public/browser-spice"
out.mkdir(parents=True, exist_ok=True)

def compile_chunk(files):
    subprocess.run(["emcc", "-c", "-O2", "-DNON_UNIX_STDIO", "-Wno-everything",
                    "-I", str(spice / "include"), "-I", str(src), *map(str, files)], cwd=obj, check=True)

files = sorted(src.glob("*.c"))
if len(files) != 2229:
    raise SystemExit("Expected the NAIF C Toolkit N0067 Linux distribution")
patched = obj / "abi"
patch_abi(src, patched)
files = [(patched / file.name if (patched / file.name).is_file() else file) for file in files]
pending = [file for file in files if not (obj / (file.stem + ".o")).exists() or file.stat().st_mtime > (obj / (file.stem + ".o")).stat().st_mtime]
with concurrent.futures.ThreadPoolExecutor(max_workers=min(os.cpu_count() or 4, 10)) as executor:
    list(executor.map(compile_chunk, [pending[i:i+45] for i in range(0, len(pending), 45)]))
archive = obj / "cspice.a"
subprocess.run(["emar", "rcs", str(archive), *(str(obj / (file.stem + ".o")) for file in files)], check=True)

exports = "result configure last_error load_kernel time_et frame_transform frame_transform_times position observer_state geodetic".split()
subprocess.run(["emcc", str(root / "scripts/browser/spice_bridge.c"), str(archive), "-I", str(spice / "include"),
                "--no-entry", "-O2", "-Wl,--fatal-warnings", "-sMODULARIZE=1", "-sALLOW_MEMORY_GROWTH=1", "-sFORCE_FILESYSTEM=1",
                "-sEXPORTED_RUNTIME_METHODS=FS,cwrap,HEAPF64",
                "-sEXPORTED_FUNCTIONS=" + ",".join("_" + name for name in exports),
                "-o", str(out / "spice.mjs")], check=True)
