// Peças do serviço completo: o M do banco cujo CÓDIGO não está no PDF do SIGEF
// (o SIGEF trocou o nosso vértice pelo do vizinho certificado, ou os códigos
// foram realocados depois da prévia) é ancorado pela POSIÇÃO — o vértice do
// PDF a menos de 1 m. Antes ele era pulado em silêncio e a divisa se fundia à
// do confrontante anterior.
import { test } from "node:test";
import assert from "node:assert/strict";
import proj4 from "proj4";
import { anelDoBloco, codigoMaisProximoNoPdf } from "../supabase/functions/_shared/sigef_glebas.ts";
import { GEO_DEF, utmDef } from "../supabase/functions/_shared/geo.ts";

const FUSO = 24;
// três vértices como o PDF os escreve
const linhas = [
  { codigo: "DSBN-M-4639", lon: "-39°05'04,737\"", lat: "-11°30'10,120\"", alt: "300", vante: "DJ9-M-2491", azimute: "90°00'", dist: "10,00", confrontacao: "A" },
  { codigo: "DJ9-M-2491", lon: "-39°05'03,900\"", lat: "-11°30'10,120\"", alt: "300", vante: "DSBN-P-1", azimute: "90°00'", dist: "10,00", confrontacao: "B" },
  { codigo: "DSBN-P-1", lon: "-39°05'03,000\"", lat: "-11°30'12,000\"", alt: "300", vante: "DSBN-M-4639", azimute: "0°00'", dist: "10,00", confrontacao: "B" },
];
const anel = anelDoBloco(linhas, FUSO, (a, b, c) => proj4(a, b, c));

test("M do banco a 30 cm do vértice do vizinho certificado ancora nele", () => {
  const [e, n] = anel[1];
  assert.equal(codigoMaisProximoNoPdf(anel, linhas, e + 0.2, n - 0.2), "DJ9-M-2491");
});

test("ponto a mais de 1 m de todo vértice do PDF não ancora", () => {
  const [e, n] = anel[1];
  assert.equal(codigoMaisProximoNoPdf(anel, linhas, e + 3, n), null);
});

test("o anel reprojetado bate com a projeção direta do GMS", () => {
  const [e, n] = proj4(GEO_DEF, utmDef(FUSO), [-(39 + 5 / 60 + 4.737 / 3600), -(11 + 30 / 60 + 10.12 / 3600)]);
  assert.ok(Math.hypot(anel[0][0] - e, anel[0][1] - n) < 0.001);
});
