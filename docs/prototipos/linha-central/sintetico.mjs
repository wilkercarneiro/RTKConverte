import { mkdirSync as _mk } from "node:fs";
const _OUT = new URL("../../../tests/out/linha-central/", import.meta.url);
_mk(_OUT, { recursive: true });
// Testes sintéticos do motor da linha central.
import { estruturar, montar, quinasArco } from "./espinha.ts";
import { desenhar } from "./desenho.mjs";
const DIR = _OUT.pathname.replace(/^\/([A-Za-z]:)/, "$1");

function arco(c, r, a0, a1, passos) { const out = []; for (let i = 0; i <= passos; i++) { const a = a0 + ((a1 - a0) * i) / passos; out.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]); } return out; }
/** retângulo com esquinas arredondadas (raio R) — anel anti-horário; todas as arestas "rua" */
function retangulo(w, h, R, passos = 9) {
  const p = [];
  p.push(...arco([w - R, R], R, -Math.PI / 2, 0, passos));
  p.push(...arco([w - R, h - R], R, 0, Math.PI / 2, passos));
  p.push(...arco([R, h - R], R, Math.PI / 2, Math.PI, passos));
  p.push(...arco([R, R], R, Math.PI, 1.5 * Math.PI, passos));
  return p;
}
function resumo(nome, L) {
  const areas = L.lotes.map((l) => l.area);
  const mx = Math.max(...areas), mn = Math.min(...areas);
  const q5 = L.lotes.filter((l) => l.quinas.length > 4).length;
  const giros = L.lotes.flatMap((l) => l.giroLat.filter(Number.isFinite));
  console.log(`${nome}: ${L.lotes.length} lotes · áreas ${mn.toFixed(3)}–${mx.toFixed(3)} (T1 ${L.T1.toFixed(2)} T2 ${L.T2.toFixed(2)} ponta ${L.Tponta.toFixed(2)}) · >4 quinas: ${q5} · giro lateral máx ${giros.length ? Math.max(...giros).toFixed(2) : "-"}° · ${L.ms.toFixed(1)} ms ${L.avisos.length ? "· AVISOS: " + L.avisos.join(" | ") : ""}`);
}

// 1) retângulo 200×50 com esquinas R=6
{
  const anel = retangulo(200, 50, 6);
  console.log("quinas do retângulo arredondado:", quinasArco(anel).map((q) => `${q.giro.toFixed(0)}°${q.arco ? " arco r" + q.raio.toFixed(1) : ""}`).join(", "));
  const E = estruturar(anel, anel.map(() => "rua"));
  const L = montar(E, { N: 40, profMin: 15 });
  resumo("retângulo 200×50 R6, 40 lotes", L);
  desenhar(DIR + "s1_retangulo.svg", E, L, { titulo: "Retângulo 200×50, esquinas R=6, 40 lotes", giros: true });
}
// 2) trapézio: ruas que se abrem (fundo na bissetriz)
{
  const anel = [[0, 0], [220, 0], [220, 70], [0, 40]];
  const E = estruturar(anel, anel.map(() => "rua"));
  const L = montar(E, { N: 44, profMin: 15 });
  resumo("trapézio 40→70 m, 44 lotes", L);
  desenhar(DIR + "s2_trapezio.svg", E, L, { titulo: "Trapézio (ruas que se abrem), 44 lotes", giros: true });
}
// 3) rua de baixo com dobra de 20° no meio (a 5ª quina que o A-26 tem)
{
  const anel = [[0, 0], [110, 0], [215, 38], [215, 95], [0, 55]];
  const E = estruturar(anel, anel.map(() => "rua"));
  const L = montar(E, { N: 44, profMin: 15 });
  resumo("rua com dobra de 20°, 44 lotes", L);
  desenhar(DIR + "s3_dobra.svg", E, L, { titulo: "Rua de baixo com dobra de 20° (a divisa vai para a dobra)", giros: true });
}
// 4) triângulo comprido (ponta de fileira única)
{
  const anel = [[0, 0], [260, 0], [0, 70]];
  const E = estruturar(anel, anel.map(() => "rua"));
  const L = montar(E, { N: 30, profMin: 15 });
  resumo("triângulo com ponta, 30 lotes", L);
  desenhar(DIR + "s4_triangulo.svg", E, L, { titulo: "Quadra triangular: ponta em fileira única + duas fileiras", giros: true });
}
