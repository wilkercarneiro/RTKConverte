// Validador: independente de quem escreveu a receita (regras, IA, operador,
// perfil), prova que a leitura está certa — ou diz exatamente o que falta.
//
// V1 procedência  — cada número é um trecho literal do arquivo e relê igual
// V2 cobertura    — toda linha não vazia virou ponto ou foi ignorada COM motivo;
//                   linhas ilegíveis só passam se o operador as confirmar
// V3 faixas       — E/N/lat/lon/h/σ plausíveis (limites SIGEF/Brasil)
// V5 coerência    — UTM × geográfica batem quando o arquivo traz as duas
// V6/V7           — geometria e repetidos (ordem.ts)
import { GEO_DEF, LIMITES, ZONAS_BR, utmDef } from "../geo.ts";
import type { Proj4 } from "../geo.ts";
import { lerAngulo, lerNumero } from "./numeros.ts";
import type { Receita } from "./receita.ts";
import type { Aviso, LinhaIgnorada, PontoLido } from "./executor.ts";

export interface EntradaValidacao {
  linhas: string[];
  receita: Receita;
  pontos: PontoLido[];
  /** Índices (em `pontos`) do perímetro. */
  anel: number[];
  /** Posições no anel de cada parte (sem isto, o anel é uma parte só). */
  blocos?: number[][];
  ignoradas: LinhaIgnorada[];
  /** Linhas consumidas por extratores de formato (GSI, XML…) além das dos pontos. */
  consumidas?: Set<number>;
  /** O registro garante cobertura por construção (XML, DXF, GeoJSON): pula V2. */
  semCobertura?: boolean;
  proj4: Proj4 | null;
}

export function validar(v: EntradaValidacao): Aviso[] {
  const avisos: Aviso[] = [];
  const { linhas, receita: r, pontos } = v;

  // ---- V1 procedência ----
  const semProcedencia: number[] = [];
  const fs = { m: 1, cm: 0.01, mm: 0.001 }[r.unidade_sigma];
  for (const p of pontos) {
    let ok = true;
    for (const [papel, f] of Object.entries(p.fontes)) {
      if (!f) continue;
      const fonteTexto = linhas[f.linha - 1];
      if (fonteTexto === undefined || !fonteTexto.includes(f.bruto.trim())) { ok = false; break; }
      if (papel === "e" || papel === "n" || papel === "h") {
        const val = lerNumero(f.valor ?? f.bruto, r.decimal);
        const alvo = papel === "e" ? p.e : papel === "n" ? p.n : p.h;
        if (val === null || alvo === null || Math.abs(val - alvo) > 1e-9) { ok = false; break; }
      }
      if (papel === "sigma_pos" && p.sigmaPos !== null && r.campos.sigma_n === null && r.campos.sigma_e === null) {
        const val = lerNumero(f.valor ?? f.bruto, r.decimal);
        if (val === null || Math.abs(val * fs - p.sigmaPos) > 1e-9) { ok = false; break; }
      }
      if ((papel === "lat" || papel === "lon") && p.geo) {
        const a = lerAngulo(f.valor ?? f.bruto, papel, r.decimal);
        const alvo = papel === "lat" ? p.geo.lat : p.geo.lon;
        if (!a || Math.abs(Math.abs(a.graus) - Math.abs(alvo)) > 1e-12) { ok = false; break; }
      }
    }
    if (p.origemEN === "utm" && (!p.fontes.e || !p.fontes.n)) ok = false;
    if (p.origemEN === "geo" && (!p.fontes.lat || !p.fontes.lon)) ok = false;
    if (!ok) semProcedencia.push(p.linha);
  }
  if (semProcedencia.length) {
    avisos.push({ codigo: "V1_procedencia", nivel: "bloqueio", mensagem: "Há coordenadas que não correspondem ao texto do arquivo. A leitura foi recusada para não gravar número errado.", linhas: semProcedencia });
  }

  // ---- V2 cobertura ----
  if (!v.semCobertura) {
    const cobertas = new Set<number>([...pontos.map((p) => p.linha), ...v.ignoradas.map((i) => i.linha), ...(v.consumidas ?? [])]);
    const soltas: number[] = [];
    linhas.forEach((l, i) => { if (l.trim() && !cobertas.has(i + 1)) soltas.push(i + 1); });
    if (soltas.length) avisos.push({ codigo: "V2_cobertura", nivel: "bloqueio", mensagem: "Há linhas que não viraram ponto nem foram explicadas.", linhas: soltas });
  }
  const ilegiveis = v.ignoradas.filter((i) => i.tipo === "ilegivel");
  if (ilegiveis.length) {
    // ilegível no meio dos pontos é o caso perigoso: pode ser um vértice perdido
    const linhasPontos = pontos.map((p) => p.linha);
    const min = Math.min(...linhasPontos), max = Math.max(...linhasPontos);
    const noMeio = ilegiveis.filter((i) => i.linha > min && i.linha < max);
    const nasPontas = ilegiveis.filter((i) => !(i.linha > min && i.linha < max));
    if (noMeio.length) {
      avisos.push({
        codigo: "linhas_ilegiveis", nivel: "alerta",
        mensagem: `${noMeio.length} linha${noMeio.length > 1 ? "s" : ""} no meio dos pontos não ${noMeio.length > 1 ? "puderam" : "pôde"} ser lida${noMeio.length > 1 ? "s" : ""}. Confira: pode ser um vértice que ficaria de fora.`,
        linhas: noMeio.map((i) => i.linha),
      });
    }
    if (nasPontas.length) {
      avisos.push({
        codigo: "linhas_extras", nivel: "info",
        mensagem: `${nasPontas.length} linha${nasPontas.length > 1 ? "s" : ""} no começo/fim do arquivo não ${nasPontas.length > 1 ? "são" : "é"} ponto e ficou de fora.`,
        linhas: nasPontas.map((i) => i.linha),
      });
    }
  }

  // ---- V3 faixas ----
  const anel = v.anel.map((i) => pontos[i]);
  const foraEN = anel.filter((p) => !(p.e >= LIMITES.eMin && p.e <= LIMITES.eMax && p.n >= LIMITES.nMin && p.n <= LIMITES.nMax));
  if (foraEN.length) {
    const norte = anel.some((p) => p.geo && p.geo.lat > 0);
    avisos.push({
      codigo: "V3_fora_limites", nivel: "bloqueio",
      mensagem: norte
        ? "O imóvel fica ao norte do Equador: o sistema ainda calcula só no hemisfério sul (fusos 18S a 25S)."
        : `Coordenada fora dos limites do SIGEF (E ${LIMITES.eMin}–${LIMITES.eMax}, N até ${LIMITES.nMax}). Confira se as colunas de E e N estão certas.`,
      linhas: foraEN.map((p) => p.linha),
    });
  }
  const foraGeo = anel.filter((p) => p.geo && !(p.geo.lat >= LIMITES.latMin && p.geo.lat <= LIMITES.latMax && p.geo.lon >= LIMITES.lonMin && p.geo.lon <= LIMITES.lonMax));
  if (foraGeo.length) avisos.push({ codigo: "V3_fora_brasil", nivel: "bloqueio", mensagem: "Latitude/longitude fora do Brasil. Confira as colunas e o hemisfério.", linhas: foraGeo.map((p) => p.linha) });
  const hEstranho = anel.filter((p) => p.h !== null && (p.h < -100 || p.h > 3100));
  if (hEstranho.length) avisos.push({ codigo: "V3_altura", nivel: "alerta", mensagem: "Altitude fora do esperado no Brasil (−100 a 3.100 m). Confira a coluna da altura.", linhas: hEstranho.map((p) => p.linha) });
  const semH = anel.filter((p) => p.h === null);
  if (semH.length) avisos.push({ codigo: "sem_altura", nivel: "bloqueio", mensagem: "O arquivo não traz a altitude de todos os pontos; o SIGEF exige.", linhas: semH.map((p) => p.linha) });
  const semSigma = anel.filter((p) => p.sigmaPos === null || p.sigmaH === null);
  if (semSigma.length) {
    avisos.push({
      codigo: "sem_precisao", nivel: "bloqueio",
      mensagem: semSigma.length === anel.length
        ? "O arquivo não traz as precisões (σ) dos pontos; o SIGEF exige. Informe a precisão padrão na prévia ou exporte com as precisões."
        : "Alguns pontos estão sem precisão (σ). Informe a precisão padrão na prévia.",
      linhas: semSigma.map((p) => p.linha),
    });
  }
  const sigmaAbsurdo = anel.filter((p) => (p.sigmaPos ?? 0) > 10 || (p.sigmaH ?? 0) > 10);
  if (sigmaAbsurdo.length) avisos.push({ codigo: "V3_sigma_unidade", nivel: "bloqueio", mensagem: "Precisão acima de 10 m: provavelmente a unidade está errada (cm ou mm lidos como metros).", linhas: sigmaAbsurdo.map((p) => p.linha) });
  const sigmaAlto = anel.filter((p) => (p.sigmaPos ?? 0) > 0.5 && (p.sigmaPos ?? 0) <= 10);
  if (sigmaAlto.length) avisos.push({ codigo: "sigma_alto", nivel: "alerta", mensagem: "Pontos com precisão horizontal pior que 50 cm.", linhas: sigmaAlto.map((p) => p.linha) });
  const sigmaMedio = anel.filter((p) => (p.sigmaPos ?? 0) > 0.1 && (p.sigmaPos ?? 0) <= 0.5);
  if (sigmaMedio.length) avisos.push({ codigo: "sigma_medio", nivel: "info", mensagem: "Pontos com precisão horizontal entre 10 e 50 cm.", linhas: sigmaMedio.map((p) => p.linha) });

  // ---- V5 coerência UTM × geográfica ----
  const ambos = anel.filter((p) => p.origemEN === "utm" && p.geo);
  if (ambos.length && v.proj4) {
    let melhor = Infinity, melhorFuso = 0;
    for (const z of ZONAS_BR) {
      const ud = utmDef(z);
      const dif = ambos.map((p) => { const [x, y] = v.proj4!(GEO_DEF, ud, [p.geo!.lon, p.geo!.lat]); return Math.hypot(x - p.e, y - p.n); });
      const med = dif.sort((a, b) => a - b)[Math.floor(dif.length / 2)];
      if (med < melhor) { melhor = med; melhorFuso = z; }
    }
    if (melhor > 5) {
      avisos.push({ codigo: "V5_utm_geo", nivel: "bloqueio", mensagem: `As coordenadas UTM e as geográficas do arquivo não batem (diferença de ~${Math.round(melhor)} m). Datum ou fuso diferentes: confira a exportação.` });
    } else if (melhor > 0.5) {
      avisos.push({ codigo: "V5_utm_geo", nivel: "alerta", mensagem: `UTM e geográficas diferem ~${melhor.toFixed(2)} m (fuso ${melhorFuso}S). Usamos as UTM.` });
    }
  }

  // ---- lados absurdamente longos (ponto de outra obra) ----
  const partes = (v.blocos ?? [anel.map((_, k) => k)]).map((b) => b.map((k) => anel[k]));
  for (const parte of partes) {
    if (parte.length < 5) continue;
    const lados = parte.map((p, i) => Math.hypot(parte[(i + 1) % parte.length].e - p.e, parte[(i + 1) % parte.length].n - p.n));
    const med = [...lados].sort((a, b) => a - b)[Math.floor(lados.length / 2)];
    const longos = lados.map((l, i) => ({ l, i })).filter((x) => med > 0 && x.l > Math.max(30 * med, 2000));
    if (longos.length) {
      avisos.push({
        codigo: "lado_longo", nivel: "alerta",
        mensagem: `Lado muito mais longo que os outros (${longos.map((x) => `${parte[x.i].nome}→${parte[(x.i + 1) % parte.length].nome}: ${Math.round(x.l)} m`).join("; ")}). Pode ser um ponto de outro lugar (base, apoio).`,
        linhas: longos.map((x) => parte[x.i].linha),
      });
    }
  }
  return avisos;
}
