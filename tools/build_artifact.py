"""Maakt van de app één los HTML-bestand voor een claude.ai-artifact
(daar mogen geen eigen bestanden of koersen van internet worden geladen).
Gebruik: python tools/build_artifact.py uitvoer.html"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
html = (ROOT / "index.html").read_text(encoding="utf-8")
head = html.split("<!--HEAD-START-->")[1].split("<!--HEAD-END-->")[0]
body = html.split("<!--BODY-START-->")[1].split("<!--BODY-END-->")[0]

head = re.sub(r'<link rel="(manifest|icon|apple-touch-icon)"[^>]*>\n?', "", head)
head = head.replace('<link rel="stylesheet" href="style.css">',
                    "<style>\n" + (ROOT / "style.css").read_text(encoding="utf-8") + "</style>")

def inline(m):
    return "<script>\n" + (ROOT / m.group(1)).read_text(encoding="utf-8") + "</script>"

body = re.sub(r'<script src="(js/[^"]+)"></script>', inline, body)
body = body.replace("<!--SCRIPTS-->",
    "<script>window.BELEG_ARTIFACT = true; window.BELEG_NO_SW = true; window.BELEG_DEFAULT_PROVIDER = \"demo\";</script>")
Path(sys.argv[1]).write_text(head.strip() + "\n" + body, encoding="utf-8")
print("geschreven:", sys.argv[1])
