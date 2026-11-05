// Grava as respostas REAIS das bases públicas para os testes da análise de
// restrições (tests/restricoes.test.mjs), que rodam sem internet.
//
//   node scripts/gravar_fixtures_restricoes.mjs
//
// Para cada caso, roda consultarRestricoes com um fetch que guarda cada resposta
// em tests/fixtures/restricoes/<caso>.json. Respostas acima de 400 KB não são
// guardadas (o teste trata como "servidor fora do ar"). Os embargos vêm sem nome
// e CPF/CNPJ do embargado: a lib não pede esses campos.
import fs from "node:fs";
import path from "node:path";
import { consultarRestricoes } from "../src/lib/restricoes.ts";

export const CASOS = {
  // 800 × 800 m no Monte Pascoal (Porto Seguro/BA): dentro da TI Barra Velha do
  // Monte Pascoal e parte no Parque Nacional e Histórico do Monte Pascoal
  monte_pascoal: { centro: [-39.35, -16.9], lado: 800, fuso: 24 },
  // 1,5 × 1,5 km em Guarantã do Norte/MT: dentro do PA Braço Sul e com um embargo do IBAMA
  guaranta: { centro: [-54.92, -9.96], lado: 1500, fuso: 21 },
  // 800 × 800 m em Feira de Santana/BA, área sem nenhuma restrição nas bases
  livre: { centro: [-38.86, -12.33], lado: 800, fuso: 24 },
};

export function quadrado([x, y], lado) {
  const h = lado / 2, mLon = 1 / (111320 * Math.cos((y * Math.PI) / 180)), mLat = 1 / 110574;
  return [[x - h * mLon, y - h * mLat], [x + h * mLon, y - h * mLat], [x + h * mLon, y + h * mLat], [x - h * mLon, y + h * mLat]];
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, "$1"))) {
  const dir = path.resolve("tests/fixtures/restricoes");
  fs.mkdirSync(dir, { recursive: true });
  for (const [nome, c] of Object.entries(CASOS)) {
    const respostas = [];
    const gravar = async (u, init) => {
      const r = await fetch(u, init);
      const corpo = await r.text();
      respostas.push({ url: String(u), status: r.status, corpo: corpo.length > 400_000 ? null : corpo });
      return new Response(corpo, { status: r.status });
    };
    const anel = quadrado(c.centro, c.lado);
    const r = await consultarRestricoes([anel], { fuso: c.fuso, fetch: gravar, agora: new Date("2026-11-05T12:00:00Z") });
    fs.writeFileSync(path.join(dir, `${nome}.json`), JSON.stringify({ caso: nome, gravado: new Date().toISOString(), ...c, anel, respostas }));
    console.log(nome, r.fontes.map((f) => `${f.tipo}:${f.classe}`).join(" "));
  }
}
