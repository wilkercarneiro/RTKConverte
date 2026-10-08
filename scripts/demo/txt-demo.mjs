// TXT de levantamento FICTÍCIO para o ambiente de demonstração.
//
// Mesmo formato do receptor (num[rótulo];E;N;h;σpos;σh, decimal com vírgula),
// mas com perímetro sintético: um polígono irregular de ~60 ha gerado por
// fórmula, sem relação com imóvel real. Nada de cliente aparece na demo.
// Fuso 24S, região de Feira de Santana/BA (só para o fuso e o mapa fazerem sentido).

const CENTRO = { e: 512_400, n: 8_640_300 };
const RAIO_M = 440;
const PONTOS = 28;
// onde começa cada confrontação (rótulo colado ao número, como o receptor grava)
const ROTULOS = new Map([
  [1, "estrada/vicinal"],
  [8, "joao/ficticio"],
  [15, "maria/ficticia"],
  [22, "corrego/exemplo"],
]);

const fmt = (x, casas) => x.toFixed(casas).replace(".", ",");

export function gerarTxtDemo() {
  const linhas = [];
  for (let i = 0; i < PONTOS; i++) {
    const t = (i / PONTOS) * 2 * Math.PI;
    // raio ondulado → contorno irregular, sempre simples (sem autointerseção)
    const r = RAIO_M * (1 + 0.18 * Math.sin(3 * t) + 0.07 * Math.cos(5 * t));
    const e = CENTRO.e + r * Math.cos(t);
    const n = CENTRO.n + r * Math.sin(-t); // sentido horário
    const h = 238 + 12 * Math.sin(2 * t);
    const sp = 0.004 + 0.002 * ((i * 7) % 5) / 5;
    const sh = sp * 1.6;
    const num = i + 1;
    linhas.push(`${num}${ROTULOS.get(num) ?? ""};${fmt(e, 3)};${fmt(n, 3)};${fmt(h, 3)};${fmt(sp, 6)};${fmt(sh, 6)}`);
  }
  return linhas.join("\r\n") + "\r\n";
}

export const NOME_TXT_DEMO = "FAZENDA-BOA-VISTA-DEMO.txt";
