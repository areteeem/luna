"""Make the three f2c definitions match their existing call sites' return types.

Native calls ignore the return registers. Wasm validates the signature and
traps when otherwise identical call sites and definitions disagree.
"""
from pathlib import Path

def patch_abi(original: Path, out: Path):
    out.mkdir(parents=True, exist_ok=True)
    for name in ("s_copy", "s_cat", "rsfe"):
        text = (original / (name + ".c")).read_text()
        if name == "s_copy":
            text = text.replace("VOID s_copy", "int s_copy").replace("void s_copy", "int s_copy")
        elif name == "s_cat":
            text = text.replace(" VOID\n#ifdef KR_headers", " int\n#ifdef KR_headers")
        else:
            text = text.replace("void    zzsetnnread_", "int    zzsetnnread_").replace("void zzsetnnread_", "int zzsetnnread_")
        end = text.rfind("}")
        text = text[:end] + "    return 0;\n" + text[end:]
        (out / (name + ".c")).write_text(text)
