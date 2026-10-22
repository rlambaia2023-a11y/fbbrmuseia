# Análise técnica automática de radiografia odontológica.
# Uso: python scripts/analisar-rx.py <caminho-da-imagem>
# Saída: JSON com exposição, contraste, nitidez e histograma.
# Avalia a QUALIDADE TÉCNICA da imagem (não faz diagnóstico).
import sys
import json

from PIL import Image
import numpy as np


def main():
    path = sys.argv[1]
    img = Image.open(path).convert("L")
    w, h = img.size
    a = np.asarray(img, dtype=np.float64)

    mean = float(a.mean())
    std = float(a.std())
    p5, p50, p95 = [float(x) for x in np.percentile(a, [5, 50, 95])]

    # Nitidez: variância do Laplaciano (bordas nítidas = valor alto)
    lap = 4 * a[1:-1, 1:-1] - a[:-2, 1:-1] - a[2:, 1:-1] - a[1:-1, :-2] - a[1:-1, 2:]
    sharp = float(lap.var())

    # Histograma em 16 faixas (0-255), normalizado
    hist, _ = np.histogram(a, bins=16, range=(0, 255))
    hist = (hist / hist.max()).tolist() if hist.max() else [0.0] * 16

    exposicao = "adequada"
    if mean < 55:
        exposicao = "subexposta (escura)"
    elif mean > 175:
        exposicao = "superexposta (clara)"

    contraste = "adequado" if std >= 35 else "baixo"

    nitidez = "adequada"
    if sharp < 60:
        nitidez = "baixa (possível desfoque ou artefato de movimento)"
    elif sharp < 150:
        nitidez = "moderada"

    print(json.dumps({
        "largura": w,
        "altura": h,
        "brilho_medio": round(mean, 1),
        "contraste_dp": round(std, 1),
        "percentis": {"p5": round(p5, 1), "p50": round(p50, 1), "p95": round(p95, 1)},
        "nitidez_score": round(sharp, 1),
        "histograma": [round(float(x), 3) for x in hist],
        "exposicao": exposicao,
        "contraste": contraste,
        "nitidez": nitidez,
    }))


if __name__ == "__main__":
    main()
