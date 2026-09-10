import { readFileSync, writeFileSync } from "node:fs";
import proj4lib from "proj4";
import { montarServico } from "../supabase/functions/_shared/servico.ts";
import { geometriaDoCalculo } from "../supabase/functions/_shared/planta_dados.ts";
import { gerarPlantaPdf } from "../supabase/functions/_shared/planta.ts";
import { dadosPlantaDe, entrada, glebaDe } from "../tests/fixtures/salgada_velha.mjs";
const proj4 = (f, t, c) => proj4lib(f, t, c);
const g = geometriaDoCalculo(montarServico(entrada(), proj4));
const n = g.vertices.length;
const idx = (a, b) => Array.from({ length: b - a }, (_, i) => a + i);
const glebas = [glebaDe(g, idx(0, Math.floor(n/3)), "GLEBA 1"), glebaDe(g, idx(Math.floor(n/3), Math.floor(2*n/3)), "GLEBA 2"), glebaDe(g, idx(Math.floor(2*n/3), n), "GLEBA 3")];
const logo = { bytes: new Uint8Array(readFileSync(process.env.TMP + "/logo-empresa.jpg")), tipo: "jpg" };
const satelite = { bytes: new Uint8Array(readFileSync(process.env.TMP + "/sat_prod.jpg")), tipo: "jpg" };
const casos = [
  ["a1_3glebas", { folha: "A1", glebas, logo, satelite }],
  ["a1_simples", { folha: "A1", logo, satelite }],
  ["a3_posse", { folha: "A3", tipoImovel: "posse", logo, satelite }],
];
for (const [nome, extra] of casos) {
  const pdf = await gerarPlantaPdf(dadosPlantaDe(g, extra));
  writeFileSync(process.env.TMP + `/planta_${nome}.pdf`, pdf);
  console.log("ok", nome, "vertices", n);
}
