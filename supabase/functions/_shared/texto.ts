// Texto que vem do operador (descritivo do confrontante, nome do proprietário,
// denominação) antes de virar desenho ou documento.
//
// Duas coisas moram aqui porque as duas nasceram do mesmo defeito: um descritivo
// colado do Word no serviço FAZENDA RIACHO DA CRUZ chegou com quebras de linha
// DE VERDADE (0x0A) no lugar da contrabarra que o sistema usa como separador.
// O resultado foi a planta inteira não sair — `widthOfTextAtSize` do pdf-lib
// estoura com `WinAnsi cannot encode "\n" (0x000a)` — e o memorial sair com o
// confrontante espremido em uma linha só.
//
// As classes de caracteres são escritas por código, e não como literais dentro
// de uma expressão regular, porque literal invisível em código-fonte é
// exatamente o tipo de coisa que se perde numa edição e ninguém vê.

/** Separador de linha: LF, CR, NEL, LINE SEPARATOR e PARAGRAPH SEPARATOR. */
function ehQuebra(cp: number): boolean {
  return cp === 0x0a || cp === 0x0d || cp === 0x85 || cp === 0x2028 || cp === 0x2029;
}

/** Espaço em qualquer forma: comum, tabulação, inseparável, de largura fixa. */
function ehEspaco(cp: number): boolean {
  return cp === 0x20 || cp === 0x09 || cp === 0x0b || cp === 0x0c ||
    cp === 0xa0 || cp === 0x1680 || cp === 0x202f || cp === 0x205f || cp === 0x3000 ||
    (cp >= 0x2000 && cp <= 0x200a) || ehQuebra(cp);
}

/** Controle ou marca sem glifo: BOM, joiners, marcas de direção. */
function ehInvisivel(cp: number): boolean {
  return cp < 0x20 || (cp >= 0x7f && cp <= 0x9f) ||
    (cp >= 0x200b && cp <= 0x200f) || cp === 0x2060 || cp === 0xfeff;
}

/**
 * Quebra o descritivo formal nas suas partes.
 *
 * O separador do sistema é a contrabarra:
 *   `(MATR.432/CNS.00.770-8) FAZENDA LAMEIRO\ RUDSON PINTO FERREIRA\ CPF:791…`
 *
 * Quebra de linha de verdade vale como o mesmo separador. Ela aparece toda vez
 * que o descritivo é colado de um editor de texto, e tratá-la como caractere
 * comum não deixa o texto "um pouco errado": derruba a planta e junta as linhas
 * do memorial. É o mesmo campo com a mesma intenção do operador — uma linha por
 * pedaço da confrontação.
 */
export function partesDescritivo(descritivo: string): string[] {
  const partes: string[] = [];
  let atual = "";
  for (const ch of descritivo) {
    if (ch === "\\" || ehQuebra(ch.codePointAt(0)!)) { partes.push(atual); atual = ""; }
    else atual += ch;
  }
  partes.push(atual);
  return partes.map((p) => p.trim()).filter(Boolean);
}

// Caracteres da WinAnsi que não estão em Latin-1 (a faixa 0x80–0x9F da tabela):
// aspas e travessões tipográficos, reticências, símbolo de euro. São justamente
// os que o Word insere sozinho enquanto se digita.
const WINANSI_EXTRA = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030,
  0x0160, 0x2039, 0x0152, 0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022,
  0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178,
]);

function encodavel(cp: number): boolean {
  // 0x20–0x7E: ASCII imprimível. 0xA1–0xFF: Latin-1, onde mora a acentuação
  // portuguesa. 0xA0 (espaço inseparável) fica de fora de propósito — já virou
  // espaço comum na normalização abaixo.
  return (cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa1 && cp <= 0xff) || WINANSI_EXTRA.has(cp);
}

/**
 * Deixa o texto desenhável pelas fontes padrão do PDF (codificação WinAnsi).
 *
 * A fonte padrão do pdf-lib recusa — com exceção, não com um quadradinho — todo
 * caractere fora da tabela WinAnsi. Como a planta é desenhada em uma passada só,
 * UM caractere impróprio em UM campo derruba a folha inteira e o operador recebe
 * "a planta falhou" sem saber de onde veio. Aqui o caractere é convertido, não
 * fatal:
 *
 *   - quebra de linha, tabulação e espaços exóticos viram espaço comum (quem
 *     quebra linha no desenho é `partesDescritivo`, não o caractere solto);
 *   - letra acentuada fora da tabela cai para a letra base (`ā` → `a`);
 *   - o que sobra é descartado, porque desenhar um caractere a menos é melhor do
 *     que não desenhar a planta.
 *
 * Aplicado no ponto em que o texto vira glifo (`texto`, `textoFit`,
 * `quebrarLinhas`), então nenhum campo novo precisa lembrar de chamar isto.
 */
export function textoWinAnsi(t: string): string {
  let out = "";
  for (const ch of t.normalize("NFC")) {
    const cp = ch.codePointAt(0)!;
    if (ehEspaco(cp)) { out += " "; continue; }
    if (ehInvisivel(cp)) continue;
    if (encodavel(cp)) { out += ch; continue; }
    // acentuada fora da tabela: cai para a letra base
    for (const base of ch.normalize("NFD").replace(/\p{M}+/gu, "")) {
      if (encodavel(base.codePointAt(0)!)) out += base;
    }
  }
  return out;
}
