#!/usr/bin/env python3
"""Daily founder counter: reads the real spots left from the public Gumroad product page and writes them into
index.html (data-cupos, data-cupos-fecha and the sticky bar). Run by .github/workflows/counter.yml.

Exit codes: 0 = done (changed or not), 1 = could not read Gumroad or the page markers (nothing written),
2 = sold out (nothing written: switch the site to the regular US$137 page by hand)."""
import datetime, html, re, sys, urllib.request
from zoneinfo import ZoneInfo

PRODUCT = "https://ospinaduque.gumroad.com/l/video-editor-kit"
PAGE = "index.html"
# Keep in sync with funnel/copy/copy-v3.json (sticky_text_all / sticky_text) in the video-editor-offer repo.
STICKY_ALL = "Precio fundador US$97 · Solo 30 cupos · Luego US$137 · Garantía de 15 días"
STICKY_N = "Quedan {N} de 30 cupos a US$97 · Luego US$137 · Garantía de 15 días"

req = urllib.request.Request(PRODUCT, headers={"User-Agent": "Mozilla/5.0 (counter bot)"})
raw = html.unescape(html.unescape(urllib.request.urlopen(req, timeout=30).read().decode("utf-8", "replace")))
m = re.search(r'"quantity_remaining":(\d+),[^{}]*?"is_sales_limited":true', raw) or re.search(r'"quantity_remaining":(\d+)', raw)
if not m or '"price_cents":9700' not in raw:
    sys.exit("could not read quantity_remaining for the US$97 product: page left as it is")
left = int(m.group(1))
if left == 0:
    print("SOLD OUT: the 30 founder spots are gone. Publish the regular US$137 page (PRICE_MODE=regular) and set Gumroad to 137.")
    sys.exit(2)
left = min(left, 30)
today = datetime.datetime.now(ZoneInfo("America/Bogota")).strftime("%d/%m")
s = open(PAGE, encoding="utf-8").read()
if "data-cupos>" not in s or "data-cupos-fecha>" not in s or 'class="sticky-buy"' not in s:
    sys.exit("counter markers not found in index.html: page left as it is")
t = re.sub(r"<b data-cupos>\d+</b>", f"<b data-cupos>{left}</b>", s, count=1)
t = re.sub(r"<span data-cupos-fecha>[^<]*</span>", f"<span data-cupos-fecha>{today}</span>", t, count=1)
sticky = STICKY_ALL if left == 30 else STICKY_N.replace("{N}", str(left))
t = re.sub(r'(<div class="sticky-buy"><span>)[^<]*(</span>)', lambda m2: m2.group(1) + html.escape(sticky, quote=False) + m2.group(2), t, count=1)
if t != s:
    open(PAGE, "w", encoding="utf-8").write(t)
print(f"spots left {left}, date {today}, {'updated' if t != s else 'unchanged'}")
