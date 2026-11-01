// Timbre automático: a identidade da EMPRESA DO SERVIÇO nos documentos que
// saem do modelo neutro (templates/padrao/), isto é, de empresa que ainda não
// enviou modelos próprios.
//
//   cabeçalho    — a logo da empresa (Configurações → logo), pequena, centrada
//   marca d'água — a mesma logo, centrada e desbotada atrás do texto (a receita
//                  de desbotamento do Word: gain/blacklevel, como em docx.ts)
//   rodapé       — razão social, CNPJ, telefone e e-mail (Configurações / cadastro)
//
// Quem tem modelo próprio (templates/escritorios/{id}/…) e a empresa legada
// (D'Prol, modelos na raiz) NÃO passam por aqui: o timbre deles está no modelo.
// Só cabeçalho, rodapé, a distância do rodapé e a mídia do pacote mudam — o
// corpo do documento (o que o gerador escreveu) fica intacto.
import type JSZip from "jszip";
import { dimensoesImagem, xmlEscape } from "./docx.ts";
import type { MarcaDagua } from "./docx.ts";
import type { EscritorioModelos } from "./modelos.ts";

export interface IdentidadeEmpresa {
  nome: string;
  cnpj: string | null;
  telefone: string | null;
  email: string | null;
}

const NS_W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NS_V = "urn:schemas-microsoft-com:vml";
const NS_O = "urn:schemas-microsoft-com:office:office";
const NS_PKG = "http://schemas.openxmlformats.org/package/2006/relationships";
const RID_LOGO = "rIdTimbreLogo";
const GAIN = "19661f", BLACKLEVEL = "22938f";
const TIPO_HDR = "application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml";
const TIPO_FTR = "application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml";
/** Rodapé a pelo menos 1 cm da borda (os modelos neutros vêm com 0: a impressora corta). */
const RODAPE_MIN_TWIPS = 567;

/** O documento saiu do modelo neutro de uma empresa (não legada) — é aí que o timbre entra. */
export function precisaTimbreAutomatico(esc: EscritorioModelos, caminhoModelo: string | null | undefined): boolean {
  return !!esc.id && !esc.compartilhados && !!caminhoModelo && caminhoModelo.startsWith("padrao/");
}

export function formatarCnpjTimbre(c: string | null | undefined): string | null {
  const d = (c ?? "").replace(/\D/g, "");
  if (d.length === 14) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  return c?.trim() || null;
}

// deno-lint-ignore no-explicit-any
type Cliente = any;

/** Razão social / CNPJ (Configurações) com o cadastro da empresa como reserva. */
export async function identidadeDaEmpresa(supa: Cliente, escritorioId: string | null): Promise<IdentidadeEmpresa | null> {
  if (!escritorioId) return null;
  const { data: e } = await supa.from("escritorios").select("nome, cnpj, telefone, email").eq("id", escritorioId).maybeSingle();
  const { data: cfg } = await supa.from("config_empresa").select("key, value").eq("escritorio_id", escritorioId);
  const v = (k: string): string => {
    const linha = ((cfg ?? []) as { key: string; value?: unknown }[]).find((x) => x.key === k);
    const val = linha?.value;
    return typeof val === "string" ? val.trim() : val != null ? String(val).trim() : "";
  };
  const nome = v("razao_social") || String(e?.nome ?? "").trim();
  if (!nome) return null;
  return {
    nome,
    cnpj: formatarCnpjTimbre(v("cnpj") || e?.cnpj || null),
    telefone: String(e?.telefone ?? "").trim() || null,
    email: String(e?.email ?? "").trim() || null,
  };
}

/** Tamanho em pt: com `alturaPt`, a altura fixa (largura proporcional, limitada a `ladoMaxPt`); sem, o maior lado = `ladoMaxPt`. */
function medidas(m: MarcaDagua, ladoMaxPt: number, alturaPt?: number): { w: number; h: number } {
  const dim = dimensoesImagem(m.bytes, m.tipo) ?? { w: 1, h: 1 };
  let w: number, h: number;
  if (alturaPt) {
    h = alturaPt; w = (dim.w / dim.h) * h;
    if (w > ladoMaxPt) { w = ladoMaxPt; h = (dim.h / dim.w) * w; }
  } else {
    const k = ladoMaxPt / Math.max(dim.w, dim.h);
    w = dim.w * k; h = dim.h * k;
  }
  return { w: Math.round(w * 10) / 10, h: Math.round(h * 10) / 10 };
}

const SHAPETYPE = `<v:shapetype id="_x0000_t75" coordsize="21600,21600" o:spt="75" o:preferrelative="t" path="m@4@5l@4@11@9@11@9@5xe" filled="f" stroked="f"><v:stroke joinstyle="miter"/><v:formulas><v:f eqn="if lineDrawn pixelLineWidth 0"/><v:f eqn="sum @0 1 0"/><v:f eqn="sum 0 0 @1"/><v:f eqn="prod @2 1 2"/><v:f eqn="prod @3 21600 pixelWidth"/><v:f eqn="prod @3 21600 pixelHeight"/><v:f eqn="sum @0 0 1"/><v:f eqn="prod @6 1 2"/><v:f eqn="prod @7 21600 pixelWidth"/><v:f eqn="sum @8 21600 0"/><v:f eqn="prod @7 21600 pixelHeight"/><v:f eqn="sum @10 21600 0"/></v:formulas><v:path o:extrusionok="f" gradientshapeok="t" o:connecttype="rect"/><o:lock v:ext="edit" aspectratio="t"/></v:shapetype>`;

export function cabecalhoXml(logo: MarcaDagua | null | undefined, ident: IdentidadeEmpresa | null): string {
  let corpo: string;
  if (logo) {
    const topo = medidas(logo, 170, 42);
    const fundo = medidas(logo, 12 * 28.35); // 12 cm de lado, como a marca d'água dos documentos do sistema
    corpo = `<w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/><w:jc w:val="center"/></w:pPr>`
      + `<w:r><w:pict>${SHAPETYPE}<v:shape id="TimbreLogo" o:spid="_x0000_s3001" type="#_x0000_t75" style="width:${topo.w}pt;height:${topo.h}pt"><v:imagedata r:id="${RID_LOGO}" o:title="logo"/></v:shape></w:pict></w:r>`
      + `<w:r><w:pict><v:shape id="TimbreMarcaDagua" o:spid="_x0000_s3002" type="#_x0000_t75" style="position:absolute;margin-left:0;margin-top:0;width:${fundo.w}pt;height:${fundo.h}pt;z-index:-251658752;mso-position-horizontal:center;mso-position-horizontal-relative:margin;mso-position-vertical:center;mso-position-vertical-relative:margin" o:allowincell="f"><v:imagedata r:id="${RID_LOGO}" o:title="logo" gain="${GAIN}" blacklevel="${BLACKLEVEL}"/></v:shape></w:pict></w:r>`
      + `</w:p>`;
  } else if (ident) {
    // sem logo cadastrada: o nome da empresa no topo
    corpo = `<w:p><w:pPr><w:spacing w:after="0"/><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="22"/></w:rPr><w:t xml:space="preserve">${xmlEscape(ident.nome)}</w:t></w:r></w:p>`;
  } else {
    corpo = `<w:p/>`;
  }
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:hdr xmlns:w="${NS_W}" xmlns:r="${NS_R}" xmlns:v="${NS_V}" xmlns:o="${NS_O}">${corpo}</w:hdr>`;
}

export function rodapeXml(ident: IdentidadeEmpresa | null): string {
  if (!ident) return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:ftr xmlns:w="${NS_W}"><w:p/></w:ftr>`;
  const contato = [ident.cnpj ? `CNPJ ${ident.cnpj}` : null, ident.telefone, ident.email].filter(Boolean).join("  ·  ");
  const p = (txt: string, negrito: boolean, borda: boolean) =>
    `<w:p><w:pPr>${borda ? `<w:pBdr><w:top w:val="single" w:sz="4" w:space="4" w:color="BBBBBB"/></w:pBdr>` : ""}<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/><w:jc w:val="center"/></w:pPr><w:r><w:rPr>${negrito ? "<w:b/>" : ""}<w:color w:val="555555"/><w:sz w:val="16"/><w:szCs w:val="16"/></w:rPr><w:t xml:space="preserve">${xmlEscape(txt)}</w:t></w:r></w:p>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:ftr xmlns:w="${NS_W}">`
    + p(ident.nome, true, true) + (contato ? p(contato, false, false) : "") + `</w:ftr>`;
}

/** Garante o tipo da imagem e das partes novas no [Content_Types].xml. */
function comTipos(ct: string, ext: string | null, partes: { nome: string; tipo: string }[]): string {
  let s = ct;
  if (ext && !new RegExp(`<Default[^>]+Extension="${ext}"`, "i").test(s)) {
    s = s.replace("</Types>", `<Default Extension="${ext}" ContentType="image/${ext}"/></Types>`);
  }
  for (const p of partes) {
    if (!s.includes(`PartName="/${p.nome}"`)) s = s.replace("</Types>", `<Override PartName="/${p.nome}" ContentType="${p.tipo}"/></Types>`);
  }
  return s;
}

/** Caminho da parte no pacote a partir do Target da relação do documento. */
function parteDoAlvo(alvo: string): string {
  return alvo.startsWith("/") ? alvo.slice(1) : `word/${alvo}`;
}
function relsDaParte(parte: string): string {
  const i = parte.lastIndexOf("/");
  return `${parte.slice(0, i)}/_rels/${parte.slice(i + 1)}.rels`;
}

/**
 * Aplica o timbre a um pacote DOCX já com o corpo pronto. Usa os cabeçalhos e
 * rodapés que o modelo referencia; o que faltar (modelo sem cabeçalho/rodapé,
 * ou cabeçalho de 1ª página sem rodapé correspondente) é criado e ligado a
 * todas as seções.
 */
export async function aplicarTimbreAutomatico(zip: JSZip, logo: MarcaDagua | null | undefined, ident: IdentidadeEmpresa | null): Promise<void> {
  if (!logo && !ident) return;
  const docPath = "word/document.xml", relsPath = "word/_rels/document.xml.rels";
  let doc = await zip.file(docPath)!.async("string");
  let rels = zip.file(relsPath) ? await zip.file(relsPath)!.async("string")
    : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${NS_PKG}"></Relationships>`;

  // rId → Target das relações do documento
  const alvo = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /\bId="([^"]+)"/.exec(m[0])?.[1], t = /\bTarget="([^"]+)"/.exec(m[0])?.[1];
    if (id && t) alvo.set(id, t);
  }
  const ridsDe = (tipo: "header" | "footer") => [...doc.matchAll(new RegExp(`<w:${tipo}Reference\\b[^>]*r:id="([^"]+)"`, "g"))].map((m) => m[1]);

  const partesNovas: { nome: string; tipo: string }[] = [];
  const novaRel = (id: string, tipo: "header" | "footer", target: string): string => {
    if (!alvo.has(id)) {
      rels = rels.replace("</Relationships>", `<Relationship Id="${id}" Type="${NS_R}/${tipo}" Target="${target}"/></Relationships>`);
      alvo.set(id, target);
      partesNovas.push({ nome: `word/${target}`, tipo: tipo === "header" ? TIPO_HDR : TIPO_FTR });
    }
    return id;
  };
  // rId usado onde faltar cabeçalho/rodapé numa seção: o primeiro existente, ou um novo
  const ridHdr = ridsDe("header").find((r) => alvo.has(r)) ?? novaRel("rIdTimbreHdr", "header", "header-timbre.xml");
  const ridFtr = ridsDe("footer").find((r) => alvo.has(r)) ?? novaRel("rIdTimbreFtr", "footer", "footer-timbre.xml");

  // cada seção: todo tipo (default/first/even) que tem cabeçalho ganha rodapé e vice-versa;
  // e o rodapé fica a pelo menos 1 cm da borda
  doc = doc.replace(/<w:sectPr\b[^>]*?(?:\/>|>[\s\S]*?<\/w:sectPr>)/g, (sec) => {
    const tipos = (k: "header" | "footer") => new Set([...sec.matchAll(new RegExp(`<w:${k}Reference\\b[^>]*w:type="(\\w+)"`, "g"))].map((m) => m[1]));
    const th = tipos("header"), tf = tipos("footer");
    const todos = new Set(["default", ...th, ...tf]);
    const faltam = [...todos].filter((t) => !th.has(t)).map((t) => `<w:headerReference w:type="${t}" r:id="${ridHdr}"/>`)
      .concat([...todos].filter((t) => !tf.has(t)).map((t) => `<w:footerReference w:type="${t}" r:id="${ridFtr}"/>`));
    let s = sec;
    if (faltam.length) {
      s = s.endsWith("/>") && !s.includes("</w:sectPr>")
        ? s.replace(/\/>$/, `>${faltam.join("")}</w:sectPr>`)
        : s.replace(/^<w:sectPr\b[^>]*>/, (a) => a + faltam.join(""));
    }
    return s.replace(/(<w:pgMar\b[^>]*\bw:footer=")(\d+)"/, (a, pre, v) => Number(v) < RODAPE_MIN_TWIPS ? `${pre}${RODAPE_MIN_TWIPS}"` : a);
  });
  if (!/xmlns:r="/.test(doc.slice(0, 4000))) doc = doc.replace(/<w:document\b/, `<w:document xmlns:r="${NS_R}"`);
  zip.file(docPath, doc);
  zip.file(relsPath, rels);

  const cabecalhos = [...new Set(ridsDe("header").map((r) => alvo.get(r)).filter((t): t is string => !!t))].map(parteDoAlvo);
  const rodapes = [...new Set(ridsDe("footer").map((r) => alvo.get(r)).filter((t): t is string => !!t))].map(parteDoAlvo);

  const ext = logo ? (logo.tipo === "png" ? "png" : "jpeg") : null;
  if (logo) zip.file(`word/media/logo-timbre.${ext}`, logo.bytes);
  const hdr = cabecalhoXml(logo, ident), ftr = rodapeXml(ident);
  const relsVazio = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${NS_PKG}"></Relationships>`;
  for (const parte of cabecalhos) {
    zip.file(parte, hdr);
    zip.file(relsDaParte(parte), logo
      ? `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${NS_PKG}"><Relationship Id="${RID_LOGO}" Type="${NS_R}/image" Target="media/logo-timbre.${ext}"/></Relationships>`
      : relsVazio);
  }
  for (const parte of rodapes) {
    zip.file(parte, ftr);
    if (zip.file(relsDaParte(parte))) zip.file(relsDaParte(parte), relsVazio);
  }
  zip.file("[Content_Types].xml", comTipos(await zip.file("[Content_Types].xml")!.async("string"), ext, partesNovas));
}
