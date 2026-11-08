// Avalia a precisão do GPS com um arquivo do modo diagnóstico do Medir no campo.
//
//   node scripts/avaliar-gps.mjs leituras.json -12.345678 -38.123456
//   node scripts/avaliar-gps.mjs leituras.json "512345,67 8634567,89 24"
//
// A coordenada é a do marco onde o celular ficou parado (SIGEF, IBGE, RTK).
// Mostra o erro de cada leitura crua (média, 68%, 95%) e o erro do ponto do
// "Marcar ponto" com 5 s, 20 s, 60 s e 180 s de média (janelas seguidas, sem
// sobrepor), já com as leituras repetidas tiradas. É a régua do estudo
// (docs/estudo-precisao-gps-campo.md, seção 6): reprocessar o MESMO arquivo
// depois de cada mudança no motor e comparar.
import { readFileSync } from "node:fs";
import { lerArquivoDiagnostico, errosContra } from "../src/lib/campo/diagnostico.ts";
import { combinarLeituras, semRepetidas } from "../src/lib/campo/motor.ts";
import { estadoAquecimento } from "../src/lib/campo/filtro.ts";
import { lerCoordenadaMarco } from "../src/lib/campo/calibracao.ts";
import { distanciaM } from "../src/lib/campo/geometria.ts";

const [arquivo, ...resto] = process.argv.slice(2);
if (!arquivo || !resto.length) {
  console.error("uso: node scripts/avaliar-gps.mjs <leituras.json> <lat lon | E N fuso>");
  process.exit(1);
}
const marco = lerCoordenadaMarco(resto.join(" "));
if ("erro" in marco) { console.error(marco.erro); process.exit(1); }
const todas = lerArquivoDiagnostico(readFileSync(arquivo, "utf8"));
if (!todas) { console.error("O arquivo não tem leituras do diagnóstico."); process.exit(1); }

const leituras = semRepetidas(todas).sort((a, b) => a.t - b.t);
const m = (x) => (Number.isFinite(x) ? x.toFixed(2).replace(".", ",") : "—");
const linha = (rotulo, e) => console.log(`${rotulo.padEnd(34)} n=${String(e.n).padStart(5)}  média ${m(e.mediaM)} m  68% ${m(e.p68M)} m  95% ${m(e.p95M)} m  pior ${m(e.maxM)} m`);

console.log(`\n${arquivo}: ${todas.length} leituras (${todas.length - leituras.length} repetidas fora), ${((leituras.at(-1).t - leituras[0].t) / 60000).toFixed(1)} min`);
console.log(`marco: ${marco.lat.toFixed(7)}, ${marco.lon.toFixed(7)}\n`);

linha("leitura crua", errosContra(leituras, marco, distanciaM));

// aquecimento: o mesmo, sem as leituras de antes de o GPS assentar
let corte = 0;
for (let i = 0; i < leituras.length; i++) {
  if (estadoAquecimento(leituras.slice(0, i + 1), leituras[i].t).pronto) { corte = i; break; }
}
linha(`depois do aquecimento (${Math.round((leituras[corte].t - leituras[0].t) / 1000)} s)`, errosContra(leituras.slice(corte), marco, distanciaM));

// precisão informada × erro de verdade: quantas leituras caem dentro do próprio "±"
const comPrec = leituras.filter((l) => l.precisao != null);
if (comPrec.length) {
  const dentro = comPrec.filter((l) => distanciaM(l, marco) <= l.precisao).length;
  const dentro95 = comPrec.filter((l) => distanciaM(l, marco) <= 1.62 * l.precisao).length;
  console.log(`dentro do "±" informado: ${((100 * dentro) / comPrec.length).toFixed(0)}% (o esperado é 68%) · dentro de 1,62×: ${((100 * dentro95) / comPrec.length).toFixed(0)}% (esperado 95%)`);
}

console.log("\nMarcar ponto (janelas seguidas, depois do aquecimento):");
const uteis = leituras.slice(corte);
for (const s of [5, 20, 60, 180]) {
  const pontos = [];
  let ini = 0;
  while (ini < uteis.length) {
    const t0 = uteis[ini].t;
    let fim = ini;
    while (fim < uteis.length && uteis[fim].t - t0 < s * 1000) fim++;
    if (uteis[fim - 1].t - t0 >= s * 1000 * 0.8) {
      const p = combinarLeituras(uteis.slice(ini, fim));
      if (p) pontos.push({ ...p, t: t0 });
    }
    ini = fim;
  }
  if (pontos.length) linha(`  ${String(s).padStart(3)} s de média`, errosContra(pontos, marco, distanciaM));
  else console.log(`  ${String(s).padStart(3)} s de média: o arquivo é curto demais`);
}
console.log("");
