"""Prepare immutable browser inputs after Vite builds app/dist.

NASA files are pinned by the committed source manifests. The Pyodide version and
its package lock pin the interpreter and wheels used by the science worker.
"""
from concurrent.futures import ThreadPoolExecutor
from hashlib import sha256
import json
from pathlib import Path
import shutil
import urllib.request

root = Path(__file__).resolve().parents[2]
dist = root / "app/dist"
public = root / "app/public/data"
vendor = root / "work/browser-vendor"
vendor.mkdir(parents=True, exist_ok=True)
py_version = "0.28.3"
py_base = f"https://cdn.jsdelivr.net/pyodide/v{py_version}/full/"
py_path = f"/browser-vendor/pyodide-{py_version}"
py_files = {
    "pyodide.mjs": "635a6da3218fe4e5668da595acfe8b5ce77453d597d602f19a423dd250653441",
    "pyodide.asm.js": "b22e5831eade9ff10e6fe2c811c68688cd91f10154377b4f80debcf5bafa1e56",
    "pyodide.asm.wasm": "5effb6a1a6cc4a1a85bec4622701aa797c031e1de923cbbaf2ad47abdc4ab325",
    "python_stdlib.zip": "71fee17f88a6260ec8c9c7c063533ee59c021fdc88a1ce76247378d3c4a35f4c",
    "pyodide-lock.json": "f6e6f42f451f42affbbcddb00e8c9a3278dcbf399f57aab9f3f568839a7ff4a6",
}
scripts = ["geometry_server", "mission_models", "site_recommendations", "study_region", "surface_routes", "terrain_model",
           "visual_terrain"]
shims = ["spiceypy", "pyproj", "rasterio", "luna_entry"]
sources = {}
models = {}

def read(path):
    return json.loads(path.read_text())

def digest(path):
    checksum = sha256()
    with path.open("rb") as f:
        while block := f.read(1024 * 1024):
            checksum.update(block)
    return checksum.hexdigest()

def ensure(target, url, expected=None):
    if not target.exists() or (expected and digest(target) != expected):
        target.parent.mkdir(parents=True, exist_ok=True)
        temp = target.with_suffix(target.suffix + ".partial")
        try:
            with urllib.request.urlopen(url, timeout=90) as response, temp.open("wb") as f:
                shutil.copyfileobj(response, f)
        except OSError as error:
            temp.unlink(missing_ok=True)
            raise RuntimeError(f"Cannot acquire {url}: {error}") from error
        if expected and digest(temp) != expected:
            temp.unlink()
            raise ValueError(f"Unexpected SHA-256 for {target.name}")
        temp.replace(target)
    return target

def copy(source, url):
    destination = dist / url.lstrip("/")
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, destination)

def dataset(record, category):
    name = record.get("name") or Path(record["file"]).name
    path = record.get("file") or f"work/kernels/{name}"
    if category == "display":
        path = f"work/terrain/{name}"
    retained = root / "data/naif" / name
    if retained.is_file():
        if digest(retained) != record["sha256"]:
            raise ValueError(f"Checksum mismatch for retained NAIF kernel {name}")
        target = retained
    else:
        target = ensure(root / path, record["url"], record["sha256"])
    # Asset names include the checksum. Chunk below hosting/proxy file limits.
    chunks = []
    with target.open("rb") as f:
        while data := f.read(8 * 1024 * 1024):
            url = f"/browser-data/{record['sha256'][:16]}/{name}.{len(chunks)}"
            output = dist / url.lstrip("/")
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_bytes(data)
            chunks.append(url)
    return name, {**record, "file": path, "category": category, "chunks": chunks}

def vendor_file(filename, checksum=None):
    copy(ensure(vendor / filename, py_base + filename, checksum), f"{py_path}/{filename}")

if not (dist / "navigator.html").is_file():
    raise SystemExit("Build app/dist before preparing browser science.")
core = read(root / "scripts/browser/kernels.json")
analysis = read(public / "science-manifest.json")
display = read(public / "visual-terrain-manifest.json")
inputs = [(item, kind) for manifest, kind in [(core, "core"), (analysis["sources"], "analysis"), (display["sources"], "display")]
          for item in manifest]
with ThreadPoolExecutor(max_workers=6) as pool:
    sources.update(pool.map(lambda item: dataset(*item), inputs))
    list(pool.map(vendor_file, py_files, py_files.values()))
    lock = read(vendor / "pyodide-lock.json")["packages"]

    def package_names(name):
        return {name}.union(*(package_names(dep) for dep in lock[name]["depends"]))

    packages = {}
    for package in sorted(package_names("numpy")):
        record = lock[package]
        packages[package] = f"{py_path}/{record['file_name']}"
    list(pool.map(lambda package: vendor_file(lock[package]["file_name"], lock[package]["sha256"]), packages))

for name in scripts + shims:
    path = root / ("scripts" if name in scripts else "scripts/browser/shims") / (name + ".py")
    url = f"/browser-data/{digest(path)[:16]}/{name}.py"
    copy(path, url)
    models[name] = url

manifest = {
    "datasets": sources, "models": models, "pyodide": py_path,
    "py_files": [f"{py_path}/{name}" for name in py_files], "packages": packages,
    "kernels": core, "science": analysis,
}
(dist / "browser-science.json").write_text(json.dumps(manifest))
# Vite has already emitted the service worker and its navigation/app dependencies.
shell = []
for path in dist.rglob("*"):
    if path.is_file():
        file = path.relative_to(dist).as_posix()
        if file in ["navigator.html", "popout.html", "icons.svg", "favicon.svg"] or (
            file.startswith(("assets/", "cesium/", "fonts/", "brand/", "data/"))
        ):
            shell.append("/" + file)
payload = json.dumps(sorted(shell))
(dist / "luna-shell.json").write_text(json.dumps({"version": sha256(payload.encode()).hexdigest()[:16], "files": sorted(shell)}))
print("Browser science and offline asset manifests ready.")
