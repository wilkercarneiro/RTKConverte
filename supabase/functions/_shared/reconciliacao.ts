// Módulo de Reconciliação: utiliza o PDF do SIGEF como validador e corretor
// da planilha ODS (dados do banco de dados).
// Substitui/atualiza os pontos conflitantes e insere os pontos de terceiros
// preservando a sequência exata do perímetro oficial do SIGEF.

import type { LinhaSigef } from "./sigef_pdf.ts";
import { GEO_DEF, utmDef } from "./geo.ts";
import type { Proj4 } from "./geo.ts";

export interface VerticeBanco {
  id?: string;
  servico_id: string;
  ordem: number;
  num_txt: number | null;
  rotulo_txt: string | null;
  codigo: string | null;
  e: number | null;
  n: number | null;
  h: number | null;
  sigma_pos: number | null;
  sigma_h: number | null;
  tipo: string;
  metodo: string;
  inserido_manual: boolean;
  lat_gms: string | null;
  lon_gms: string | null;
  // Confrontação, que vive no próprio vértice M. Precisa atravessar a
  // reconciliação: o SIGEF devolve geometria, não confrontantes.
  // Ver ARQUITETURA-TRECHOS.md.
  descritivo?: string | null;
  tipo_limite?: string | null;
  eh_via?: boolean | null;
  cns?: string | null;
  matricula?: string | null;
  apelido_txt?: string | null;
}

export interface VerticeReconciliado {
  servico_id: string;
  ordem: number;
  num_txt: number | null;
  rotulo_txt: string | null;
  codigo: string;
  e: number;
  n: number;
  h: number;
  sigma_pos: number;
  sigma_h: number;
  tipo: "M" | "P" | "V";
  metodo: string;
  inserido_manual: boolean;
  lat_gms: string;
  lon_gms: string;
  descritivo: string | null;
  tipo_limite: string | null;
  eh_via: boolean;
  cns: string | null;
  matricula: string | null;
  apelido_txt: string | null;
}

function gmsPdfParaDeg(s: string): number {
  const m = s.match(/(-?)(\d+)°(\d+)'([\d,]+)"/);
  if (!m) return 0;
  const v = parseInt(m[2], 10) + parseInt(m[3], 10) / 60 + parseFloat(m[4].replace(",", ".")) / 3600;
  return m[1] === "-" ? -v : v;
}

function tipoDoCodigo(codigo: string): "M" | "P" | "V" {
  if (/-M-/.test(codigo)) return "M";
  if (/-V-/.test(codigo)) return "V";
  return "P";
}

/**
 * Reconcilia os vértices cadastrados no banco (origem ODS/TXT) com as linhas
 * oficiais extraídas da prévia do SIGEF (PDF).
 * 
 * 1. Mapeia a sequência oficial do SIGEF (que pode incluir pontos de outros profissionais).
 * 2. Faz o match por código ou proximidade com os vértices da nossa planilha.
 * 3. Substitui pontos conflitantes e insere novos vértices de confrontantes/terceiros.
 * 4. Retorna a nova lista de vértices ordenados para ser salva no banco.
 */
export function reconciliarVerticesBancoComSigef(
  servicoId: string,
  vertBanco: VerticeBanco[],
  sigefLinhas: LinhaSigef[],
  fusoUtm: number,
  proj4: Proj4
): VerticeReconciliado[] {
  const ud = utmDef(fusoUtm);
  const porCodigoBanco = new Map<string, VerticeBanco>();
  for (const v of vertBanco) {
    if (v.codigo) porCodigoBanco.set(v.codigo, v);
  }

  const resultado: VerticeReconciliado[] = sigefLinhas.map((l, idx) => {
    const lonDeg = gmsPdfParaDeg(l.lon);
    const latDeg = gmsPdfParaDeg(l.lat);
    const [e, n] = proj4(GEO_DEF, ud, [lonDeg, latDeg]);
    const h = parseFloat(l.alt.replace(",", ".")) || 0;

    // 1. Tentar encontrar por código exato
    let correspondente = porCodigoBanco.get(l.codigo);

    // 2. Se não encontrou por código, tentar por proximidade (< 10 metros)
    // apenas em vértices do banco que não possuem código ou cujo código não pertence ao SIGEF
    if (!correspondente) {
      const codigosSigef = new Set(sigefLinhas.map((s) => s.codigo));
      for (const vb of vertBanco) {
        if (vb.e !== null && vb.n !== null) {
          if (vb.codigo && codigosSigef.has(vb.codigo)) continue;
          const dist = Math.hypot(vb.e - e, vb.n - n);
          if (dist < 10) {
            correspondente = vb;
            break;
          }
        }
      }
    }

    if (correspondente) {
      // Ponto existente na nossa planilha: atualiza com as coordenadas oficiais do
      // SIGEF, PRESERVANDO a confrontação — o PDF traz geometria, não confrontantes,
      // e descartá-la aqui apagava o trabalho do usuário a cada geração de planta.
      const temConfrontacao = !!(correspondente.descritivo !== null && correspondente.descritivo !== undefined)
        || !!correspondente.apelido_txt;
      return {
        servico_id: servicoId,
        ordem: idx,
        num_txt: correspondente.num_txt,
        rotulo_txt: correspondente.rotulo_txt,
        codigo: l.codigo,
        e,
        n,
        h,
        sigma_pos: Number(correspondente.sigma_pos) || 0.05,
        sigma_h: Number(correspondente.sigma_h) || 0.08,
        // um vértice que carrega confrontação é M por definição, mesmo que o código
        // do SIGEF diga outra coisa — senão o trecho desaparecia do desenho
        tipo: temConfrontacao ? "M" : tipoDoCodigo(l.codigo),
        metodo: correspondente.metodo || "PG6",
        inserido_manual: correspondente.inserido_manual,
        lat_gms: l.lat,
        lon_gms: l.lon,
        descritivo: correspondente.descritivo ?? null,
        tipo_limite: correspondente.tipo_limite ?? null,
        eh_via: !!correspondente.eh_via,
        cns: correspondente.cns ?? null,
        matricula: correspondente.matricula ?? null,
        apelido_txt: correspondente.apelido_txt ?? null,
      };
    } else {
      // Ponto novo / sobreposto de outro profissional vindo do SIGEF
      return {
        servico_id: servicoId,
        ordem: idx,
        num_txt: null,
        rotulo_txt: l.confrontacao || null,
        codigo: l.codigo,
        e,
        n,
        h,
        sigma_pos: 0.1,
        sigma_h: 0.1,
        tipo: tipoDoCodigo(l.codigo),
        metodo: "PG6",
        inserido_manual: false,
        lat_gms: l.lat,
        lon_gms: l.lon,
        // ponto de terceiro: não é confrontação nossa
        descritivo: null,
        tipo_limite: null,
        eh_via: false,
        cns: null,
        matricula: null,
        apelido_txt: null,
      };
    }
  });

  return resultado;
}
