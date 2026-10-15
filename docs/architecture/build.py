"""
Builds docs/architecture/architecture.svg: the whole stack, end to end, with the
official AWS architecture icons.

Laid out by hand on a grid rather than by Graphviz. Auto-layout put the family
along the bottom and the data tables under the compute, so a question and its
answer travelled the full height of the page. A reference diagram has to read left
to right in the order a request travels, so every position here is explicit.

Lines run in reserved corridors (the gutters between groups) and never cross a
group's title or another node, so each path can be followed on its own.

Icons are embedded as data URIs, so the SVG is one self-contained file that renders
on GitHub, in a browser, or dropped into a slide.

Run from this directory:  python3 build.py
"""

import base64
from pathlib import Path

HERE = Path(__file__).resolve().parent
ICONS = HERE / "icons"
W, H = 1720, 1120
ICON = 56

ASK = "#147EBA"
WATCH = "#D97A00"
EVENT = "#8C4FFF"
QUIET = "#8A94A3"
INK = "#232F3E"
MUTED = "#5F6B7A"

out: list[str] = []
labels: list[str] = []  # drawn last, above every line
nodes: dict[str, tuple[float, float]] = {}


def icon(name: str) -> str:
    return "data:image/png;base64," + base64.b64encode((ICONS / f"{name}.png").read_bytes()).decode()


def esc(text: str) -> str:
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def group(x, y, w, h, title, fill, stroke, sub="", dash=False):
    d = ' stroke-dasharray="6 5"' if dash else ""
    out.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="14" fill="{fill}" stroke="{stroke}" stroke-width="1.6"{d}/>')
    out.append(f'<text x="{x + 16}" y="{y + 25}" font-size="14" font-weight="700" fill="{stroke}">{esc(title)}</text>')
    if sub:
        out.append(f'<text x="{x + 16}" y="{y + 43}" font-size="11.5" fill="{MUTED}">{esc(sub)}</text>')


def node(key, cx, cy, name, title, *lines):
    nodes[key] = (cx, cy)
    out.append(f'<image href="{icon(name)}" x="{cx - ICON / 2}" y="{cy - ICON / 2}" width="{ICON}" height="{ICON}"/>')
    ty = cy + ICON / 2 + 17
    out.append(f'<text x="{cx}" y="{ty}" text-anchor="middle" font-size="13" font-weight="700" fill="{INK}">{esc(title)}</text>')
    for i, line in enumerate(lines):
        out.append(f'<text x="{cx}" y="{ty + 15 + i * 14}" text-anchor="middle" font-size="11" fill="{MUTED}">{esc(line)}</text>')


def label(x, y, text, color, anchor="middle"):
    for i, line in enumerate(text.split("\n")):
        labels.append(
            f'<text x="{x}" y="{y + i * 13}" text-anchor="{anchor}" font-size="11" fill="{color}" '
            f'font-weight="600" paint-order="stroke" stroke="#ffffff" stroke-width="4.5" '
            f'stroke-linejoin="round">{esc(line)}</text>'
        )


def edge(points, color, dash=False, width=2.0, head=True):
    d = " ".join(("M" if i == 0 else "L") + f"{x},{y}" for i, (x, y) in enumerate(points))
    style = ' stroke-dasharray="7 5"' if dash else ""
    marker = f' marker-end="url(#a{color[1:]})"' if head else ""
    out.append(f'<path d="{d}" fill="none" stroke="{color}" stroke-width="{width}" stroke-linejoin="round" stroke-linecap="round"{style}{marker}/>')


def L(key, dy=0):
    x, y = nodes[key]
    return (x - ICON / 2 - 5, y + dy)


def R(key, dy=0):
    x, y = nodes[key]
    return (x + ICON / 2 + 5, y + dy)


def T(key, dx=0):
    x, y = nodes[key]
    return (x + dx, y - ICON / 2 - 5)


def B(key, dx=0, under=0):
    """Below a node. `under` clears its label block; arrows ending here sit beneath it."""
    x, y = nodes[key]
    return (x + dx, y + ICON / 2 + 5 + under)


# ── Groups ─────────────────────────────────────────────────────────────────────
# Columns, left to right:  people 24-214 | gutter | edge 260-440 | API 470-610 |
# compute 640-1120 | shared 1150-1350 | data 1390-1700
group(24, 104, 190, 318, "Family", "#F7F4EF", "#A89C88", "the people being helped")
group(24, 448, 190, 206, "Mum's home", "#F7F4EF", "#A89C88", "the person living alone")
group(24, 680, 190, 168, "Other MCP clients", "#F7F4EF", "#A89C88", "", dash=True)

group(240, 76, 1466, 996, "AWS Cloud  ·  us-east-1  ·  118 resources, all in Terraform", "#FFFFFF", INK)

group(262, 124, 180, 600, "Edge", "#EEF6FC", ASK, "DNS · TLS · CDN")
group(650, 124, 470, 300, "The watching half", "#FFF5E8", WATCH, "runs on a timer, with nobody asking")
group(650, 456, 470, 270, "The asking half", "#EAF3FB", ASK, "MCP server · spec 2025-11-25 · Streamable HTTP")
group(650, 790, 470, 260, "Ring integration", "#F4EEFF", EVENT, "device events in, account linking")
group(1396, 124, 290, 600, "Data", "#F2F7F2", "#2E9E6B", "encrypted with a customer-managed key")
group(1150, 790, 536, 260, "Operations", "#F6F7F9", QUIET, "secrets, keys, and the alarms on silence")

# ── Nodes ──────────────────────────────────────────────────────────────────────
node("echo", 119, 196, "tablet", "Echo Show", "simulated in the browser", "asks by voice or text")
node("phone", 119, 334, "mobile", "Daughter's phone", "one short nudge")
node("cam", 119, 546, "camera", "Ring cameras", "and contact sensor", "motion · door · health")
node("client", 119, 772, "user", "Any MCP client", "Alexa+ · MCP Inspector")

node("dns", 352, 216, "route53", "Route 53", "stillthere.ogbes.com")
node("acm", 352, 362, "acm", "ACM", "TLS certificate")
node("cdn", 352, 508, "cloudfront", "CloudFront", "OAC · strict CSP · HSTS")
node("s3", 352, 646, "s3", "S3", "web app · private")

node("api", 548, 600, "apigateway", "API Gateway", "HTTP API · Origin check", "per-route throttling")

node("sched15", 730, 222, "scheduler", "Scheduler", "every 15 min")
node("schednight", 730, 352, "scheduler", "Scheduler", "00:05 nightly")
node("assess", 960, 222, "lambda", "assess", "learn · assess · notify")
node("reset", 960, 352, "lambda", "demo-reset", "rebuild the demo day")

node("assistant", 762, 600, "lambda", "assistant", "utterance → tool")
node("mcp", 1010, 600, "lambda", "mcp", "5 tools · MCP App view")

node("webhook", 762, 920, "lambda", "webhook", "HMAC · classify · dedupe")
node("token", 1010, 920, "lambda", "token · link", "account linking")

node("sns", 1250, 222, "sns", "SNS", "family notifications")
node("bedrock", 1250, 432, "bedrock", "Amazon Bedrock", "Nova Lite", "picks tools · words alerts")

node("events", 1541, 252, "dynamodb-table", "events", "activity · 90-day TTL", "assessment record")
node("state", 1541, 560, "dynamodb-table", "state", "config · devices", "health · pauses")

node("kms", 1260, 930, "kms", "KMS", "customer-managed key")
node("secrets", 1430, 930, "secrets", "Secrets Manager", "access code · Ring keys")
node("alarms", 1600, 930, "cloudwatch", "CloudWatch", "alarms on silence")

# ── Asking ─────────────────────────────────────────────────────────────────────
edge([R("echo"), (236, 196), (236, 216), L("dns")], ASK)
label(236, 186, "asks", ASK)
edge([B("dns", under=40), T("cdn")], ASK)
edge([R("acm"), (420, 362), (420, 498), R("cdn", -10)], QUIET, dash=True, width=1.4)
label(420, 434, "cert", QUIET)
edge([B("cdn", under=40), T("s3")], ASK)
label(352, 588, "static", ASK)
edge([R("cdn", 8), (456, 516), (456, 600), L("api")], ASK)
label(456, 560, "/api/*", ASK)

edge([R("api", -6), L("assistant", -6)], ASK)
label(686, 586, "/api/assistant", ASK)
edge([R("assistant"), L("mcp")], ASK)
label(886, 586, "MCP client · Streamable HTTP", ASK)
edge([T("assistant"), (762, 440), (1140, 440), (1140, 444), L("bedrock", 12)], ASK)
label(950, 434, "tools/list + utterance → which tool", ASK)
edge([R("api", 10), (626, 610), (626, 700), (1010, 700), B("mcp", under=34)], ASK)
label(818, 692, "/mcp · /api/mcp", ASK)
edge([R("client"), (232, 772), (232, 1090), (548, 1090), B("api", under=44)], ASK, dash=True)
label(390, 1082, "any MCP client · Bearer token · POST /mcp", ASK)
edge([R("mcp", 8), (1372, 608), (1372, 568), L("state", 8)], ASK)
label(1372, 600, "read · pause", ASK, anchor="end")
edge([R("mcp", -8), (1362, 592), (1362, 268), L("events", 16)], ASK)

# ── Watching ──────────────────────────────────────────────────────────────────
edge([R("sched15"), L("assess")], WATCH)
edge([R("schednight"), L("reset")], WATCH, dash=True)
edge([T("reset"), B("assess", under=34)], WATCH, dash=True)
label(986, 308, "invoke ×3", WATCH, anchor="start")
edge([R("assess", -6), L("sns", -6)], WATCH)
label(1105, 206, "once, then only\non escalation", WATCH)
edge([B("sns", under=34), T("bedrock")], WATCH, dash=True, head=False)
edge([R("assess", 10), (1180, 232), (1180, 422), L("bedrock", -10)], WATCH)
label(1180, 330, "word it,\nvalidate it", WATCH)
edge([R("assess", 22), (1150, 244), (1150, 268), (1340, 268), (1340, 236), L("events", -16)], WATCH)
label(1440, 228, "history · verdict", WATCH)
edge([R("reset"), (1130, 352), (1130, 380), (1352, 380), (1352, 252), L("events", 0)], WATCH, dash=True)
label(1296, 372, "rewrite", WATCH)
# The nudge leaves SNS over the top, in the gutter above every group.
edge([T("sns"), (1250, 60), (228, 60), (228, 334), R("phone")], WATCH)
label(860, 54, "nudge to the family, by SNS", WATCH)

# ── Device events ─────────────────────────────────────────────────────────────
edge([R("cam"), (246, 546), (246, 760), (604, 760), B("api", dx=56, under=0)], EVENT)
label(420, 752, "signed webhook", EVENT)
edge([B("api", dx=-14, under=44), (534, 920), L("webhook")], EVENT)
label(612, 912, "/ring/webhook", EVENT)
edge([(534, 940), (534, 1030), (1010, 1030), B("token", under=34)], EVENT, dash=True)
label(772, 1022, "/ring/token · /ring/link", EVENT)
edge([R("webhook", -8), (880, 912), (880, 770), (1382, 770), (1382, 576), L("state", 16)], EVENT)
label(1128, 762, "health · events", EVENT)
edge([R("webhook", 6), (892, 926), (892, 780), (1388, 780), (1388, 284), L("events", 32)], EVENT)

# ── Supporting ────────────────────────────────────────────────────────────────
edge([T("kms"), (1260, 744), (1541, 744), B("state", under=46)], QUIET, dash=True, width=1.4)
label(1400, 736, "encrypts both tables", QUIET)
edge([T("alarms"), (1600, 760), (1700, 760), (1700, 196), (1600, 196)], QUIET, dash=True, width=1.4, head=False)

# ── Legend, under the frame ───────────────────────────────────────────────────
legend = [
    (ASK, False, "Asking: a family member, or any MCP client"),
    (WATCH, False, "Watching: the scheduled assessment"),
    (EVENT, False, "Device events from Ring"),
    (QUIET, True, "Supporting: keys, certificates, alarms"),
]
for i, (color, dash, text) in enumerate(legend):
    x = 260 + i * 360
    d = ' stroke-dasharray="7 5"' if dash else ""
    out.append(f'<line x1="{x}" y1="1100" x2="{x + 34}" y2="1100" stroke="{color}" stroke-width="2.6"{d}/>')
    out.append(f'<text x="{x + 44}" y="1104" font-size="12" fill="{MUTED}">{esc(text)}</text>')

markers = "".join(
    f'<marker id="a{c[1:]}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" '
    f'orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="{c}"/></marker>'
    for c in (ASK, WATCH, EVENT, QUIET)
)

svg = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}"
     font-family="Helvetica, Arial, sans-serif" role="img" aria-labelledby="t d">
  <title id="t">StillThere architecture</title>
  <desc id="d">An MCP server on AWS for Alexa+. A family member asks through a simulated Echo Show. Route 53, CloudFront and API Gateway route the question to an assistant Lambda, which uses Amazon Bedrock to choose a tool on the MCP server Lambda. Separately, a scheduled assessment learns the resident's routine from DynamoDB and notifies the family through SNS when a usual habit does not happen. Ring device events arrive through a signed webhook.</desc>
  <defs>{markers}</defs>
  <rect width="{W}" height="{H}" fill="#ffffff"/>
  <text x="24" y="34" font-size="24" font-weight="700" fill="{INK}">StillThere</text>
  <text x="154" y="34" font-size="16" fill="{MUTED}">an Alexa+ MCP server on AWS that notices what didn't happen</text>
  {"".join(out)}
  {"".join(labels)}
</svg>
"""

(HERE / "architecture.svg").write_text(svg)
print(f"wrote architecture.svg ({len(svg) / 1024:.0f} KiB)")
