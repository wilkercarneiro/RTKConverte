// A prévia da conferência (src/lib/preview.ts) com vértice que só tem E/N.
//
// Os marcos novos da divisão em partes (aplicarDivisao) e os vértices criados na
// conferência nascem com lat_gms/lon_gms vazios. A prévia lia o GMS de todo
// vértice e quebrava a tela com 'Coordenada GMS inválida: ""'. Agora ela cai
// para o UTM, como o servidor faz com vértice que não foi digitado à mão.
import { test } from "node:test";
import assert from "node:assert/strict";
import proj4lib from "proj4";
import { calcularPreviewLocal } from "../src/lib/preview.ts";
import { GEO_DEF, degToGmsCanonical, fmtGmsPlanilha, utmDef } from "../supabase/functions/_shared/geo.ts";

const FUSO = 24;
const QUADRADO = [[500000, 8800000], [500100, 8800000], [500100, 8799900], [500000, 8799900]];

const vertice = ([e, n], i, comGms) => {
  const [lon, lat] = proj4lib(utmDef(FUSO), GEO_DEF, [e, n]);
  return {
    id: `v${i}`, servico_id: "s", ordem: i, num_txt: i + 1, rotulo_txt: null, e, n, h: 10,
    sigma_pos: 0.01, sigma_h: 0.02, tipo: "M", codigo: null, codigo_provisorio: false, metodo: "PG6",
    inserido_manual: false,
    lat_gms: comGms ? fmtGmsPlanilha(degToGmsCanonical(lat), "lat") : "",
    lon_gms: comGms ? fmtGmsPlanilha(degToGmsCanonical(lon), "lon") : "",
    descritivo: "ESTRADA", tipo_limite: null, eh_via: false, cns: null, matricula: null, apelido_txt: null,
  };
};

test("vértice sem GMS não quebra a prévia e dá a mesma área", () => {
  const todosComGms = calcularPreviewLocal(FUSO, QUADRADO.map((p, i) => vertice(p, i, true)), [], null);
  const doisSemGms = calcularPreviewLocal(FUSO, QUADRADO.map((p, i) => vertice(p, i, i % 2 === 0)), [], null);
  assert.equal(todosComGms.erro, null);
  assert.equal(doisSemGms.erro, null);
  assert.equal(doisSemGms.areaHa, todosComGms.areaHa);
  assert.equal(doisSemGms.perimetroM, todosComGms.perimetroM);
});
