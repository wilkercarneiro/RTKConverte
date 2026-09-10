// Mapa interativo + verificação de sobreposição com as parcelas certificadas
// da base local (SIGEF). Usado em dois lugares:
//   - Conferência (modo "sobreposicao"): o imóvel levantado é cruzado com a
//     base; cada interseção sai listada e pintada de vermelho no mapa.
//   - Área certificada (modo "vizinhanca"): ainda não há TXT; o mapa mostra os
//     CSVs do vizinho sobre o satélite e as parcelas da base ao redor.
// A consulta é refeita (com atraso) sempre que o polígono muda.
import { useEffect, useMemo, useState } from "react";
import { MapaInterativo } from "./MapaInterativo";
import type { PontoMapa } from "./MapaInterativo";
import { coberturaSigef, consultarSigef, fmtArea } from "../lib/sigef";
import type { LonLat, ResultadoSigef } from "../lib/sigef";

interface Props {
  modo: "sobreposicao" | "vizinhanca";
  /** anéis lon/lat do imóvel (modo sobreposição) */
  aneis?: LonLat[][];
  pontos?: PontoMapa[];
  /** parcelas do vizinho (CSV) — desenhadas em destaque e usadas como área de busca no modo vizinhança */
  destaques?: { codigo: string; nome: string; anel: LonLat[] }[];
  /** códigos a não tratar como sobreposição (ex.: a própria parcela do CSV) */
  ignorar?: string[];
  uf?: string | null;
  altura?: number | string;
}

const chaveDe = (aneis: LonLat[][]) => JSON.stringify(aneis.map((a) => a.map((p) => [Math.round(p[0] * 1e7), Math.round(p[1] * 1e7)])));

export function PainelSigef({ modo, aneis, pontos, destaques, ignorar, uf, altura }: Props) {
  const busca = useMemo<LonLat[][]>(
    () => (modo === "sobreposicao" ? (aneis ?? []) : (destaques ?? []).map((d) => d.anel)),
    [modo, aneis, destaques],
  );
  const chave = useMemo(() => chaveDe(busca), [busca]);
  const chaveIgnorar = (ignorar ?? []).join("|");
  const [resultado, setResultado] = useState<ResultadoSigef | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [foco, setFoco] = useState<string | null>(null);
  const [cobertura, setCobertura] = useState<Record<string, number> | null>(null);
  const [versao, setVersao] = useState(0);

  useEffect(() => {
    coberturaSigef().then(setCobertura).catch(() => setCobertura({}));
  }, [versao]);

  useEffect(() => {
    if (!busca.length) { setResultado(null); return; }
    let vivo = true;
    setCarregando(true);
    const t = setTimeout(async () => {
      try {
        const r = await consultarSigef(busca, { raioM: modo === "sobreposicao" ? 300 : 800, ignorar: ignorar ?? [] });
        if (!vivo) return;
        setResultado(r); setErro(null);
        if (!r.sobreposicoes.some((s) => s.codigo === foco)) setFoco(null);
      } catch (e) {
        if (vivo) setErro(e instanceof Error ? e.message : String(e));
      } finally {
        if (vivo) setCarregando(false);
      }
    }, 600);
    return () => { vivo = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave, chaveIgnorar, modo, versao]);

  const sobre = resultado?.sobreposicoes ?? [];
  const nParcelas = resultado?.parcelas.features.length ?? 0;
  const totalBase = cobertura ? Object.values(cobertura).reduce((s, n) => s + n, 0) : null;
  const naUf = uf && cobertura ? (cobertura[uf.toUpperCase()] ?? 0) : null;
  const areaImovel = resultado?.area_imovel_m2 ?? 0;
  const somaSobre = sobre.reduce((s, x) => s + x.area_m2, 0);

  const classe = modo === "sobreposicao" && resultado ? (sobre.length ? "perigo" : "ok") : "";

  return (
    <div className="mapa-cert">
      <MapaInterativo aneis={aneis ?? []} pontos={pontos} parcelas={resultado?.parcelas.features} sobreposicoes={sobre}
        destaques={destaques} foco={foco} altura={altura} />
      <div className={`sobreposicao-painel ${classe}`}>
        <header>
          {modo === "sobreposicao"
            ? (carregando && !resultado ? "Verificando sobreposição com parcelas certificadas…"
              : !resultado ? "Sobreposição com parcelas certificadas (SIGEF)"
              : sobre.length ? `⚠ ${sobre.length} sobreposição(ões) com parcela certificada` : "✓ Sem sobreposição com as parcelas certificadas da base")
            : "Parcelas certificadas ao redor (base local do SIGEF)"}
          <span className="esticar" />
          {carregando && resultado && <span className="sub">atualizando…</span>}
          <button type="button" className="fantasma" style={{ padding: 0, fontSize: 12.5 }} onClick={() => setVersao((v) => v + 1)} disabled={carregando}>
            verificar de novo
          </button>
        </header>
        {erro && <div className="erro">{erro}</div>}
        {modo === "sobreposicao" && sobre.length > 0 && (
          <>
            <p className="sub">
              Área do imóvel dentro de parcela já certificada: <b>{fmtArea(somaSobre)}</b>
              {areaImovel > 0 && <> ({(100 * somaSobre / areaImovel).toFixed(2).replace(".", ",")}% do imóvel)</>}.
              Clique numa parcela para enquadrar no mapa. Use a correção de sobreposição (etapa Confrontantes) ou ajuste os vértices.
            </p>
            <ul className="sobreposicao-lista">
              {sobre.map((s) => (
                <li key={s.codigo} className={foco === s.codigo ? "ativo" : ""} onClick={() => setFoco(foco === s.codigo ? null : s.codigo)}>
                  <span>
                    <b>{s.nome ?? "Parcela certificada"}</b>{s.municipio ? ` · ${s.municipio}${s.uf ? "/" + s.uf : ""}` : ""}
                    <br /><span className="cod">{s.codigo}{s.area_ha != null ? ` · ${String(s.area_ha).replace(".", ",")} ha` : ""}{s.situacao ? ` · ${s.situacao}` : ""}</span>
                  </span>
                  <span>
                    <span className="area">{fmtArea(s.area_m2)}</span>
                    <br /><span className="pct">{s.percentual_imovel.toFixed(2).replace(".", ",")}% do imóvel</span>
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
        {resultado && (
          <p className="sub">
            {nParcelas} parcela(s) certificada(s) num raio de {modo === "sobreposicao" ? 300 : 800} m na base local
            {totalBase !== null && <> · base com {totalBase} parcela(s){uf ? `, ${naUf ?? 0} em ${uf.toUpperCase()}` : ""}</>}.
            {(naUf === 0 || totalBase === 0) && (
              <> <b>A base ainda não cobre esta região</b>: importe o shapefile do SIGEF da UF (<span className="mono">node scripts/importar-sigef.mjs</span>) —
              enquanto isso, só os CSVs enviados na etapa de área certificada entram na verificação.</>
            )}
          </p>
        )}
      </div>
    </div>
  );
}
