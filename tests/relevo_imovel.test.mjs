// Relevo do serviço GEO (src/lib/relevo/imovel.ts): vértices → pontos e anéis.
// Vértice só com GMS (V digitado ou do vizinho certificado, sem E/N) entra
// convertido para UTM no fuso do serviço, como a conferência faz (utmDoVertice).
import { test } from "node:test";
import assert from "node:assert/strict";
import proj4 from "proj4";
import { imovelDosVertices } from "../src/lib/relevo/imovel.ts";
import { utmDoVertice } from "../src/lib/vertice_utm.ts";
import { fmtGmsPlanilha, GEO_DEF, utmDef } from "../supabase/functions/_shared/geo.ts";

const FUSO = 24;
const E0 = 490000, N0 = 8730000;

/** GMS planilha de um E/N do fuso. */
function gmsDe(e, n) {
  const [lon, lat] = proj4(utmDef(FUSO), GEO_DEF, [e, n]);
  const g = (deg) => {
    const a = Math.abs(deg), d = Math.floor(a), mf = (a - d) * 60, m = Math.floor(mf);
    return { neg: deg < 0, d, m, sMil: Math.round((mf - m) * 60 * 1000) };
  };
  return { lat_gms: fmtGmsPlanilha(g(lat), "lat"), lon_gms: fmtGmsPlanilha(g(lon), "lon") };
}

const vert = (ordem, e, n, h, extra = {}) => ({ ordem, e, n, h, tipo: "M", codigo: `M-${ordem + 1}`, num_txt: null, lat_gms: "", lon_gms: "", ...extra });

test("vértice só com GMS (sem E/N) entra no relevo convertido para UTM do fuso", () => {
  const so = gmsDe(E0 + 100, N0 + 100);
  const vs = [
    vert(0, E0, N0, 100),
    vert(1, E0 + 100, N0, 101),
    vert(2, null, null, 102, { ...so, tipo: "V", codigo: "V-3" }),
    vert(3, E0, N0 + 100, 103),
  ];
  const im = imovelDosVertices(vs, null, FUSO);
  assert.equal(im.pts.length, 4, "o vértice só GMS não é descartado");
  assert.equal(im.aneis[0].length, 4);
  const p = im.pts[2];
  // GMS com milésimo de segundo: ~3 cm
  assert.ok(Math.hypot(p[0] - (E0 + 100), p[1] - (N0 + 100)) < 0.05, `${p}`);
  assert.equal(im.hs[2], 102);
  assert.deepEqual(im.marcos.map((m) => m.texto), ["M-1", "M-2", "V-3", "M-4"]);
  // anéis por ordem também o encontram
  assert.equal(imovelDosVertices(vs, [[0, 1, 2, 3]], FUSO).aneis[0].length, 4);
  // sem fuso não dá para converter: fica de fora (como antes), sem quebrar
  assert.equal(imovelDosVertices(vs, null, null).pts.length, 3);
});

test("utmDoVertice: E/N gravado vale; GMS inválido é null", () => {
  assert.deepEqual(utmDoVertice({ e: 1, n: 2, lat_gms: "", lon_gms: "" }, FUSO), [1, 2]);
  assert.equal(utmDoVertice({ e: null, n: null, lat_gms: "lixo", lon_gms: "lixo" }, FUSO), null);
  assert.equal(utmDoVertice({ e: null, n: null, lat_gms: "", lon_gms: "" }, FUSO), null);
});

test("worker do relevo: abortar encerra (terminate) e rejeita; error e messageerror rejeitam", async () => {
  const { calcularRelevoEmSegundoPlano, RelevoCancelado } = await import("../src/lib/relevo/imovel.ts");
  const criados = [];
  class FalsoWorker {
    constructor() { this.encerrado = false; this.recebeu = null; criados.push(this); }
    postMessage(m) { this.recebeu = m; }
    terminate() { this.encerrado = true; }
  }
  const antes = globalThis.Worker;
  globalThis.Worker = FalsoWorker;
  try {
    // trocar de intervalo: o pedido anterior é abortado
    const ctl = new AbortController();
    const p1 = calcularRelevoEmSegundoPlano({ x: 1 }, ctl.signal);
    ctl.abort();
    await assert.rejects(p1, RelevoCancelado);
    assert.equal(criados[0].encerrado, true, "o worker antigo foi encerrado");
    // erro dentro do worker
    const p2 = calcularRelevoEmSegundoPlano({ x: 2 });
    criados[1].onerror({ message: "boom", preventDefault() {} });
    await assert.rejects(p2, /boom/);
    assert.equal(criados[1].encerrado, true);
    // mensagem ilegível
    const p3 = calcularRelevoEmSegundoPlano({ x: 3 });
    criados[2].onmessageerror({});
    await assert.rejects(p3, /ilegível/);
    assert.equal(criados[2].encerrado, true);
    // resposta normal
    const p4 = calcularRelevoEmSegundoPlano({ x: 4 });
    criados[3].onmessage({ data: { ok: true, r: { pronto: 1 } } });
    assert.deepEqual(await p4, { pronto: 1 });
    // já abortado: nem cria worker
    const ja = new AbortController(); ja.abort();
    await assert.rejects(calcularRelevoEmSegundoPlano({ x: 5 }, ja.signal), RelevoCancelado);
    assert.equal(criados.length, 4);
  } finally {
    globalThis.Worker = antes;
  }
});
