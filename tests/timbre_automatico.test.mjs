// Timbre automático: empresa SEM modelo próprio gera pelos modelos neutros
// (templates/padrao/) e os documentos saem com a identidade DELA — logo no
// cabeçalho, logo desbotada como marca d'água e rodapé com razão social, CNPJ,
// telefone e e-mail. D'Prol (modelos na raiz) e empresa com modelo próprio
// (templates/escritorios/{id}/) não passam por aqui.
//
// Os modelos são os neutros reais, baixados da produção (tests/fixtures/
// modelos-padrao). O pacote precisa continuar abrindo: cada cabeçalho/rodapé
// referenciado existe, cada relação aponta para um arquivo do pacote, cada
// parte é XML bem formado e o tipo da imagem está no [Content_Types].xml.
// Com o LibreOffice instalado, o documento é convertido para PDF e o texto do
// rodapé é conferido no PDF (no CI, sem LibreOffice, essa parte é pulada).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { deflateSync } from "node:zlib";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import JSZip from "jszip";
import { extractText, getDocumentProxy } from "unpdf";
import {
  aplicarTimbreAutomatico, cabecalhoXml, dimensoesImagem, formatarCnpjTimbre, identidadeDaEmpresa, precisaTimbreAutomatico, rodapeXml, xmlEscape,
} from "../supabase/functions/_shared/timbre_automatico.ts";
import * as docx from "../supabase/functions/_shared/docx.ts";

const OUT = new URL("./out/timbre/", import.meta.url);
mkdirSync(OUT, { recursive: true });

// ---------- PNG de verdade (o LibreOffice precisa decodificar) ----------
const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function bloco(tipo, dados) {
  const t = Buffer.from(tipo, "ascii");
  const len = Buffer.alloc(4); len.writeUInt32BE(dados.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, dados])));
  return Buffer.concat([len, t, dados, crc]);
}
/** PNG RGB w×h: faixa verde-escura à esquerda, azul à direita (logo de mentira, mas decodificável). */
function pngLogo(w, h) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const linhas = [];
  for (let y = 0; y < h; y++) {
    const l = Buffer.alloc(1 + w * 3);
    for (let x = 0; x < w; x++) {
      const [r, g, b] = x < w * 0.4 ? [20, 110, 60] : [30, 70, 160];
      l[1 + x * 3] = r; l[2 + x * 3] = g; l[3 + x * 3] = b;
    }
    linhas.push(l);
  }
  return new Uint8Array(Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloco("IHDR", ihdr), bloco("IDAT", deflateSync(Buffer.concat(linhas))), bloco("IEND", Buffer.alloc(0)),
  ]));
}

const LOGO = { bytes: pngLogo(300, 120), tipo: "png" };
const IDENT = { nome: "AGRIMENSURA NOVA LTDA", cnpj: "12.345.678/0001-90", telefone: "(75) 99999-0000", email: "contato@agrimensuranova.com.br" };

// ---------- conferências do pacote ----------
const dec = (s) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");

/** XML bem formado o bastante para o Word: toda tag aberta fecha na ordem certa. */
function xmlBemFormado(xml, nome) {
  const pilha = [];
  const corpo = xml.replace(/<\?[\s\S]*?\?>/g, "").replace(/<!--[\s\S]*?-->/g, "");
  for (const m of corpo.matchAll(/<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g)) {
    const [, fecha, tag, , auto] = m;
    if (auto) continue;
    if (fecha) {
      const topo = pilha.pop();
      assert.equal(topo, tag, `${nome}: </${tag}> fecha <${topo}>`);
    } else pilha.push(tag);
  }
  assert.deepEqual(pilha, [], `${nome}: tags sem fechar`);
  // nada que pareça tag e não case com o padrão acima (atributo quebrado, aspas soltas)
  const tags = corpo.match(/<[^>]*>/g) ?? [];
  for (const t of tags) assert.match(t, /^<\/?[A-Za-z_][\w:.-]*(?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*\s*\/?>$/, `${nome}: tag malformada ${t.slice(0, 80)}`);
}

/** Lê o pacote como o Word lê: refs do documento → rels → partes → rels das partes → mídia. */
async function conferirPacote(buf, rotulo) {
  const z = await JSZip.loadAsync(buf);
  const doc = await z.file("word/document.xml").async("string");
  const rels = await z.file("word/_rels/document.xml.rels").async("string");
  const ct = await z.file("[Content_Types].xml").async("string");
  const alvo = new Map([...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => [/Id="([^"]+)"/.exec(m[0])[1], /Target="([^"]+)"/.exec(m[0])[1]]));
  const partes = { header: [], footer: [] };
  for (const m of doc.matchAll(/<w:(header|footer)Reference\b[^>]*r:id="([^"]+)"/g)) {
    const t = alvo.get(m[2]);
    assert.ok(t, `${rotulo}: ${m[1]}Reference ${m[2]} sem relação`);
    const parte = `word/${t}`;
    assert.ok(z.file(parte), `${rotulo}: ${parte} não existe`);
    assert.ok(new RegExp(`PartName="/${parte}"`).test(ct), `${rotulo}: ${parte} sem tipo no [Content_Types]`);
    partes[m[1]].push(parte);
  }
  for (const nome of Object.keys(z.files).filter((n) => /\.(xml|rels)$/.test(n))) xmlBemFormado(await z.file(nome).async("string"), `${rotulo} ${nome}`);
  // cada relação de cabeçalho/rodapé aponta para arquivo que existe
  for (const parte of [...partes.header, ...partes.footer]) {
    const r = z.file(parte.replace(/^word\//, "word/_rels/") + ".rels");
    if (!r) continue;
    for (const m of (await r.async("string")).matchAll(/Target="([^"]+)"/g)) assert.ok(z.file(`word/${m[1]}`), `${rotulo}: ${parte} aponta para ${m[1]}, que não existe`);
  }
  // seções: rodapé a ≥ 1 cm da borda; todo tipo com cabeçalho tem rodapé
  for (const sec of doc.match(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/g) ?? []) {
    const f = /w:footer="(\d+)"/.exec(sec);
    if (f) assert.ok(Number(f[1]) >= 567, `${rotulo}: rodapé a ${f[1]} twips da borda`);
    const th = new Set([...sec.matchAll(/headerReference[^>]*w:type="(\w+)"/g)].map((m) => m[1]));
    const tf = new Set([...sec.matchAll(/footerReference[^>]*w:type="(\w+)"/g)].map((m) => m[1]));
    assert.deepEqual([...th].sort(), [...tf].sort(), `${rotulo}: tipos de cabeçalho × rodapé`);
  }
  return { z, doc, partes, ct };
}

// ---------- publicação: o módulo não depende de outro _shared em execução ----------
test("timbre_automatico.ts só importa TIPOS (no ar, o gerar-pecas não tem docx.ts e o memorial.ts dele é esboço)", () => {
  const src = readFileSync(new URL("../supabase/functions/_shared/timbre_automatico.ts", import.meta.url), "utf8");
  const imports = src.split(/\r?\n/).filter((l) => /^\s*import\s/.test(l));
  assert.ok(imports.length > 0);
  for (const l of imports) assert.match(l, /^\s*import type /, `import de execução: ${l}`);
  assert.ok(!/from "\.\/docx\.ts"/.test(src), "nada de docx.ts");
});

test("escape de XML e medida da imagem: as cópias concordam com as de docx.ts", () => {
  for (const s of ["A & B", "<x y=\"1\">", "d'água", "sem nada"]) assert.equal(xmlEscape(s), docx.xmlEscape(s));
  const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 0x11, 8, 1, 0x2c, 2, 0x58]);
  for (const [b, t] of [[LOGO.bytes, "png"], [pngLogo(7, 3), "png"], [jpg, "jpg"], [new Uint8Array(10), "png"], [new Uint8Array([0xff, 0xd8]), "jpg"]]) {
    assert.deepEqual(dimensoesImagem(b, t), docx.dimensoesImagem(b, t));
  }
  assert.deepEqual(dimensoesImagem(jpg, "jpg"), { w: 600, h: 300 });
});

test("logo com cabeçalho ilegível entra quadrada, sem NaN no XML", () => {
  const h = cabecalhoXml({ bytes: new Uint8Array(4), tipo: "png" }, IDENT);
  assert.ok(!/NaN|Infinity/.test(h));
  assert.match(h, /style="width:42pt;height:42pt"/);
});

// ---------- quem recebe o timbre ----------
test("o timbre só entra no modelo neutro de empresa não legada", () => {
  const nova = { id: "esc-2", compartilhados: false };
  const dprol = { id: "esc-1", compartilhados: true };
  assert.equal(precisaTimbreAutomatico(nova, "padrao/pecas/1-memorial-descritivo.docx"), true);
  assert.equal(precisaTimbreAutomatico(nova, "padrao/memorial-template.docx"), true);
  assert.equal(precisaTimbreAutomatico(nova, "escritorios/esc-2/pecas/1-memorial-descritivo.docx"), false, "modelo próprio da empresa: o timbre é o dela");
  assert.equal(precisaTimbreAutomatico(dprol, "pecas/1-memorial-descritivo.docx"), false, "D'Prol: modelos da raiz, timbre no modelo");
  assert.equal(precisaTimbreAutomatico(dprol, "padrao/pecas/1-memorial-descritivo.docx"), false);
  assert.equal(precisaTimbreAutomatico({ id: null, compartilhados: true }, "pecas/x.docx"), false, "banco sem escritórios");
  assert.equal(precisaTimbreAutomatico(nova, null), false, "sem modelo nenhum");
});

test("identidade: razão social e CNPJ das Configurações, cadastro como reserva", async () => {
  const cliente = (esc, cfg) => ({
    from: (t) => ({
      select: () => ({
        eq: () => t === "escritorios"
          ? { maybeSingle: async () => ({ data: esc, error: null }) }
          : Promise.resolve({ data: cfg, error: null }),
      }),
    }),
  });
  const esc = { nome: "Agrimensura Nova", cnpj: "11222333000144", telefone: "(75) 3333-4444", email: "a@b.com" };
  assert.deepEqual(
    await identidadeDaEmpresa(cliente(esc, [{ key: "razao_social", value: "AGRIMENSURA NOVA LTDA" }, { key: "cnpj", value: "12345678000190" }]), "esc-2"),
    { nome: "AGRIMENSURA NOVA LTDA", cnpj: "12.345.678/0001-90", telefone: "(75) 3333-4444", email: "a@b.com" },
  );
  assert.deepEqual(
    await identidadeDaEmpresa(cliente(esc, []), "esc-2"),
    { nome: "Agrimensura Nova", cnpj: "11.222.333/0001-44", telefone: "(75) 3333-4444", email: "a@b.com" },
    "sem Configurações: o cadastro da empresa",
  );
  assert.deepEqual(
    await identidadeDaEmpresa(cliente({ nome: "Fulano Topografia", cnpj: null, telefone: "", email: null }, [{ key: "cnpj", value: "" }]), "esc-3"),
    { nome: "Fulano Topografia", cnpj: null, telefone: null, email: null },
    "campos vazios não viram texto no rodapé",
  );
  assert.equal(await identidadeDaEmpresa(cliente(null, []), "esc-x"), null);
  assert.equal(await identidadeDaEmpresa(cliente(esc, []), null), null);
  assert.equal(formatarCnpjTimbre("123.456.789-01"), "123.456.789-01", "CPF (empresa individual) também formata");
});

test("cabeçalho e rodapé: logo + marca d'água desbotada; nome, CNPJ e contato; texto escapado", () => {
  const h = cabecalhoXml(LOGO, IDENT);
  assert.equal((h.match(/r:id="rIdTimbreLogo"/g) ?? []).length, 2, "logo no topo e marca d'água");
  assert.match(h, /gain="19661f" blacklevel="22938f"/, "marca d'água com o desbotamento do Word");
  assert.match(h, /style="width:105pt;height:42pt"/, "logo 300×120 no topo: 42 pt de altura, largura proporcional");
  assert.match(h, /width:340\.2pt;height:136\.1pt;z-index:-/, "marca d'água: 12 cm no lado maior, atrás do texto");
  const larga = cabecalhoXml({ bytes: pngLogo(1000, 100), tipo: "png" }, IDENT);
  assert.match(larga, /style="width:170pt;height:17pt"/, "logo muito larga é limitada a 170 pt");
  const semLogo = cabecalhoXml(null, { ...IDENT, nome: "A & B <TOPOGRAFIA>" });
  assert.ok(!semLogo.includes("rIdTimbreLogo") && semLogo.includes("A &amp; B &lt;TOPOGRAFIA&gt;"), "sem logo: o nome no topo, escapado");
  const r = dec(rodapeXml(IDENT).replace(/<[^>]+>/g, " "));
  for (const parte of [IDENT.nome, "CNPJ 12.345.678/0001-90", IDENT.telefone, IDENT.email]) assert.ok(r.includes(parte), `rodapé sem ${parte}`);
  const so = dec(rodapeXml({ nome: "SÓ O NOME", cnpj: null, telefone: null, email: null }).replace(/<[^>]+>/g, " "));
  assert.ok(so.includes("SÓ O NOME") && !so.includes("CNPJ") && !/·/.test(so), "sem contato: só o nome, sem separadores soltos");
});

// ---------- nos modelos neutros reais ----------
const PECAS = ["1-memorial-descritivo", "2-memorial-tabular", "3-cartas-anuencia", "4-declaracao-tecnico", "5-declaracao-proprietario", "6-requerimento", "7-declaracao-faixa-dominio"];
const POSSE = ["1-memorial-descritivo", "2-memorial-tabular", "3-cartas-anuencia", "4-declaracao-faixa-dominio"];
const MODELOS = [
  ...PECAS.map((n) => `pecas/${n}`),
  ...POSSE.map((n) => `pecas-posse/${n}`),
  "memorial-template",
];

for (const modelo of MODELOS) {
  test(`modelo neutro ${modelo}: timbre completo e pacote íntegro`, async () => {
    const original = await JSZip.loadAsync(readFileSync(new URL(`./fixtures/modelos-padrao/${modelo}.docx`, import.meta.url)));
    const docAntes = await original.file("word/document.xml").async("string");
    const zip = await JSZip.loadAsync(readFileSync(new URL(`./fixtures/modelos-padrao/${modelo}.docx`, import.meta.url)));
    await aplicarTimbreAutomatico(zip, LOGO, IDENT);
    const buf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    const { z, doc, partes, ct } = await conferirPacote(buf, modelo);
    // o corpo não muda: só o sectPr final (refs e distância do rodapé)
    const corpo = (x) => x.slice(0, x.lastIndexOf("<w:sectPr"));
    assert.equal(corpo(doc), corpo(docAntes), "o corpo do documento ficou intacto");
    assert.ok(partes.header.length >= 1 && partes.footer.length >= 1);
    for (const h of partes.header) {
      const x = await z.file(h).async("string");
      assert.ok(x.includes('id="TimbreLogo"') && x.includes('id="TimbreMarcaDagua"'), `${h}: logo e marca d'água`);
      assert.match(await z.file(h.replace("word/", "word/_rels/") + ".rels").async("string"), /Target="media\/logo-timbre\.png"/);
    }
    for (const f of partes.footer) {
      const t = dec((await z.file(f).async("string")).replace(/<[^>]+>/g, " "));
      assert.ok(t.includes(IDENT.nome) && t.includes(IDENT.cnpj) && t.includes(IDENT.email), `${f}: dados da empresa`);
    }
    assert.deepEqual(await z.file("word/media/logo-timbre.png").async("uint8array"), LOGO.bytes, "a logo da empresa, byte a byte");
    assert.match(ct, /<Default Extension="png" ContentType="image\/png"\/>/);
    assert.ok(!/d.?prol|theognes|dprolprojetos/i.test(dec(doc.replace(/<[^>]+>/g, ""))), "nada da D'Prol");
  });
}

test("logo em JPEG: content type image/jpeg e extensão .jpeg", async () => {
  const jpg = { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 0x11, 8, 0, 100, 0, 200]), tipo: "jpg" };
  const zip = await JSZip.loadAsync(readFileSync(new URL("./fixtures/modelos-padrao/pecas/4-declaracao-tecnico.docx", import.meta.url)));
  await aplicarTimbreAutomatico(zip, jpg, IDENT);
  const { z, ct } = await conferirPacote(await zip.generateAsync({ type: "nodebuffer" }), "jpeg");
  assert.ok(z.file("word/media/logo-timbre.jpeg"));
  assert.match(ct, /<Default Extension="jpeg" ContentType="image\/jpeg"\/>/);
});

test("empresa sem logo cadastrada: nome no cabeçalho, rodapé completo, nenhuma imagem", async () => {
  const zip = await JSZip.loadAsync(readFileSync(new URL("./fixtures/modelos-padrao/pecas/1-memorial-descritivo.docx", import.meta.url)));
  await aplicarTimbreAutomatico(zip, null, IDENT);
  const { z, partes } = await conferirPacote(await zip.generateAsync({ type: "nodebuffer" }), "sem logo");
  for (const h of partes.header) {
    const x = await z.file(h).async("string");
    assert.ok(x.includes(IDENT.nome) && !x.includes("rIdTimbreLogo"), h);
  }
  assert.ok(!Object.keys(z.files).some((n) => n.startsWith("word/media/") && !z.files[n].dir));
});

test("modelo sem cabeçalho nem rodapé: as partes são criadas e ligadas à seção", async () => {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Corpo</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1418" w:right="1134" w:bottom="1418" w:left="1134" w:header="709" w:footer="0" w:gutter="0"/></w:sectPr></w:body></w:document>`);
  await aplicarTimbreAutomatico(zip, LOGO, IDENT);
  const buf = await zip.generateAsync({ type: "nodebuffer" });
  const { doc, partes } = await conferirPacote(buf, "sem partes");
  assert.deepEqual(partes, { header: ["word/header-timbre.xml"], footer: ["word/footer-timbre.xml"] });
  assert.match(doc, /<w:document xmlns:r="[^"]+" xmlns:w=/, "namespace r declarado");
  assert.match(doc, /w:footer="567"/);
  writeFileSync(new URL("sem-partes.docx", OUT), buf);
});

// ---------- as peças de verdade, geradas e timbradas ----------
const SOFFICE = [process.env.SOFFICE, "C:\\Users\\User\\scoop\\apps\\libreoffice\\current\\LibreOffice\\program\\soffice.exe", "/usr/bin/soffice", "/usr/bin/libreoffice"]
  .find((p) => p && existsSync(p));

test("modelos neutros + timbre: abrem no LibreOffice com o rodapé da empresa", { skip: !SOFFICE && "LibreOffice não instalado", timeout: 240_000 }, async () => {
  const dir = join(tmpdir(), `timbre-${process.pid}`);
  mkdirSync(dir, { recursive: true });
  try {
    const arquivos = [];
    for (const nome of ["4-declaracao-tecnico", "6-requerimento"]) {
      const zip = await JSZip.loadAsync(readFileSync(new URL(`./fixtures/modelos-padrao/pecas/${nome}.docx`, import.meta.url)));
      await aplicarTimbreAutomatico(zip, LOGO, IDENT);
      const caminho = join(dir, `${nome}.docx`);
      writeFileSync(caminho, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
      writeFileSync(new URL(`${nome}.docx`, OUT), readFileSync(caminho));
      arquivos.push(caminho);
    }
    execFileSync(SOFFICE, ["--headless", `-env:UserInstallation=${pathToFileURL(join(dir, "perfil")).href}`, "--convert-to", "pdf", "--outdir", dir, ...arquivos], { stdio: "ignore", timeout: 200_000 });
    for (const caminho of arquivos) {
      const pdfPath = caminho.replace(/\.docx$/, ".pdf");
      assert.ok(existsSync(pdfPath), `${caminho}: o LibreOffice não conseguiu abrir`);
      writeFileSync(new URL(pdfPath.split(/[\\/]/).pop(), OUT), readFileSync(pdfPath));
      const pdf = await getDocumentProxy(new Uint8Array(readFileSync(pdfPath)));
      const { text } = await extractText(pdf, { mergePages: true });
      const t = text.replace(/\s+/g, " ");
      assert.ok(t.includes(IDENT.nome), `${caminho}: rodapé sem o nome da empresa`);
      assert.ok(t.includes("12.345.678/0001-90"), `${caminho}: rodapé sem o CNPJ`);
      assert.ok(t.includes("contato@agrimensuranova.com.br"), `${caminho}: rodapé sem o e-mail`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
