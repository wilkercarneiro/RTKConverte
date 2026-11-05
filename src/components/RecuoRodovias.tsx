// Cartão "Rodovias e recuo legal": cada estrada/rodovia que o imóvel confronta,
// com o recuo da lei (src/lib/recuo.ts) e, nas BRs, o que o DNIT publica
// (src/lib/dnit.ts). Pedido do Wilker (05/11/2026): recuo automático pela lei
// ou manual de BA e BR.
//
// O sistema aplica sozinho o padrão (BR 40 m, BA 30 m, não edificável 15 m),
// mas a largura do padrão NÃO é lei: o cartão diz a origem de cada número e o
// operador confirma (ou troca) antes de a nota ir para a planta. Nas BRs, a
// consulta ao DNIT traz a largura oficial do trecho (Termo de Reconhecimento)
// quando existe e acusa se o perímetro ENTRA na faixa de domínio.
import { useEffect, useMemo, useState } from "react";
import { classificarVia, nomeDaVia, recuoDaVia, regraDaVia, resumoRecuo, type AjusteRecuo, type Via } from "../lib/recuo";
import { lerHectares } from "../lib/desmembramento";
import { consultarDnit, type ResultadoDnit } from "../lib/dnit";
import { Dica } from "./ui";

export interface AjusteVia extends AjusteRecuo {
  /** o operador conferiu a largura (sem isso a nota da planta não leva o número do padrão) */
  confirmado?: boolean;
}
export type AjustesRecuo = Record<string, AjusteVia>;

/** As vias distintas entre os confrontantes (a chave é a sigla ou o tipo). */
export function viasDosConfrontantes(rotulos: (string | null | undefined)[]): { chave: string; rotulo: string; via: Via }[] {
  const vistas = new Map<string, { chave: string; rotulo: string; via: Via }>();
  for (const r of rotulos) {
    const via = classificarVia(r);
    if (!via) continue;
    const chave = via.sigla ?? via.tipo;
    if (!vistas.has(chave)) vistas.set(chave, { chave, rotulo: String(r ?? "").split("\\")[0].trim(), via });
  }
  return [...vistas.values()];
}

const fmtM = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
// "7,5", "7.5" e "1.234,5" (o mesmo leitor das áreas): antes "7.5" virava 75 m
const lerNum = (s: string): number | null => {
  const v = lerHectares(s.replace(/m$/i, ""));
  return Number.isFinite(v) && v >= 0 ? v : null;
};

export function RecuoRodovias({ rotulos, aneisLonLat, uf, ajustes, onAjustes, rural = true, eixo = false, planta, onPlanta }: {
  /** descritivos/nomes dos confrontantes do perímetro */
  rotulos: (string | null | undefined)[];
  /** o imóvel em lon/lat (para o DNIT); vazio = sem consulta */
  aneisLonLat: [number, number][][];
  uf: string | null | undefined;
  ajustes: AjustesRecuo;
  onAjustes: (a: AjustesRecuo) => void;
  /** georreferenciamento rural: a não edificável é só informativa */
  rural?: boolean;
  /** mostra "a divisa passa no eixo" (loteamento: a faixa sai da gleba) */
  eixo?: boolean;
  /** a faixa não edificável sai na planta (ausente = a chave não aparece) */
  planta?: boolean;
  onPlanta?: (v: boolean) => void;
}) {
  const vias = useMemo(() => viasDosConfrontantes(rotulos), [rotulos.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps
  const temBr = vias.some((v) => v.via.tipo === "federal");
  const [dnit, setDnit] = useState<{ estado: "carregando" | "ok" | "falhou"; r?: ResultadoDnit } | null>(null);
  const chaveAneis = aneisLonLat.map((a) => a.length + ":" + (a[0]?.join(",") ?? "")).join("|");
  useEffect(() => {
    if (!temBr || !aneisLonLat.some((a) => a.length >= 3)) { setDnit(null); return; }
    let vivo = true;
    setDnit({ estado: "carregando" });
    consultarDnit(aneisLonLat, uf ?? null)
      .then((r) => { if (vivo) setDnit({ estado: "ok", r }); })
      .catch(() => { if (vivo) setDnit({ estado: "falhou" }); });
    return () => { vivo = false; };
  }, [temBr, chaveAneis, uf]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!vias.length) return null;
  const mudar = (chave: string, patch: Partial<AjusteVia>) => {
    const atual = ajustes[chave] ?? {};
    // trocar um número desfaz a confirmação: o operador confere de novo
    const confirmado = "confirmado" in patch ? patch.confirmado : (patch.dominio !== undefined || patch.naoEdificavel !== undefined ? false : atual.confirmado);
    onAjustes({ ...ajustes, [chave]: { ...atual, ...patch, confirmado } });
  };

  return (
    <section className="bloco recuo-vias" id="bloco-recuo">
      <header>
        <h3>Rodovias e recuo legal<Dica>
          Faixa de domínio: a largura é da rodovia (BR: DNIT, por trecho; BA: SEINFRA/SIT, "em geral" 30 m de cada lado do eixo).
          O sistema aplica o padrão e diz de onde veio — confirme com o órgão quando não for documento oficial.
          Faixa não edificável: 15 m a partir do limite da faixa de domínio (Lei 6.766/1979, art. 4º, III); lei municipal pode reduzir até 5 m.
          {rural && " Em imóvel rural ela é informativa: aparece na planta, sem mudar área nem perímetro."}
        </Dica></h3>
        <span className="desc">{vias.length === 1 ? "1 via no perímetro" : `${vias.length} vias no perímetro`}</span>
        {onPlanta && vias.some((v) => v.via.tipo !== "municipal") && (
          <label className="recuo-eixo recuo-planta">
            <input type="checkbox" checked={planta !== false} onChange={(e) => onPlanta(e.target.checked)} />
            Faixa não edificável na planta
          </label>
        )}
      </header>
      <div className="recuo-lista">
        {vias.map(({ chave, rotulo, via }) => {
          const aj = ajustes[chave] ?? {};
          const r = recuoDaVia(via, aj);
          const reg = regraDaVia(via);
          const dn = via.tipo === "federal" && dnit?.r ? {
            faixas: dnit.r.faixas.filter((f) => !via.sigla || f.br === via.sigla),
            invasoes: dnit.r.invasoes.filter((i) => !via.sigla || i.br === via.sigla),
            eixo: dnit.r.eixos.find((e) => !via.sigla || e.br === via.sigla),
          } : null;
          const oficial = dn?.faixas.find((f) => f.origem === "reconhecida") ?? dn?.faixas[0];
          const larguras = oficial ? [...new Set([oficial.ladoEsquerdo, oficial.ladoDireito].filter((x): x is number => x !== null))] : [];
          return (
            <article key={chave} className={`recuo-via ${via.tipo}`}>
              <div className="recuo-cabeca">
                <span className={`recuo-selo ${via.tipo}`}>{via.sigla ?? nomeDaVia(via)}</span>
                <span className="recuo-nome">{rotulo}</span>
                <span className="esticar" />
                {r.dominio !== null && (aj.confirmado
                  ? <span className="recuo-ok">largura conferida ✓</span>
                  : <button type="button" className="fantasma" onClick={() => mudar(chave, { confirmado: true })}
                      title="Marca a largura como conferida com o órgão: a nota da planta passa a levar o número">Confirmar {fmtM(r.dominio)} m</button>)}
              </div>
              <p className="recuo-resumo">{resumoRecuo(r)}</p>
              <div className="grade-3 recuo-campos">
                <label><span>Faixa de domínio (m de cada lado)</span>
                  <input inputMode="decimal" className="mono" placeholder={reg.dominio !== null ? `${reg.dominio} (padrão)` : "sem regra"}
                    defaultValue={aj.dominio ?? ""} key={`d${aj.dominio ?? ""}`}
                    onBlur={(e) => mudar(chave, { dominio: lerNum(e.target.value) })} />
                </label>
                <label><span>Não edificável (m)</span>
                  <input inputMode="decimal" className="mono" placeholder={`${reg.naoEdificavel}`}
                    defaultValue={aj.naoEdificavel ?? ""} key={`n${aj.naoEdificavel ?? ""}`}
                    onBlur={(e) => mudar(chave, { naoEdificavel: lerNum(e.target.value) })} />
                </label>
                <label><span>{via.tipo === "municipal" ? "Lei municipal da estrada" : "Lei municipal (para reduzir)"}</span>
                  <input placeholder="ex.: Lei 1.234/2020" defaultValue={aj.leiMunicipal ?? ""} key={`l${aj.leiMunicipal ?? ""}`}
                    disabled={!reg.reduzivel && via.tipo !== "municipal"}
                    onBlur={(e) => mudar(chave, { leiMunicipal: e.target.value.trim() || null })} />
                </label>
              </div>
              {eixo && r.dominio !== null && (
                <label className="recuo-eixo">
                  <input type="checkbox" checked={!!aj.divisaNoEixo} onChange={(e) => mudar(chave, { divisaNoEixo: e.target.checked })} />
                  A divisa levantada passa no eixo da via (a faixa de domínio sai da área)
                </label>
              )}
              {r.avisos.map((a) => <p key={a} className="recuo-aviso">{a}</p>)}
              {via.tipo === "federal" && (
                <div className="recuo-dnit">
                  {dnit?.estado === "carregando" && <span className="sub"><span className="spinner" /> consultando o DNIT…</span>}
                  {dnit?.estado === "falhou" && <span className="sub">O DNIT não respondeu agora: vale o padrão. Tente de novo mais tarde.</span>}
                  {dn && (
                    <>
                      {dn.invasoes.map((i) => (
                        <p key={i.documento} className="recuo-alerta">
                          O perímetro entra <b>{fmtM(i.areaM2)} m²</b> na faixa de domínio da {i.br} ({i.origem === "reconhecida" ? "Termo de Reconhecimento" : "faixa documentada, base de teste do DNIT"}).
                          A faixa é bem público: confira a divisa nesse trecho.
                        </p>
                      ))}
                      {oficial ? (
                        <p className="sub">
                          DNIT · {oficial.origem === "reconhecida" ? "faixa reconhecida" : "faixa documentada (base de teste)"}: {larguras.length
                            ? `${larguras.map(fmtM).join(" / ")} m por lado`
                            : "largura variável"}{oficial.documento ? ` — ${oficial.documento}` : ""}.
                          {larguras.map((l) => (
                            <button key={l} type="button" className="link" onClick={() => mudar(chave, { dominio: l, confirmado: oficial.origem === "reconhecida" })}>
                              usar {fmtM(l)} m
                            </button>
                          ))}
                        </p>
                      ) : dnit?.estado === "ok" && (
                        <p className="sub">DNIT: nenhum trecho com largura publicada perto deste imóvel{dn.eixo ? ` (eixo da ${dn.eixo.br} a ${fmtM(dn.eixo.distanciaM)} m do perímetro)` : ""}. Peça a largura à Superintendência do DNIT ou à concessionária.</p>
                      )}
                    </>
                  )}
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
