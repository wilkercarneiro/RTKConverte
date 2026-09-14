// Mapa interativo + verificação de sobreposição com as parcelas certificadas
// da base local (SIGEF). Usado em dois lugares:
//   - Conferência (modo "sobreposicao"): o imóvel levantado é cruzado com a
//     base; cada interseção sai listada e pintada de vermelho no mapa.
//   - Área certificada (modo "vizinhanca"): ainda não há TXT; o mapa mostra os
//     CSVs do vizinho sobre o satélite e as parcelas da base ao redor.
// A consulta é refeita (com atraso) sempre que o polígono muda. Antes dela, as
// parcelas ao redor são trazidas do INCRA na hora (consultar-sigef); se o INCRA
// não responder, vale a cópia da base local — e a tela diz isso.
import { useEffect, useMemo, useRef, useState } from "react";
import { MapaInterativo } from "./MapaInterativo";
import type { PontoMapa } from "./MapaInterativo";
import { coberturaSigef, consultarSigef, fmtArea, sincronizarSigef } from "../lib/sigef";
import type { LonLat, ResultadoSigef } from "../lib/sigef";

/** Resultado da consulta ao INCRA: "ok" = base atualizada agora; "falhou" = só a cópia local; "sem-uf" = não dá para consultar. */
type Online = { estado: "ok" | "falhou" | "sem-uf"; detalhe?: string } | null;

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
  const [online, setOnline] = useState<Online>(null);
  // "verificar de novo" consulta o INCRA mesmo com a caixa já sincronizada há pouco
  const forcarRef = useRef(false);
  const raio = modo === "sobreposicao" ? 300 : 800;

  useEffect(() => {
    if (!busca.length) { setResultado(null); return; }
    let vivo = true;
    setCarregando(true);
    const t = setTimeout(async () => {
      try {
        if (uf) {
          try {
            const forcar = forcarRef.current;
            forcarRef.current = false;
            const s = await sincronizarSigef(busca, uf, forcar);
            if (vivo) setOnline(s.ok ? { estado: "ok", detalhe: s.avisos.join(" · ") || undefined } : { estado: "falhou", detalhe: s.avisos.join(" · ") });
          } catch (e) {
            if (vivo) setOnline({ estado: "falhou", detalhe: e instanceof Error ? e.message : String(e) });
          }
        } else if (vivo) {
          setOnline({ estado: "sem-uf" });
        }
        if (!vivo) return;
        coberturaSigef().then((c) => vivo && setCobertura(c)).catch(() => vivo && setCobertura({}));
        const r = await consultarSigef(busca, { raioM: raio, ignorar: ignorar ?? [] });
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
  }, [chave, chaveIgnorar, modo, versao, uf]);

  const todas = resultado?.sobreposicoes ?? [];
  // a própria parcela (serviço já certificado) não é conflito: sai à parte e não pinta de vermelho
  const sobre = todas.filter((s) => !s.mesma_parcela);
  const proprias = todas.filter((s) => s.mesma_parcela);
  const encostos = resultado?.encostos ?? [];
  const nParcelas = resultado?.parcelas.features.length ?? 0;
  const totalBase = cobertura ? Object.values(cobertura).reduce((s, n) => s + n, 0) : null;
  const naUf = uf && cobertura ? (cobertura[uf.toUpperCase()] ?? 0) : null;
  const areaImovel = resultado?.area_imovel_m2 ?? 0;
  const somaSobre = sobre.reduce((s, x) => s + x.area_m2, 0);
  const tolerancia = String(resultado?.largura_min_m ?? 0.5).replace(".", ",");
  // "sem sobreposição" só vale se o INCRA respondeu agora ou a base local tem parcelas por perto
  const naoVerificado = modo === "sobreposicao" && resultado && !sobre.length && online?.estado !== "ok" && nParcelas === 0;

  const classe = modo === "sobreposicao" && resultado ? (sobre.length ? "perigo" : naoVerificado ? "aviso" : "ok") : "";
  const titulo = modo === "sobreposicao"
    ? (carregando && !resultado ? "Consultando o SIGEF (INCRA) e verificando sobreposição…"
      : !resultado ? "Sobreposição com parcelas certificadas (SIGEF)"
      : sobre.length ? `⚠ ${sobre.length} sobreposição(ões) com parcela certificada`
      : naoVerificado ? "Sobreposição NÃO verificada: sem dados do SIGEF para esta região"
      : proprias.length ? `✓ Imóvel já certificado no SIGEF, sem sobreposição com outras parcelas${online?.estado === "ok" ? "" : " (base local)"}`
      : online?.estado === "ok" ? "✓ Sem sobreposição com parcelas certificadas (SIGEF consultado agora)"
      : "✓ Sem sobreposição com as parcelas da base local (SIGEF não consultado agora)")
    : "Parcelas certificadas ao redor (SIGEF)";

  return (
    <div className="mapa-cert">
      <MapaInterativo aneis={aneis ?? []} pontos={pontos} parcelas={resultado?.parcelas.features} sobreposicoes={sobre}
        destaques={destaques} foco={foco} altura={altura} />
      <div className={`sobreposicao-painel ${classe}`}>
        <header>
          {titulo}
          <span className="esticar" />
          {carregando && resultado && <span className="sub">atualizando…</span>}
          <button type="button" className="fantasma" style={{ padding: 0, fontSize: 12.5 }} onClick={() => { forcarRef.current = true; setVersao((v) => v + 1); }} disabled={carregando}>
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
        {modo === "sobreposicao" && proprias.length > 0 && (
          <p className="sub">
            <b>Já certificado:</b> {proprias.length === 1 ? "o contorno coincide" : `${proprias.length} partes coincidem`} com parcela certificada
            ({proprias.map((s) => `${s.codigo}${s.situacao ? ` · ${s.situacao}` : ""}, ${(s.percentual_parcela ?? 100).toFixed(2).replace(".", ",")}% da parcela`).join("; ")}) —
            é o próprio imóvel, não conta como sobreposição.
          </p>
        )}
        {modo === "sobreposicao" && encostos.length > 0 && (
          <p className="sub">
            {encostos.length} confrontante(s) certificado(s) só encosta(m) na divisa — faixa com menos de {tolerancia} m de largura, desprezada
            ({encostos.map((e) => `${e.codigo.slice(0, 8)}…: ${fmtArea(e.area_m2)}, até ${e.largura_max_m.toFixed(2).replace(".", ",")} m`).join("; ")}).
          </p>
        )}
        {resultado && (
          <p className="sub">
            {nParcelas} parcela(s) certificada(s) num raio de {raio} m
            {online?.estado === "ok" && <> · <b>SIGEF consultado agora</b>{online.detalhe ? ` (${online.detalhe})` : ""}</>}
            {online?.estado === "falhou" && <> · <b>o INCRA não respondeu</b>, valendo a cópia da base local{online.detalhe ? ` (${online.detalhe})` : ""}</>}
            {online?.estado === "sem-uf" && <> · <b>informe a UF</b> para consultar o SIGEF na hora</>}
            {totalBase !== null && <> · base local com {totalBase} parcela(s){uf ? `, ${naUf ?? 0} em ${uf.toUpperCase()}` : ""}</>}.
          </p>
        )}
      </div>
    </div>
  );
}
