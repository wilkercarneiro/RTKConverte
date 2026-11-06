// Saídas da análise: o PDF (src/lib/restricoes_pdf.ts estendido) e o resumo em
// texto para colar no WhatsApp/e-mail do cliente. Puro.
import { fmtData } from "../restricoes.ts";
import type { ResultadoRestricoes } from "../restricoes.ts";
import type { DadosRelatorioRestricoes, SecaoRelatorio } from "../restricoes_pdf.ts";
import { fraseDaAnalise, NOME_FONTE } from "./analise.ts";
import type { Analise } from "./analise.ts";
import { textoFocos } from "./focos.ts";
import { fmtAreaCurta, fmtDist, fmtHa, fmtNum } from "./geometria.ts";

const NATUREZA: Record<string, string> = {
  car: "CAR — declarado pelo proprietário (SICAR)",
  sigef: "SIGEF — parcela certificada pelo INCRA",
  arquivo: "Área enviada em arquivo",
  desenho: "Área desenhada no mapa",
  campo: "Medição de campo (GPS do celular, ±3 a 10 m)",
};

/** Diferença entre a área do sistema e a declarada/certificada, quando passa de 0,5%. */
export function diferencaDeArea(areaM2: number, declaradaHa: number | null): string | null {
  if (declaradaHa == null || declaradaHa <= 0) return null;
  const d = (areaM2 / 10_000 - declaradaHa) / declaradaHa * 100;
  if (Math.abs(d) < 0.5) return null;
  return `${d > 0 ? "+" : "−"}${fmtNum(Math.abs(d), 1)}%`;
}

const falhou = (nome: string, motivo: string) => ({ texto: `${nome}: não respondeu (${motivo}).`, destaque: true });

export function secoesDoRelatorio(a: Analise): SecaoRelatorio[] {
  const im = a.imovel;
  const secoes: SecaoRelatorio[] = [];
  const ident: SecaoRelatorio["linhas"] = [
    { texto: `${NATUREZA[im.fonte] ?? "Área"}: ${im.titulo}${im.codigo && !im.titulo.includes(im.codigo) ? ` (${im.codigo})` : ""}`, destaque: true },
  ];
  if (im.situacao && im.fonte !== "arquivo") ident.push({ texto: `Situação: ${im.situacao}` });
  const dif = diferencaDeArea(a.medidas.areaM2, im.areaDeclaradaHa);
  ident.push({
    texto: `Área calculada pelo sistema: ${fmtHa(a.medidas.areaM2)} · perímetro ${fmtNum(a.medidas.perimetroM, 2)} m · ${a.medidas.vertices} vértices`
      + (im.areaDeclaradaHa != null ? ` · ${im.fonte === "sigef" ? "certificada" : "declarada"}: ${fmtNum(im.areaDeclaradaHa, 4)} ha${dif ? ` (${dif})` : ""}` : ""),
    sub: `UTM SIRGAS 2000, fuso ${a.medidas.fuso}S, fórmula de Gauss (o mesmo cálculo de todo o sistema).${im.furos ? ` ${im.furos} furo(s) do polígono não entram: vale o contorno externo.` : ""}`,
  });
  if (a.municipio.estado === "ok" && a.municipio.dados) {
    const m = a.municipio.dados;
    ident.push({ texto: `Município: ${m.nome}/${m.uf}${m.regiaoImediata ? ` · região imediata de ${m.regiaoImediata}` : ""} (IBGE)` });
  } else if (im.municipio) ident.push({ texto: `Município: ${im.municipio}${im.uf ? `/${im.uf}` : ""}` });
  for (const d of im.detalhes) ident.push({ texto: d });
  if (im.atualizacao) ident.push({ texto: `Atualizado na base em ${fmtData(im.atualizacao)}` });
  secoes.push({ titulo: "Identificação", linhas: ident });

  // SIGEF
  const sig: SecaoRelatorio["linhas"] = [];
  if (a.sigef.estado === "ok") {
    const s = a.sigef.dados;
    const sobre = s.sobreposicoes.filter((x) => !x.mesma_parcela);
    const proprias = s.sobreposicoes.filter((x) => x.mesma_parcela);
    if (proprias.length) sig.push({ texto: `A área coincide com parcela certificada: ${proprias.map((x) => x.codigo).join(", ")}.`, destaque: true });
    for (const x of sobre) {
      sig.push({ texto: `Sobrepõe a parcela certificada ${x.nome ?? x.codigo} em ${fmtHa(x.area_m2)} (${fmtNum(x.percentual_imovel, 2)}% da área)`, destaque: true, sub: `${x.codigo}${x.situacao ? ` · ${x.situacao}` : ""}` });
    }
    if (!sobre.length) sig.push({ texto: "Nenhuma parcela certificada sobrepõe a área." });
    if (s.vizinhas.length) {
      sig.push({ texto: `${s.vizinhas.length} parcela(s) certificada(s) a até ${s.raioM} m — confrontantes em potencial:` });
      for (const v of s.vizinhas.slice(0, 8)) sig.push({ texto: `   ${v.nome ?? v.codigo} — a ${fmtNum(v.distanciaM, 0)} m`, sub: `${v.codigo}${v.situacao ? ` · ${v.situacao}` : ""}` });
    } else sig.push({ texto: `Nenhuma parcela certificada a até ${s.raioM} m.` });
    sig.push({ texto: s.online === "ok" ? "SIGEF (INCRA) consultado agora." : s.online === "sem-uf" ? "Só a base local do sistema: falta a UF para consultar o INCRA na hora." : `Só a base local do sistema: o INCRA não respondeu agora${s.detalhe ? ` (${s.detalhe})` : ""}.`, sub: "Certificação pelo INCRA (SIGEF)." });
  } else if (a.sigef.estado === "falhou") sig.push(falhou(NOME_FONTE.sigef, a.sigef.motivo));
  if (sig.length) secoes.push({ titulo: "SIGEF — parcelas certificadas", linhas: sig });

  // CAR de outros sobre a área
  const car: SecaoRelatorio["linhas"] = [];
  if (a.car.estado === "ok") {
    const c = a.car.dados;
    const sobre = c.itens.filter((x) => x.areaM2 > 0);
    for (const x of sobre) car.push({ texto: `Sobrepõe o CAR ${x.codigo} em ${fmtHa(x.areaM2)} (${fmtNum(x.pct, 2)}% da área)`, destaque: true, sub: x.situacao ?? null });
    const vizinhos = c.itens.filter((x) => x.areaM2 === 0);
    if (!sobre.length) car.push({ texto: "Nenhum outro CAR declarado sobrepõe a área." });
    if (vizinhos.length) car.push({ texto: `${vizinhos.length} CAR vizinho(s) a até 100 m, sem sobreposição.` });
    if (c.cortada) car.push({ texto: "Há mais imóveis declarados na vizinhança do que os conferidos (limite da consulta)." });
    car.push({ texto: "CAR é declaração do proprietário (SICAR), não título nem certificação.", sub: null });
  } else if (a.car.estado === "falhou") car.push(falhou(NOME_FONTE.car, a.car.motivo));
  if (car.length) secoes.push({ titulo: "CAR — outros imóveis declarados sobre a área", linhas: car });

  // queimadas
  if (a.focos.estado === "ok") {
    const f = a.focos.dados;
    secoes.push({
      titulo: "Focos de queimada (INPE)", linhas: [
        { texto: `${textoFocos(f)}.`, destaque: f.dentro.length > 0 },
        { texto: `Satélite de referência do INPE: ${f.referenciaDentro} dentro · ${f.referenciaPerto} a até 1 km. Desde ${fmtData(f.desde)}.`, sub: "Um mesmo incêndio pode ser detectado por vários satélites; o de referência é a série comparável de ano a ano." },
      ],
    });
  } else if (a.focos.estado === "falhou") secoes.push({ titulo: "Focos de queimada (INPE)", linhas: [falhou(NOME_FONTE.focos, a.focos.motivo)] });

  // ambiente
  const amb: SecaoRelatorio["linhas"] = [];
  if (a.bioma.estado === "ok") amb.push({ texto: `Bioma: ${a.bioma.dados.bioma}${a.bioma.dados.amazoniaLegal === true ? " · Amazônia Legal" : a.bioma.dados.amazoniaLegal === false ? " · fora da Amazônia Legal" : ""} (IBGE)`, sub: a.bioma.dados.reservaLegal });
  else if (a.bioma.estado === "falhou") amb.push(falhou(NOME_FONTE.bioma, a.bioma.motivo));
  if (a.solo.estado === "ok") {
    const s = a.solo.dados;
    amb.push({ texto: `Solo provável: ${s.nome} (WRB: ${s.wrb}${s.probabilidade != null ? `, ${s.probabilidade}%` : ""}) — SoilGrids`, sub: `${s.explicacao} Estimativa de modelo global (250 m), não é levantamento de solo.` });
  } else if (a.solo.estado === "falhou") amb.push(falhou(NOME_FONTE.solo, a.solo.motivo));
  if (a.clima.estado === "ok") {
    const c = a.clima.dados;
    amb.push({
      texto: `Chuva: ${fmtNum(c.chuva12mMm, 0)} mm em 12 meses · ${fmtNum(c.chuva30dMm, 0)} mm nos últimos 30 dias${c.tempMediaC != null ? ` · temperatura média ${fmtNum(c.tempMediaC, 1)} °C` : ""} (Open-Meteo)`,
      sub: `De ${fmtData(c.de)} a ${fmtData(c.ate)}.${c.maisChuvoso ? ` Mês mais chuvoso: ${c.maisChuvoso.mes.split("-").reverse().join("/")} (${fmtNum(c.maisChuvoso.chuvaMm, 0)} mm).` : ""}${c.maisSeco ? ` Mais seco: ${c.maisSeco.mes.split("-").reverse().join("/")} (${fmtNum(c.maisSeco.chuvaMm, 0)} mm).` : ""} Reanálise ERA5, não é estação.`,
    });
  } else if (a.clima.estado === "falhou") amb.push(falhou(NOME_FONTE.clima, a.clima.motivo));
  if (amb.length) secoes.push({ titulo: "Ambiente", linhas: amb });
  return secoes;
}

/** Um resultado de restrições vazio (a consulta de restrições não respondeu): o PDF sai com o resto. */
export function restricoesVazias(a: Analise): ResultadoRestricoes {
  return { quando: a.quando, fuso: a.medidas.fuso, areaImovelM2: a.medidas.areaM2, encostaM: 300, fontes: [] };
}

export function dadosDoPdf(a: Analise, emitente?: string | null): DadosRelatorioRestricoes {
  const f = fraseDaAnalise(a);
  const focos = a.focos.estado === "ok" ? [...a.focos.dados.dentro, ...a.focos.dados.perto] : [];
  return {
    titulo: "Consulta do imóvel",
    imovel: a.imovel.titulo,
    municipio: a.municipio.estado === "ok" && a.municipio.dados ? a.municipio.dados.nome : a.imovel.municipio,
    uf: a.municipio.estado === "ok" && a.municipio.dados ? a.municipio.dados.uf : a.imovel.uf,
    emitente: emitente ?? null,
    resumo: { texto: f.texto, tom: f.tom, linhas: [...f.identificacao, ...f.sobreposicoes.slice(1).map((s) => `Sobrepõe ${s}`), ...f.avisos, ...f.pendentes] },
    areaM2: a.medidas.areaM2, fuso: a.medidas.fuso,
    secoes: secoesDoRelatorio(a),
    laudo: a.laudo,
    pontos: focos.map((x) => ({ lonlat: [x.lon, x.lat] as [number, number], cor: x.distanciaM === 0 ? "#DC2626" : "#F97316" })),
  };
}

/** O resumo curto para colar no WhatsApp/e-mail. */
export function resumoEmTexto(a: Analise): string {
  const f = fraseDaAnalise(a);
  const im = a.imovel;
  const l: string[] = [];
  l.push(`*${im.titulo}*`);
  const mun = a.municipio.estado === "ok" && a.municipio.dados ? `${a.municipio.dados.nome}/${a.municipio.dados.uf}` : im.municipio ? `${im.municipio}${im.uf ? `/${im.uf}` : ""}` : null;
  l.push([`Área: ${fmtAreaCurta(a.medidas.areaM2)}`, mun, im.situacao && im.fonte !== "arquivo" ? im.situacao : null].filter(Boolean).join(" · "));
  l.push("");
  l.push(`${f.tom === "perigo" ? "⚠️" : f.tom === "ok" ? "✅" : "ℹ️"} ${f.texto}`);
  for (const s of f.identificacao) l.push(`• ${s}`);
  for (const s of f.sobreposicoes.slice(1)) l.push(`• Sobrepõe ${s}`);
  for (const s of f.avisos) l.push(`• ${s}`);
  for (const s of f.pendentes) l.push(`• ${s}`);
  if (a.restricoes.estado === "ok") {
    const livres = a.restricoes.dados.fontes.filter((x) => x.classe === "livre").length;
    if (livres) l.push(`• ${livres} de ${a.restricoes.dados.fontes.length} bases de restrição sem nada a menos de 300 m`);
  }
  if (a.bioma.estado === "ok") l.push(`• Bioma ${a.bioma.dados.bioma}${a.bioma.dados.amazoniaLegal ? " (Amazônia Legal)" : ""}`);
  if (a.focos.estado === "ok") l.push(`• ${textoFocos(a.focos.dados)}`);
  l.push("");
  l.push(`Consulta automática a bases públicas em ${new Date(a.quando).toLocaleDateString("pt-BR")} — alerta, não certidão. (Vertces)`);
  return l.join("\n");
}

/** Distância/contato de um vizinho, para o memorial: "encosta na divisa" (até 1 m) ou "a 35 m". */
function contato(distanciaM: number): string {
  return distanciaM < 1 ? "encosta na divisa" : `a ${fmtDist(distanciaM)} da divisa`;
}

/**
 * Os confrontantes em potencial, prontos para o memorial ou a carta de anuência:
 * as parcelas certificadas do SIGEF (sobrepostas e vizinhas a até o raio) e os
 * CAR declarados que sobrepõem ou encostam na área. Fonte que não respondeu
 * diz que não respondeu (nunca vira "nenhum confrontante"). Puro.
 */
export function textoConfrontantes(a: Analise): { texto: string; total: number } {
  const im = a.imovel;
  const l: string[] = [];
  let total = 0;
  l.push(`CONFRONTANTES EM POTENCIAL — ${im.fonte === "car" && im.codigo ? `CAR ${im.codigo}` : im.titulo} (${fmtHa(a.medidas.areaM2)})`);
  l.push(`Consulta a bases públicas em ${new Date(a.quando).toLocaleDateString("pt-BR")} (Vertces). Alerta, não certidão: confirme no campo e na documentação.`);

  l.push("");
  l.push("SIGEF — parcelas certificadas pelo INCRA");
  if (a.sigef.estado === "ok") {
    const s = a.sigef.dados;
    const linhas = [
      ...s.sobreposicoes.filter((x) => !x.mesma_parcela).map((x) => ({
        codigo: x.codigo, nome: x.nome, situacao: x.situacao,
        rel: `SOBREPÕE ${fmtAreaCurta(x.area_m2)} (${fmtNum(x.percentual_imovel, 2)}% da área)`,
      })),
      ...s.vizinhas.map((v) => ({ codigo: v.codigo, nome: v.nome, situacao: v.situacao, rel: contato(v.distanciaM) })),
    ];
    if (!linhas.length) l.push(`Nenhuma parcela certificada sobrepõe a área nem está a até ${fmtDist(s.raioM)} dela.`);
    linhas.forEach((x, i) => l.push(`${i + 1}. ${x.codigo}${x.nome?.trim() ? ` — ${x.nome.trim()}` : " — sem denominação na base"} · ${x.situacao ?? "certificada"} · ${x.rel}`));
    total += linhas.length;
    if (s.online !== "ok") l.push("(só a cópia da base do sistema: o INCRA não foi consultado agora)");
  } else l.push(a.sigef.estado === "carregando" ? "(ainda consultando o SIGEF)" : `(o SIGEF não respondeu: ${a.sigef.motivo})`);

  l.push("");
  l.push("CAR — imóveis declarados no SICAR (declaração do proprietário)");
  if (a.car.estado === "ok") {
    const itens = a.car.dados.itens;
    if (!itens.length) l.push("Nenhum outro CAR declarado sobrepõe ou encosta na área.");
    itens.forEach((c, i) => l.push(`${i + 1}. ${c.codigo}${c.situacao ? ` · ${c.situacao}` : ""}${c.municipio ? ` · ${c.municipio}` : ""} · ${c.areaM2 > 0 ? `SOBREPÕE ${fmtAreaCurta(c.areaM2)} (${fmtNum(c.pct, 2)}% da área)` : contato(c.distanciaM)}${c.areaDeclaradaHa != null ? ` · declarado com ${fmtNum(c.areaDeclaradaHa, 4)} ha` : ""}`));
    total += itens.length;
    if (a.car.dados.cortada) l.push("(resposta cortada pelo SICAR: pode haver outros CAR por perto)");
  } else l.push(a.car.estado === "carregando" ? "(ainda consultando o SICAR)" : `(o SICAR não respondeu: ${a.car.motivo})`);
  return { texto: l.join("\n"), total };
}
