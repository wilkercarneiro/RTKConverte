// O TXT sintético da demonstração (scripts/demo/txt-demo.mjs) precisa passar
// pelo mesmo parser e motor que o TXT de uma máquina real.
import { test } from "node:test";
import assert from "node:assert/strict";
import proj4lib from "proj4";
import { gerarTxtDemo } from "../scripts/demo/txt-demo.mjs";
import { calcularAreaHa, calcularVertices, detectZoneCandidates, parseTxt } from "../supabase/functions/_shared/geo.ts";
import { sugerirTrechos } from "../supabase/functions/_shared/servico.ts";

const proj4 = (f, t, c) => proj4lib(f, t, c);

test("TXT da demo: parseia, cai no fuso 24S, área plausível e 4 confrontações", () => {
  const pontos = parseTxt(gerarTxtDemo());
  assert.equal(pontos.length, 28);
  const zonas = detectZoneCandidates(pontos, proj4).map((c) => c.zone);
  assert.ok(zonas.includes(24), `fusos candidatos: ${zonas}`);
  const calc = calcularVertices(pontos.map((p) => ({ numTxt: p.num, e: p.e, n: p.n, h: p.h, sigmaPos: p.sigmaPos, sigmaH: p.sigmaH })), 24, proj4);
  const area = calcularAreaHa(calc);
  assert.ok(area > 40 && area < 90, `área ${area} ha`);
  assert.equal(sugerirTrechos(pontos).length, 4);
});
