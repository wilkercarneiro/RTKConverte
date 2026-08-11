// Troca o TIMBRE (cabeçalho, rodapé e a mídia deles) de um .docx pelo de um
// modelo, preservando o corpo do documento.
//
// Existe porque o timbre é da EMPRESA, não de cada peça: quando ele muda, muda
// nos onze modelos de uma vez. Fazer isso à mão no Word significa reabrir onze
// arquivos e repetir onze vezes a mesma sequência de cliques — foi assim que os
// modelos antigos acumularam um cabeçalho de 429 KB com 70 formas e um rodapé
// com dois telefones, um deles desativado.
//
// O que é trocado, e só isso:
//   · word/header*.xml e word/footer*.xml — casados por TIPO (even/default/
//     first), não por nome de arquivo, porque cada peça numera os seus como quer
//   · o .rels de cada um, apontando para a mídia nova
//   · a mídia do timbre, gravada com prefixo próprio para nunca colidir com uma
//     imagem que a peça use no corpo
//   · w:header e w:footer do sectPr — a distância da arte até a borda, que é
//     desenho do timbre e não do conteúdo
//
// O corpo (word/document.xml), os estilos e a numeração ficam intocados.
//
// Uso:
//   node scripts/aplicar-timbre.mjs <modelo.docx> <alvo.docx> [alvo2.docx ...]
import { readFileSync, writeFileSync } from "node:fs";
import JSZip from "jszip";

const PREFIXO_MIDIA = "media/timbre-";

/** Relação Id → Target de um arquivo .rels. */
function lerRels(xml) {
  const out = {};
  for (const m of xml.matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)) out[m[1]] = m[2];
  return out;
}

/** Referências de cabeçalho/rodapé do sectPr: [{tag, tipo, rId}]. */
function lerReferencias(documentXml) {
  const out = [];
  for (const m of documentXml.matchAll(/<w:(header|footer)Reference\s+w:type="(\w+)"\s+r:id="(\w+)"\s*\/>/g)) {
    out.push({ tag: m[1], tipo: m[2], rId: m[3] });
  }
  return out;
}

/** Lê do modelo as partes de timbre, indexadas por tag+tipo. */
async function lerTimbre(caminho) {
  const z = await JSZip.loadAsync(readFileSync(caminho));
  const relsDoc = lerRels(await z.file("word/_rels/document.xml.rels").async("string"));
  const partes = new Map();   // "header:default" → { xml, rels, midia: Map<nome, bytes> }
  const midia = new Map();

  for (const ref of lerReferencias(await z.file("word/document.xml").async("string"))) {
    const alvo = relsDoc[ref.rId];
    if (!alvo) continue;
    const nomeRels = `word/_rels/${alvo}.rels`;
    const rels = z.file(nomeRels) ? await z.file(nomeRels).async("string") : null;
    // a mídia do timbre viaja junto, renomeada; o .rels aponta para o nome novo
    let relsNovo = rels;
    if (rels) {
      for (const [, destino] of Object.entries(lerRels(rels))) {
        if (!destino.startsWith("media/")) continue;   // hyperlink externo passa direto
        const origem = `word/${destino}`;
        if (!midia.has(destino)) midia.set(destino, await z.file(origem).async("uint8array"));
      }
      relsNovo = rels.replace(/Target="media\//g, `Target="${PREFIXO_MIDIA}`);
    }
    partes.set(`${ref.tag}:${ref.tipo}`, { xml: await z.file(`word/${alvo}`).async("string"), rels: relsNovo });
  }

  const sect = (await z.file("word/document.xml").async("string")).match(/<w:sectPr[\s\S]*?<\/w:sectPr>/)?.[0] ?? "";
  const margens = sect.match(/w:header="(\d+)"\s+w:footer="(\d+)"/);
  return {
    partes,
    midia,
    header: margens?.[1] ?? "340",
    footer: margens?.[2] ?? "0",
  };
}

/**
 * Casa uma referência do alvo com uma parte do modelo.
 *
 * O modelo não precisa ter todos os tipos: uma peça com rodapé de página par
 * herda o rodapé padrão, senão aquela página sairia sem a barra de contato.
 */
function parteDoModelo(timbre, tag, tipo) {
  return timbre.partes.get(`${tag}:${tipo}`) ?? timbre.partes.get(`${tag}:default`) ?? null;
}

async function aplicar(caminhoAlvo, timbre) {
  const z = await JSZip.loadAsync(readFileSync(caminhoAlvo));
  const documentXml = await z.file("word/document.xml").async("string");
  const relsDoc = lerRels(await z.file("word/_rels/document.xml.rels").async("string"));
  const refs = lerReferencias(documentXml);

  // Mídia que era só do timbre antigo: sai junto com ele. A que o CORPO usa
  // (assinatura digitalizada, brasão) fica — ela é conteúdo da peça, não desenho.
  const midiaDoCorpo = new Set(
    Object.values(relsDoc).filter((t) => t.startsWith("media/")).map((t) => `word/${t}`),
  );
  const midiaVelha = new Set();
  for (const ref of refs) {
    const alvo = relsDoc[ref.rId];
    const nomeRels = alvo && z.file(`word/_rels/${alvo}.rels`);
    if (!nomeRels) continue;
    for (const destino of Object.values(lerRels(await nomeRels.async("string")))) {
      if (destino.startsWith("media/")) midiaVelha.add(`word/${destino}`);
    }
  }

  let trocadas = 0;
  for (const ref of refs) {
    const alvo = relsDoc[ref.rId];
    const parte = parteDoModelo(timbre, ref.tag, ref.tipo);
    if (!alvo || !parte) continue;
    z.file(`word/${alvo}`, parte.xml);
    if (parte.rels) z.file(`word/_rels/${alvo}.rels`, parte.rels);
    else z.remove(`word/_rels/${alvo}.rels`);
    trocadas++;
  }

  for (const nome of midiaVelha) if (!midiaDoCorpo.has(nome)) z.remove(nome);
  for (const [destino, bytes] of timbre.midia) {
    z.file(`word/${PREFIXO_MIDIA}${destino.replace(/^media\//, "")}`, bytes);
  }

  // A arte do timbre foi desenhada para uma distância específica da borda; sem
  // isso o logo do topo entra na mancha de texto.
  const doc2 = documentXml.replace(
    /w:header="\d+"(\s+)w:footer="\d+"/g,
    `w:header="${timbre.header}"$1w:footer="${timbre.footer}"`,
  );
  z.file("word/document.xml", doc2);

  // Sem o Default de png o pacote é inválido: o Word recusa o arquivo inteiro.
  const ct = await z.file("[Content_Types].xml").async("string");
  if (!/Extension="png"/.test(ct)) {
    z.file("[Content_Types].xml", ct.replace(
      /<Types([^>]*)>/,
      `<Types$1><Default Extension="png" ContentType="image/png"/>`,
    ));
  }

  const saida = await z.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  writeFileSync(caminhoAlvo, saida);
  return { trocadas, bytes: saida.length };
}

const [modelo, ...alvos] = process.argv.slice(2);
if (!modelo || !alvos.length) {
  console.error("uso: node scripts/aplicar-timbre.mjs <modelo.docx> <alvo.docx> [...]");
  process.exit(1);
}
const timbre = await lerTimbre(modelo);
console.log(`timbre de ${modelo}: ${[...timbre.partes.keys()].join(", ")} · ${timbre.midia.size} imagens · header=${timbre.header} footer=${timbre.footer}`);
for (const alvo of alvos) {
  const antes = readFileSync(alvo).length;
  const r = await aplicar(alvo, timbre);
  console.log(`${alvo}: ${r.trocadas} partes · ${(antes / 1024).toFixed(0)} KB → ${(r.bytes / 1024).toFixed(0)} KB`);
}
