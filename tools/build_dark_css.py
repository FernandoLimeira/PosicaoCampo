"""Gera o modo escuro (tons de cinza escuro) a partir do CSS claro.

Para cada ``static/css/**/X.css`` cria ``X.dark.css`` com as mesmas regras, mas só
as declarações que têm cor, com a cor convertida para o tema escuro. Os templates
carregam cada arquivo escuro com ``media="(prefers-color-scheme: dark)"``: ele só
vale quando o navegador (ou o sistema) está em modo escuro.

Rode depois de mudar qualquer CSS:

    python tools/build_dark_css.py

O teste ``tests/test_dark_css.py`` falha se algum ``.dark.css`` estiver desatualizado.

Regras de conversão (pela propriedade):
- fundo claro vira cinza escuro (cartões um pouco mais claros que a página);
- texto escuro vira cinza claro; texto claro (sobre botão colorido) continua claro;
- borda clara vira cinza médio;
- cores de destaque (verde, vermelho, amarelo...) mantêm o tom, ajustado ao fundo escuro;
- branco/preto translúcidos (brilhos, sombras, sobreposições) ficam como estão.
"""
from __future__ import annotations

import colorsys
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CSS_DIR = ROOT / "static" / "css"
HEADER = "/* Gerado por tools/build_dark_css.py a partir de {name}. Não edite: rode o script. */\n"

COLOR_RE = re.compile(
    r"#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b|rgba?\(\s*[\d.]+%?\s*,?\s*[\d.]+%?\s*,?\s*[\d.]+%?\s*(?:[,/]\s*[\d.]+%?\s*)?\)"
    r"|\b(?:white|black)\b"
)
TEXT_PROPS = {"color", "fill", "stroke", "caret-color", "-webkit-text-fill-color", "text-decoration-color"}
SHADOW_PROPS = {"box-shadow", "text-shadow", "filter"}


# ---------------------------------------------------------------------------
# Cores
# ---------------------------------------------------------------------------
def parse_color(text: str) -> tuple[float, float, float, float] | None:
    text = text.strip().lower()
    if text == "white":
        return 255, 255, 255, 1.0
    if text == "black":
        return 0, 0, 0, 1.0
    if text.startswith("#"):
        digits = text[1:]
        if len(digits) in (3, 4):
            digits = "".join(ch * 2 for ch in digits)
        r, g, b = (int(digits[i:i + 2], 16) for i in (0, 2, 4))
        a = int(digits[6:8], 16) / 255 if len(digits) == 8 else 1.0
        return r, g, b, a
    parts = re.findall(r"[\d.]+%?", text)
    if len(parts) < 3:
        return None

    def channel(value: str) -> float:
        return float(value[:-1]) * 2.55 if value.endswith("%") else float(value)
    alpha = parts[3] if len(parts) > 3 else "1"
    a = float(alpha[:-1]) / 100 if alpha.endswith("%") else float(alpha)
    return channel(parts[0]), channel(parts[1]), channel(parts[2]), a


def format_color(r: float, g: float, b: float, a: float) -> str:
    r, g, b = (max(0, min(255, round(v))) for v in (r, g, b))
    if a >= 0.999:
        return f"#{r:02x}{g:02x}{b:02x}"
    return f"rgba({r}, {g}, {b}, {round(a, 3):g})"


def _hls(r, g, b):
    return colorsys.rgb_to_hls(r / 255, g / 255, b / 255)


def _rgb(h, l, s):
    return tuple(v * 255 for v in colorsys.hls_to_rgb(h, max(0.0, min(1.0, l)), max(0.0, min(1.0, s))))


def _chroma(r, g, b) -> float:
    return max(r, g, b) - min(r, g, b)


def _tone(r, g, b, l_new, *, gray_below=20, tint=0.22):
    """Mesma matiz com luminosidade nova; quase neutros viram cinza puro."""
    h, _, s = _hls(r, g, b)
    if _chroma(r, g, b) < gray_below:
        return _rgb(0, l_new, 0)
    return _rgb(h, l_new, min(s, tint))


def map_background(r, g, b):
    h, l, s = _hls(r, g, b)
    if _chroma(r, g, b) >= 60 and l < 0.85:  # botões e marcas coloridas: mantém a cor
        return _rgb(h, max(0.38, min(l, 0.55)), min(s, 0.55))
    if l >= 0.9:  # superfícies: branco = cartão (mais claro), página um pouco mais escura
        return _tone(r, g, b, 0.165 - (1 - l) * 0.5, gray_below=12, tint=0.16)
    if l >= 0.6:  # realces e tintas suaves: um pouco acima do cartão
        return _tone(r, g, b, 0.19 + (0.9 - l) * 0.3, gray_below=12, tint=0.18)
    # fundos escuros pouco saturados (barra lateral, cabeçalhos): cinza escuro
    return _tone(r, g, b, max(0.17, min(l, 0.24)), gray_below=255)


def map_border(r, g, b):
    _, l, _ = _hls(r, g, b)
    if l >= 0.6:
        return _tone(r, g, b, 0.25 + (0.95 - min(l, 0.95)) * 0.3, tint=0.08)
    if _chroma(r, g, b) >= 60:
        h, _, s = _hls(r, g, b)
        return _rgb(h, max(l, 0.42), min(s, 0.55))
    return _tone(r, g, b, 0.38, gray_below=255)


def map_text(r, g, b):
    h, l, s = _hls(r, g, b)
    if l >= 0.75:  # texto claro (sobre botão ou faixa colorida) continua claro
        return r, g, b
    l_new = max(0.6, min(0.9, 1.02 - l))
    if _chroma(r, g, b) < 40:
        return _rgb(0, l_new, 0)
    return _rgb(h, min(l_new, 0.78), min(s, 0.6))


def convert_color(text: str, kind: str) -> str:
    parsed = parse_color(text)
    if parsed is None:
        return text
    r, g, b, a = parsed
    # Preto translúcido (sombras, véus) e branco bem transparente (brilhos) funcionam
    # igual no escuro; branco quase opaco é fundo e vira cinza escuro.
    if a < 0.999 and _chroma(r, g, b) < 14 and (max(r, g, b) < 40 or (min(r, g, b) > 230 and a < 0.3)):
        return text
    if kind == "shadow":
        if a < 0.999 or _hls(r, g, b)[1] < 0.6:
            return text
        mapped = map_border(r, g, b)
    elif kind == "text":
        mapped = map_text(r, g, b)
    elif kind == "border":
        mapped = map_border(r, g, b)
    else:
        mapped = map_background(r, g, b)
    return format_color(*mapped, a)


def property_kind(prop: str) -> str:
    prop = prop.strip().lower()
    if prop.startswith("--"):
        name = prop[2:]
        if "shadow" in name:
            return "shadow"
        if any(word in name for word in ("text", "muted", "ink", "fg", "foreground")):
            return "text"
        if any(word in name for word in ("border", "line", "outline")):
            return "border"
        return "background"
    if prop in TEXT_PROPS:
        return "text"
    if prop in SHADOW_PROPS:
        return "shadow"
    if "border" in prop or "outline" in prop or "column-rule" in prop:
        return "border"
    return "background"


def convert_value(prop: str, value: str) -> str:
    kind = property_kind(prop)
    return COLOR_RE.sub(lambda match: convert_color(match.group(0), kind), value)


# Ajustes finos que a conversão automática não decide sozinha, por arquivo de origem.
# Ficam depois das regras convertidas, então vencem.
OVERRIDES = {
    "base.css": """:root {
  --data-hover: #333333; --control-hover: #343434; --control-surface: #2e2e2e;
  --green-pale: #252b2d; --line: #3a3a3a; --data-border: #3a3a3a; --control-border: #464646;
  --data-header: #1b3a41; --page: #1e1e1e; --surface: #2a2a2a; --data-surface: #282828;
  /* Paleta petróleo: barra lateral e destaques; o resto em cinza escuro. */
  --green: #3f6f7a; --green-strong: #2e5a63; --green-soft: #22333a; --control-text: #a9c6cf;
  --nav-background: linear-gradient(165deg, #122e34 0%, #0e1d21 100%);
}
""",
    # Botões principais e aba ativa do painel mantêm o petróleo da paleta no escuro.
    "pages/producao.css": """.production-primary-button.pdash-action { background: linear-gradient(135deg, #3f6f7a 0%, #1b3a41 100%); }
.production-primary-button.pdash-action:hover:not(:disabled) { background: linear-gradient(135deg, #4a7c87 0%, #22474e 100%); }
.pdash-group-tab.is-active { background: linear-gradient(135deg, #3f6f7a 0%, #1b3a41 100%); color: #ffffff; }
""",
    # Folhas decorativas do login têm cor fixa no SVG: no escuro ficam bem discretas.
    "auth.css": """.auth-panel-leaves { opacity: .06; }
""",
}


# ---------------------------------------------------------------------------
# CSS (parser simples: regras, @media/@supports aninhados, declarações)
# ---------------------------------------------------------------------------
def _strip_comments(css: str) -> str:
    return re.sub(r"/\*.*?\*/", "", css, flags=re.S)


def _parse_block(css: str, start: int = 0):
    """Lê nós até o fim do texto ou até o ``}`` que fecha o bloco atual."""
    nodes, i, n = [], start, len(css)
    while i < n:
        while i < n and css[i] in " \t\r\n":
            i += 1
        if i >= n:
            break
        if css[i] == "}":
            return nodes, i + 1
        j = i
        depth = 0
        while j < n and not (depth == 0 and css[j] in "{;}"):
            if css[j] == "(":
                depth += 1
            elif css[j] == ")":
                depth -= 1
            elif css[j] in "\"'":
                j = css.index(css[j], j + 1)
            j += 1
        prelude = css[i:j].strip()
        if j >= n or css[j] in ";}":
            i = j + 1 if j < n and css[j] == ";" else j
            continue  # @import/@charset ou lixo: nada a converter
        if prelude.startswith("@") and not prelude.lower().startswith(("@font-face", "@page")):
            children, i = _parse_block(css, j + 1)
            nodes.append(("at", prelude, children))
        else:
            end = _block_end(css, j + 1)
            nodes.append(("rule", prelude, css[j + 1:end]))
            i = end + 1
    return nodes, i


def _block_end(css: str, i: int) -> int:
    depth = 0
    while i < len(css):
        ch = css[i]
        if ch in "\"'":
            i = css.index(ch, i + 1)
        elif ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        elif ch == "}" and depth == 0:
            return i
        i += 1
    return i


def _declarations(body: str):
    parts, depth, current, quote = [], 0, "", ""
    for ch in body:
        if quote:
            current += ch
            if ch == quote:
                quote = ""
            continue
        if ch in "\"'":
            quote = ch
        elif ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        elif ch == ";" and depth == 0:
            parts.append(current)
            current = ""
            continue
        current += ch
    parts.append(current)
    for part in parts:
        if ":" not in part:
            continue
        prop, value = part.split(":", 1)
        prop, value = prop.strip(), value.strip()
        if prop:
            yield prop, value


def _render(nodes, indent="") -> list[str]:
    out = []
    for node in nodes:
        if node[0] == "at":
            prelude, children = node[1], node[2]
            if prelude.lower().startswith("@keyframes") or re.match(r"@media\s+print(?![\w-])", prelude, re.I):
                continue  # animações sem cor relevante; impressão continua clara
            inner = _render(children, indent + "  ")
            if inner:
                out.append(f"{indent}{prelude} {{")
                out.extend(inner)
                out.append(f"{indent}}}")
            continue
        selector, body = node[1], node[2]
        changed = []
        for prop, value in _declarations(body):
            if not COLOR_RE.search(value):
                continue
            new = convert_value(prop, value)
            if new != value:
                changed.append(f"{prop}: {new}")
        if changed:
            selector = " ".join(selector.split())
            out.append(f"{indent}{selector} {{ {'; '.join(changed)}; }}")
    return out


def build(path: Path) -> str:
    nodes, _ = _parse_block(_strip_comments(path.read_text(encoding="utf-8")))
    lines = _render(nodes)
    # Controles nativos (barras de rolagem, datas, selects) também no escuro.
    head = ":root { color-scheme: dark; }\n" if path.name == "base.css" else ""
    tail = OVERRIDES.get(path.relative_to(CSS_DIR).as_posix(), "")
    return HEADER.format(name=path.relative_to(CSS_DIR).as_posix()) + head + "\n".join(lines) + "\n" + tail


def sources() -> list[Path]:
    return sorted(path for path in CSS_DIR.rglob("*.css") if not path.name.endswith(".dark.css"))


def dark_path(path: Path) -> Path:
    return path.with_name(path.stem + ".dark.css")


def main(argv: list[str]) -> int:
    check = "--check" in argv
    stale = []
    for path in sources():
        target, content = dark_path(path), build(path)
        current = target.read_text(encoding="utf-8") if target.exists() else None
        if current != content:
            stale.append(target)
            if not check:
                target.write_text(content, encoding="utf-8", newline="\n")
    for target in stale:
        print(("desatualizado: " if check else "gerado: ") + target.relative_to(ROOT).as_posix())
    return 1 if check and stale else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
