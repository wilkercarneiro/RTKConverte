// Monografia dos marcos: mais uma peça técnica, gerada em lote — um DOCX com
// uma página por marco (vértice M). A tela escolhe os marcos (todos marcados
// por padrão) e guarda, no próprio serviço (servicos.monografia, 0042), o que
// o sistema não sabe: data do levantamento, equipamento, tipo do marco e, por
// marco, a localização e o acesso. Campo vazio sai no documento como linha
// para completar à mão.
import { useMemo, useState } from "react";
import type { CamposMarco, CamposMonografia } from "../../supabase/functions/_shared/monografia.ts";
import { separarMarcos } from "../../supabase/functions/_shared/monografia.ts";
import { Dica, Rotulo } from "./ui";

export interface ArquivoGerado { titulo: string; url: string }

/** Une as listas de marcos conhecidas, sem repetir, na ordem em que chegaram. */
export function unirMarcos(...listas: (readonly (string | null | undefined)[] | null | undefined)[]): string[] {
  const vistos = new Set<string>();
  for (const l of listas) for (const c of l ?? []) {
    const t = (c ?? "").trim();
    if (t && /(^|-)M-?\d/i.test(t)) vistos.add(t);
  }
  return [...vistos];
}

export function MonografiaMarcos({ marcos: conhecidos, prefixo, deVizinho, campos, onCampos, onGerar, ocupado, arquivo, erro, semPdf, onEnviarPdf }: {
  /** códigos dos marcos conhecidos (vazio = ainda não se sabe: sai com todos) */
  marcos: string[];
  /** prefixo do credenciado do serviço: marco de outro prefixo não entra */
  prefixo?: string | null;
  /** códigos de marcos inseridos de área certificada vizinha: não entram */
  deVizinho?: readonly (string | null | undefined)[];
  campos: CamposMonografia | null | undefined;
  onCampos: (c: CamposMonografia) => void;
  /** `null` = todos os marcos */
  onGerar: (escolhidos: string[] | null) => void;
  ocupado: boolean;
  arquivo?: ArquivoGerado | null;
  erro?: string | null;
  /** o PDF do SIGEF ainda não está na tela (serviço reaberto) */
  semPdf?: boolean;
  onEnviarPdf?: (f: File) => void;
}) {
  const c = campos ?? {};
  const { proprios: marcos, deFora } = useMemo(() => separarMarcos(conhecidos, prefixo, deVizinho), [conhecidos, prefixo, deVizinho]);
  // guarda os DESMARCADOS: marco que aparecer depois já entra marcado
  const [fora, setFora] = useState<Set<string>>(new Set());
  const [aberto, setAberto] = useState<string | null>(null);
  const escolhidos = useMemo(() => marcos.filter((m) => !fora.has(m)), [marcos, fora]);
  const descritos = marcos.filter((m) => c.marcos?.[m]?.localizacao || c.marcos?.[m]?.acesso).length;

  const mudar = (patch: Partial<CamposMonografia>) => onCampos({ ...c, ...patch });
  const mudarMarco = (cod: string, patch: Partial<CamposMarco>) => {
    const atual = { ...(c.marcos?.[cod] ?? {}), ...patch };
    const marcosNovos = { ...(c.marcos ?? {}) };
    if (!atual.localizacao && !atual.acesso) delete marcosNovos[cod];
    else marcosNovos[cod] = atual;
    mudar({ marcos: marcosNovos });
  };
  const alternar = (cod: string, marcado: boolean) => setFora((s) => {
    const n = new Set(s);
    if (marcado) n.delete(cod); else n.add(cod);
    return n;
  });
  const todosMarcados = fora.size === 0 || marcos.every((m) => !fora.has(m));
  const nGerar = marcos.length ? escolhidos.length : null;

  return (
    <section className="bloco" id="bloco-monografia">
      <header>
        <h3>Monografia dos marcos<Dica>
          Uma página por marco (vértice M), num arquivo DOCX só: código, coordenadas SIRGAS 2000
          (latitude, longitude, altitude elipsoidal e UTM), precisão, método de posicionamento,
          amarração com os vértices vizinhos, croqui do marco no perímetro e espaço para a foto.
          Sai no timbre da empresa, como as outras peças. O que ficar vazio aqui sai no documento
          como linha para completar à mão.
        </Dica></h3>
      </header>

      <div className="grade">
        <label><Rotulo dica="como vai escrito na ficha, ex.: 12/08/2026">Data do levantamento</Rotulo>
          <input value={c.data_levantamento ?? ""} placeholder="dd/mm/aaaa"
            onChange={(e) => mudar({ data_levantamento: e.target.value || undefined })} />
        </label>
        <label><Rotulo dica="marca e modelo do receptor GNSS usado no campo">Equipamento / receptor</Rotulo>
          <input value={c.equipamento ?? ""} placeholder="ex.: receptor GNSS RTK"
            onChange={(e) => mudar({ equipamento: e.target.value || undefined })} />
        </label>
        <label><Rotulo dica="vale para todos os marcos, ex.: marco de concreto com chapa">Tipo do marco</Rotulo>
          <input value={c.tipo_marco ?? ""} placeholder="ex.: concreto"
            onChange={(e) => mudar({ tipo_marco: e.target.value || undefined })} />
        </label>
      </div>

      {marcos.length > 0 ? (
        <>
          <div className="acoes-linha" style={{ marginTop: 16 }}>
            <b>{escolhidos.length} de {marcos.length} marcos escolhidos</b>
            <span className="sub">{descritos ? `${descritos} com localização ou acesso descritos` : "nenhum com localização descrita"}</span>
            <span style={{ flex: 1 }} />
            <button type="button" onClick={() => setFora(todosMarcados ? new Set(marcos) : new Set())}>
              {todosMarcados ? "Desmarcar todos" : "Marcar todos"}
            </button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
            {marcos.map((m) => {
              const extra = c.marcos?.[m];
              const temTexto = !!(extra?.localizacao || extra?.acesso);
              return (
                <div key={m} className="trecho" style={{ marginBottom: 0, ["--cor-trecho" as string]: temTexto ? "var(--primaria)" : "var(--borda, #ccc)" }}>
                  <div className="trecho-cabeca">
                    <label className="marcador" title="Sai uma página para este marco">
                      <input type="checkbox" checked={!fora.has(m)} onChange={(e) => alternar(m, e.target.checked)} />
                      <span className="mono" style={{ fontWeight: 700 }}>{m}</span>
                    </label>
                    {temTexto && <span className="chip">descrito</span>}
                    <span style={{ flex: 1 }} />
                    <button type="button" className="fantasma" aria-expanded={aberto === m}
                      onClick={() => setAberto((a) => (a === m ? null : m))}>
                      {aberto === m ? "fechar" : temTexto ? "editar localização e acesso" : "descrever localização e acesso"}
                    </button>
                  </div>
                  {aberto === m && (
                    <div className="grade" style={{ marginTop: 8 }}>
                      <label><Rotulo dica="referência física: cerca, árvore, mourão, distância de algo conhecido">Localização do marco</Rotulo>
                        <textarea rows={3} value={extra?.localizacao ?? ""}
                          onChange={(e) => mudarMarco(m, { localizacao: e.target.value || undefined })} />
                      </label>
                      <label><Rotulo dica="como chegar: estrada, entradas e distâncias desde a sede do município">Itinerário de acesso</Rotulo>
                        <textarea rows={3} value={extra?.acesso ?? ""}
                          onChange={(e) => mudarMarco(m, { acesso: e.target.value || undefined })} />
                      </label>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      ) : deFora.length ? null : (
        <p className="sub" style={{ margin: "14px 0 0" }}>
          A lista dos marcos aparece depois de ler o PDF do SIGEF ou de gerar as peças.
          Gerando agora, sai uma página para cada marco do perímetro.
        </p>
      )}
      {deFora.length > 0 && (
        <p className="sub" style={{ margin: "10px 0 0" }}>
          {deFora.length === 1 ? "1 marco do perímetro não entra" : `${deFora.length} marcos do perímetro não entram`}: são de
          área certificada vizinha ou de outro credenciado{prefixo ? ` (o deste serviço é ${prefixo})` : ""} —{" "}
          <span className="mono">{deFora.slice(0, 8).join(", ")}{deFora.length > 8 ? " …" : ""}</span>.
        </p>
      )}

      <div className="acoes-linha" style={{ marginTop: 14 }}>
        <button className="principal" disabled={ocupado || nGerar === 0}
          onClick={() => onGerar(marcos.length && !todosMarcados ? escolhidos : null)}>
          {ocupado ? "Gerando a monografia…"
            : nGerar === null ? "Gerar monografia de todos os marcos"
              : `Gerar monografia (${nGerar} ${nGerar === 1 ? "marco" : "marcos"})`}
        </button>
        {semPdf && onEnviarPdf && (
          <label className="link" style={{ cursor: "pointer", color: "var(--primaria)", fontWeight: 500, fontSize: 13.5 }}>
            enviar o PDF do SIGEF e gerar
            <input type="file" accept=".pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onEnviarPdf(f); e.target.value = ""; }} />
          </label>
        )}
        {arquivo && (
          <a className="botao-download" href={arquivo.url} target="_blank" rel="noreferrer">
            <span className="ext">DOCX</span> {arquivo.titulo}
          </a>
        )}
      </div>
      {erro && <div className="erro">{erro}</div>}
    </section>
  );
}
