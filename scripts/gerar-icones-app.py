# Ícones do app (PWA do /app/ e app Android) a partir do desenho de
# public/favicon.svg — o mesmo traço, redesenhado aqui com o Pillow para não
# depender de conversor de SVG. Se o favicon mudar, ajuste DESENHO abaixo.
#
#   C:\Python314\python.exe scripts/gerar-icones-app.py
#
# Saída:
#   public/icones/icone-192.png, icone-512.png          (ícone "any", cantos redondos)
#   public/icones/icone-maskable-512.png                (fundo cheio, marca na zona segura)
#   public/apple-touch-icon.png                         (180, fundo cheio — o iOS arredonda)
#   android/app/src/main/res/mipmap-*/ic_launcher*.png  (legado + redondo + adaptativo)
#   android/app/src/main/res/drawable-*/splash.png      (marca sobre o verde da splash)
from pathlib import Path
from PIL import Image, ImageDraw

RAIZ = Path(__file__).resolve().parent.parent
VERDE = (0x0E, 0x3B, 0x2B, 255)
ACENTO = (0x7B, 0xD3, 0xA6, 255)
BRANCO = (255, 255, 255, 255)
SS = 4  # superamostragem (desenha 4x e reduz: bordas lisas)


def glifo(d: ImageDraw.ImageDraw, ox: float, oy: float, s: float) -> None:
    """A marca do favicon (viewBox 28x28) com origem (ox, oy) e escala s px/unidade."""
    p = lambda x, y: (ox + x * s, oy + y * s)
    meia = 1.2 * s  # metade da espessura do traço (2.4)
    # cada perna como um quadrilátero: o d.line do Pillow deixa um entalhe na junção
    for (a, b) in ((p(6, 21), p(14, 7)), (p(14, 7), p(22, 21))):
        dx, dy = b[0] - a[0], b[1] - a[1]
        n = (dx * dx + dy * dy) ** 0.5
        nx, ny = -dy / n * meia, dx / n * meia
        d.polygon([(a[0] + nx, a[1] + ny), (b[0] + nx, b[1] + ny), (b[0] - nx, b[1] - ny), (a[0] - nx, a[1] - ny)], fill=ACENTO)
    # a junção e as pontas ficam sob os círculos, como no SVG
    for (cx, cy, r, cor) in ((14, 7, 2.6, ACENTO), (6, 21, 2, BRANCO), (22, 21, 2, BRANCO)):
        x, y = p(cx, cy)
        d.ellipse([x - r * s, y - r * s, x + r * s, y + r * s], fill=cor)


def icone(tam: int, forma: str, ocupa: float = 1.0) -> Image.Image:
    """forma: 'redondo' (retângulo de cantos redondos, como o favicon), 'cheio'
    (quadrado verde inteiro), 'circulo' ou 'transparente' (só a marca).
    `ocupa`: fração do lado ocupada pelo quadro 28x28 do desenho."""
    T = tam * SS
    im = Image.new("RGBA", (T, T), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    if forma == "redondo":
        m = T * (1 - ocupa) / 2
        d.rounded_rectangle([m, m, T - m, T - m], radius=(T - 2 * m) * 7 / 28, fill=VERDE)
    elif forma == "cheio":
        d.rectangle([0, 0, T, T], fill=VERDE)
    elif forma == "circulo":
        d.ellipse([0, 0, T - 1, T - 1], fill=VERDE)
    lado = T * ocupa
    s = lado / 28
    o = (T - lado) / 2
    glifo(d, o, o, s)
    return im.resize((tam, tam), Image.LANCZOS)


def salvar(im: Image.Image, caminho: Path) -> None:
    caminho.parent.mkdir(parents=True, exist_ok=True)
    im.save(caminho, optimize=True)
    print("  ", caminho.relative_to(RAIZ))


def main() -> None:
    pub = RAIZ / "public"
    salvar(icone(192, "redondo"), pub / "icones" / "icone-192.png")
    salvar(icone(512, "redondo"), pub / "icones" / "icone-512.png")
    # maskable: a zona segura é o círculo de 80% do lado; o desenho útil ocupa ~71% do quadro
    salvar(icone(512, "cheio", 0.78), pub / "icones" / "icone-maskable-512.png")
    salvar(icone(180, "cheio", 0.86), pub / "apple-touch-icon.png")

    res = RAIZ / "android" / "app" / "src" / "main" / "res"
    densidades = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}
    for nome, f in densidades.items():
        salvar(icone(round(48 * f), "redondo", 0.92), res / f"mipmap-{nome}" / "ic_launcher.png")
        salvar(icone(round(48 * f), "circulo", 0.86), res / f"mipmap-{nome}" / "ic_launcher_round.png")
        # adaptativo: camada de 108 dp; o que aparece com certeza é o círculo de 66 dp do meio
        salvar(icone(round(108 * f), "transparente", 0.56), res / f"mipmap-{nome}" / "ic_launcher_foreground.png")
        salvar(icone(round(96 * f), "transparente", 1.0), res / f"drawable-{nome}" / "splash.png")


if __name__ == "__main__":
    main()
