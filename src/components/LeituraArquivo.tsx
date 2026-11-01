// Etapa "Leitura do arquivo": mostra COMO o arquivo foi lido (formato, origem
// da leitura — formato da equipe, perfil aprendido, regras ou IA), o desenho do
// perímetro, a tabela do arquivo com o papel de cada coluna e os avisos. O
// operador pode trocar o papel de uma coluna, o separador, a ordem, excluir um
// ponto e declarar a precisão; cada mudança relê o arquivo NA HORA com o mesmo
// código do servidor (supabase/functions/_shared/leitor). Avisos importantes
// pedem um clique de "conferi" — nada segue calado. O parse-txt reexecuta a
// receita confirmada sobre o arquivo antes de criar o serviço.
import { useMemo, useState } from "react";
import proj4lib from "proj4";
import type { Proj4 } from "../../supabase/functions/_shared/geo.ts";
import { executarReceita } from "../../supabase/functions/_shared/leitor/index.ts";
import type { Leitura, Receita } from "../../supabase/functions/_shared/leitor/index.ts";
import { APOIO_PADRAO, camposVazios, PAPEIS } from "../../supabase/functions/_shared/leitor/receita.ts";
import type { Papel } from "../../supabase/functions/_shared/leitor/receita.ts";
import { dividirDelimitado, dividirEspacos } from "../../supabase/functions/_shared/leitor/executor.ts";
import { cruzamentos } from "../../supabase/functions/_shared/leitor/ordem.ts";
import { VERSAO_TODAS } from "../../supabase/functions/_shared/leitor/versoes.ts";
import { Dica } from "./ui";
import "./leitura.css";

const proj4: Proj4 = (de, para, c) => (proj4lib as unknown as Proj4)(de, para, c);

export interface RespostaLeitura {
  ok: boolean;
  formato: string;
  codificacao: string;
  linhas: string[];
  receita: Receita | null;
  confianca: "alta" | "media" | "baixa";
  duvidas: string[];
  perfil: { id: string; nome: string | null } | null;
  ia: { usada: boolean; tentativas: { modelo: string; aprovada: boolean; ms: number; custoUsd: number | null }[]; custoUsd: number; erro: string | null; motivo: string | null };
  binario?: { formato: string; orientacao: string };
}

export interface LeituraConfirmada {
  receita: Receita;
  ordem: "auto" | "id" | "arquivo";
  excluir: number[];
  sigma_padrao: { pos: number; h: number } | null;
  confirmados: string[];
  /** Versão dos pontos que entra no perímetro ("" = levantamento, "postp_"…);
   *  null quando o arquivo tem uma versão só. */
  versao: string | null;
}

const NOME_PAPEL: Record<Papel, string> = {
  nome: "Ponto (nome)", codigo: "Código / descrição", e: "E (este)", n: "N (norte)", h: "Altitude",
  lat: "Latitude", lon: "Longitude", sigma_pos: "σ horizontal", sigma_h: "σ vertical", sigma_n: "σ norte", sigma_e: "σ este",
};
const SEPARADORES: { valor: string; rotulo: string }[] = [
  { valor: ";", rotulo: "ponto e vírgula ( ; )" }, { valor: ",", rotulo: "vírgula ( , )" }, { valor: "\t", rotulo: "tabulação" },
  { valor: "|", rotulo: "barra ( | )" }, { valor: ":", rotulo: "dois-pontos ( : )" }, { valor: "espacos", rotulo: "espaços" },
];

/** Receita de partida quando nada foi reconhecido: o operador mapeia as colunas. */
export function receitaManual(linhas: string[]): Receita {
  const amostra = linhas.filter((l) => l.trim()).slice(0, 50);
  const conta = (d: string) => amostra.reduce((s, l) => s + (l.split(d).length - 1), 0);
  const d = [";", "\t", ",", "|"].sort((a, b) => conta(b) - conta(a))[0];
  const usaD = conta(d) >= amostra.length;
  return {
    versao: 1, registro: "linha", pular_inicio: 0, ignorar: [], tokenizacao: usaD ? "delimitado" : "espacos", delimitador: usaD ? d : null,
    colunas: null, excedente_em: null, cortes: null, regex: null, decimal: amostra.some((l) => /\d,\d/.test(l)) && d !== "," ? "," : ".",
    campos: camposVazios(), sistema: "utm", fuso: null, hemisferio: "S", unidade_sigma: "m", confianca_sigma: "1sigma",
    nome_formato: "texto", ordem: "auto", apoio: [...APOIO_PADRAO], origem: "operador",
    explicacao: "Formato não reconhecido automaticamente: indique na tabela o papel de cada coluna.",
  };
}

const ORIGEM: (r: Receita, perfil: RespostaLeitura["perfil"]) => { selo: string; texto: string } = (r, perfil) => {
  if (r.origem === "padrao") return { selo: "Formato da equipe", texto: "Arquivo no formato de sempre das coletoras da equipe." };
  if (r.origem.startsWith("perfil:")) return { selo: "Formato já conhecido", texto: `Reconhecido pelo perfil “${perfil?.nome ?? "aprendido"}”, salvo da primeira vez que este formato chegou.` };
  if (r.origem.startsWith("ia:")) return { selo: "Interpretado pela IA", texto: "Formato novo: a IA descreveu como ler o arquivo e o sistema conferiu cada número no texto original." };
  if (r.origem === "operador") return { selo: "Ajustado por você", texto: "Leitura com os ajustes feitos nesta tela." };
  return { selo: "Reconhecido automaticamente", texto: "Estrutura reconhecida pelas regras do sistema." };
};

export function LeituraArquivo({ nomeArquivo, resposta, criando, erro, onConfirmar, onTrocarArquivo }: {
  nomeArquivo: string;
  resposta: RespostaLeitura;
  criando: boolean;
  erro: string | null;
  onConfirmar: (l: LeituraConfirmada) => void;
  onTrocarArquivo: () => void;
}) {
  const linhas = resposta.linhas;
  const [receita, setReceita] = useState<Receita>(() => resposta.receita ?? receitaManual(linhas));
  const [ordem, setOrdem] = useState<"auto" | "id" | "arquivo">("auto");
  const [excluir, setExcluir] = useState<Set<number>>(new Set());
  // versão dos pontos (levantamento × "postp_"…): null = a automática, a mais completa
  const [versao, setVersao] = useState<string | null>(null);
  const [sigmaTexto, setSigmaTexto] = useState({ pos: "", h: "" });
  const [confirmados, setConfirmados] = useState<Set<string>>(new Set());
  const [verTodas, setVerTodas] = useState(false);
  // a tabela já vem aberta quando a leitura pede conferência (IA, dúvida, nada reconhecido)
  const [ajustar, setAjustar] = useState(resposta.receita === null || resposta.confianca !== "alta" || !!resposta.receita?.origem.startsWith("ia:"));

  const sigmaPadrao = useMemo(() => {
    const pos = Number(sigmaTexto.pos.replace(",", ".")), h = Number(sigmaTexto.h.replace(",", "."));
    return pos > 0 && h > 0 && pos <= 10 && h <= 10 ? { pos, h } : null;
  }, [sigmaTexto]);

  const leitura: Leitura | null = useMemo(() => {
    try { return executarReceita(linhas, receita, { proj4, ordem, excluir: [...excluir], sigmaPadrao, versao }, resposta.confianca, resposta.duvidas); }
    catch { return null; }
  }, [linhas, receita, ordem, excluir, sigmaPadrao, versao, resposta.confianca, resposta.duvidas]);
  // a versão que o sistema escolheria sozinho (marcada "sugerida" na lista)
  const versaoSugerida = useMemo(() => {
    if (versao === null) return leitura?.versoes.escolhida ?? null;
    try { return executarReceita(linhas, receita, { proj4, ordem, excluir: [...excluir], sigmaPadrao }).versoes.escolhida; }
    catch { return null; }
  }, [versao, leitura, linhas, receita, ordem, excluir, sigmaPadrao]);

  const editar = (mud: Partial<Receita>) => {
    setReceita((r) => ({ ...r, ...mud, origem: "operador" }));
    setConfirmados(new Set());
  };
  const definirPapel = (coluna: number, papel: Papel | "") => {
    const campos = { ...receita.campos };
    for (const p of PAPEIS) if (campos[p] === coluna) campos[p] = null;
    if (papel) campos[papel] = coluna;
    const geo = campos.lat !== null && campos.lon !== null && (campos.e === null || campos.n === null);
    editar({ campos, sistema: geo ? "geografica" : "utm" });
  };
  const alternarExclusao = (linha: number) => {
    setExcluir((s) => { const n = new Set(s); if (n.has(linha)) n.delete(linha); else n.add(linha); return n; });
    setConfirmados(new Set());
  };

  const bloqueios = leitura ? leitura.avisos.filter((a) => a.nivel === "bloqueio") : [];
  const faltaConfirmar = leitura ? leitura.aConfirmar.filter((c) => !confirmados.has(c)) : [];
  const pode = !!leitura && leitura.ok && faltaConfirmar.length === 0 && !criando;
  const semSigma = leitura?.avisos.some((a) => a.codigo === "sem_precisao") || sigmaPadrao !== null || !!leitura?.anel.some((p) => p.sigmaDeclarado);
  const origem = ORIGEM(receita, resposta.perfil);
  const estado = !leitura || bloqueios.length ? "ruim" : leitura.aConfirmar.length ? "atencao" : "bom";
  const tabular = receita.registro === "linha" || receita.registro === "planilha";

  return (
    <div className="leitura-arquivo">
      {/* ---- faixa de resumo ---- */}
      <div className={`lt-faixa lt-${estado}`}>
        <span className="lt-sinal" aria-hidden>{estado === "bom" ? "✓" : estado === "atencao" ? "!" : "✕"}</span>
        <div className="lt-faixa-texto">
          <b>
            {!leitura ? "Não foi possível ler com estas opções"
              : estado === "ruim" ? "Falta resolver antes de criar o serviço"
              : estado === "atencao" ? "Lido — confira os pontos marcados abaixo"
              : "Arquivo lido sem pendências"}
          </b>
          <span className="lt-chips">
            <span className="lt-chip forte">{origem.selo}</span>
            <span className="lt-chip">{nomeArquivo}</span>
            <span className="lt-chip">{resposta.formato}</span>
            {leitura && <span className="lt-chip">{leitura.anel.length} ponto(s) no perímetro</span>}
            {leitura && leitura.blocos.length > 1 && <span className="lt-chip">{leitura.blocos.length} partes</span>}
            {leitura?.fusoGeo && <span className="lt-chip">lat/lon → UTM {leitura.fusoGeo}S</span>}
            {excluir.size > 0 && <span className="lt-chip">{excluir.size} excluído(s)</span>}
          </span>
        </div>
        <button type="button" className="fantasma" onClick={() => setAjustar((v) => !v)}>{ajustar ? "ocultar ajustes" : "ajustar leitura"}</button>
      </div>

      <div className="lt-grade">
        {/* ---- desenho ---- */}
        <section className="lt-mapa" aria-label="Desenho do perímetro lido">
          {leitura && leitura.pontos.length > 0
            ? <MapaLeitura leitura={leitura} excluir={excluir} onAlternar={alternarExclusao} />
            : <div className="lt-vazio">Nenhum ponto lido ainda. Indique as colunas de coordenadas na tabela abaixo.</div>}
          <p className="lt-legenda">
            <span><i className="lt-leg-ponto" /> vértice</span>
            <span><i className="lt-leg-apoio" /> apoio (fora do perímetro)</span>
            <span><i className="lt-leg-excluido" /> excluído</span>
            {leitura && leitura.versoes.versoes.length > 1 && <span><i className="lt-leg-versao" /> outra versão dos pontos</span>}
            <span><i className="lt-leg-cruza" /> lado que cruza</span>
            <span className="sub">clique num ponto para excluí-lo ou trazê-lo de volta</span>
          </p>
        </section>

        <section className="lt-lateral">
          <div className="lt-bloco">
            <h4>Como entendemos<Dica lado="baixo">{origem.texto} Os números são copiados do arquivo, nunca digitados: cada coordenada tem a linha de onde saiu.</Dica></h4>
            <p className="lt-explicacao">
              {receita.origem === "operador"
                ? `Leitura definida por você: ${PAPEIS.filter((p) => receita.campos[p] !== null).sort((a, b) => receita.campos[a]! - receita.campos[b]!).map((p) => `${NOME_PAPEL[p]} na coluna ${receita.campos[p]! + 1}`).join(", ") || "nenhuma coluna indicada ainda"}.`
                : receita.explicacao || "—"}
            </p>
            {resposta.ia.usada && (
              <p className="sub pequeno">
                IA: {resposta.ia.tentativas.map((t) => `${t.modelo} ${t.aprovada ? "✓" : "✕"}`).join(" → ")}
                {resposta.ia.custoUsd > 0 ? ` · US$ ${resposta.ia.custoUsd.toFixed(4)}` : ""}
              </p>
            )}
            {!resposta.ia.usada && resposta.ia.motivo && resposta.confianca !== "alta" && <p className="sub pequeno">IA não usada: {resposta.ia.motivo}.</p>}
            {resposta.duvidas.length > 0 && receita.origem !== "operador" && (
              <ul className="lt-duvidas">{resposta.duvidas.map((d, i) => <li key={i}>{d}</li>)}</ul>
            )}
          </div>

          {leitura && leitura.versoes.versoes.length > 1 && (
            <div className="lt-bloco">
              <h4>Versão dos pontos<Dica>O arquivo traz os mesmos pontos duas vezes: o levantamento (nome começando pelo número, ex.: “3jorge/davino”) e outra solução com um prefixo no nome (ex.: “postp_3jorge/davino”, pós-processado). Só uma versão entra no perímetro, inteira — misturar as duas desenha um polígono errado. A sugerida é a mais completa; empatando, a de melhor precisão.</Dica></h4>
              <div className="lt-opcoes">
                {leitura.versoes.versoes.map((v) => {
                  const sugerida = versaoSugerida === v.chave;
                  return (
                    <label key={v.chave || "levantamento"} className="lt-opcao lt-opcao-versao">
                      <input type="radio" name="versao" checked={leitura.versoes.escolhida === v.chave}
                        onChange={() => { setVersao(v.chave); setConfirmados(new Set()); }} />
                      <span>
                        {v.chave === "" ? "Levantamento" : `“${v.nome}”`} · {v.numeros.length} ponto{v.numeros.length === 1 ? "" : "s"}{sugerida ? " (sugerida)" : ""}
                        <small className="sub">
                          {v.sigmaMediano !== null ? `σ mediano ${v.sigmaMediano < 1 ? `${Math.round(v.sigmaMediano * 100)} cm` : `${v.sigmaMediano.toFixed(2)} m`}` : "sem σ"}
                          {v.faltam.length ? ` · sem ${v.faltam.length > 1 ? "os pontos" : "o ponto"} ${v.faltam.slice(0, 10).join(", ")}${v.faltam.length > 10 ? "…" : ""}` : " · completa"}
                        </small>
                      </span>
                    </label>
                  );
                })}
                <label className="lt-opcao lt-opcao-versao">
                  <input type="radio" name="versao" checked={leitura.versoes.escolhida === VERSAO_TODAS}
                    onChange={() => { setVersao(VERSAO_TODAS); setConfirmados(new Set()); }} />
                  <span>Todos os pontos (não separar)<small className="sub">as versões entram juntas, como pontos diferentes</small></span>
                </label>
              </div>
            </div>
          )}

          {leitura && leitura.candidatos.length > 1 && (
            <div className="lt-bloco">
              <h4>Ordem dos pontos<Dica>A ordem define o desenho do perímetro. “Automática” escolhe a que não cruza; com duas válidas, a de menor perímetro.</Dica></h4>
              <div className="lt-opcoes">
                {(["auto", "id", "arquivo"] as const).map((o) => (
                  <label key={o} className="lt-opcao">
                    <input type="radio" name="ordem" checked={ordem === o} onChange={() => { setOrdem(o); setConfirmados(new Set()); }} />
                    {o === "auto" ? "Automática" : o === "id" ? "Pela numeração" : "Como está no arquivo"}
                    {o !== "auto" && <small className="sub"> {leitura.candidatos.find((c) => c.criterio === o)?.simples ? "sem cruzar" : "cruza"}</small>}
                  </label>
                ))}
              </div>
            </div>
          )}

          {semSigma && (
            <div className="lt-bloco">
              <h4>Precisão dos pontos sem σ<Dica>O SIGEF exige a precisão de cada vértice. Se o arquivo não a traz, informe a precisão do método usado (ex.: 0,05 m e 0,08 m para RTK).</Dica></h4>
              <div className="lt-linha-campos">
                <label>σ horizontal (m)<input className="mono" inputMode="decimal" value={sigmaTexto.pos} onChange={(e) => { setSigmaTexto((s) => ({ ...s, pos: e.target.value })); setConfirmados(new Set()); }} placeholder="0,05" /></label>
                <label>σ vertical (m)<input className="mono" inputMode="decimal" value={sigmaTexto.h} onChange={(e) => { setSigmaTexto((s) => ({ ...s, h: e.target.value })); setConfirmados(new Set()); }} placeholder="0,08" /></label>
              </div>
            </div>
          )}

          {leitura && leitura.avisos.length > 0 && (
            <div className="lt-bloco">
              <h4>Avisos</h4>
              <ul className="lt-avisos">
                {leitura.avisos.map((a, i) => {
                  const confirmar = leitura.aConfirmar.includes(a.codigo);
                  return (
                    <li key={`${a.codigo}-${i}`} className={`lt-aviso lt-${a.nivel}`}>
                      <span>{a.mensagem}{a.linhas?.length ? <small className="sub"> · linha{a.linhas.length > 1 ? "s" : ""} {a.linhas.slice(0, 12).join(", ")}{a.linhas.length > 12 ? "…" : ""}</small> : null}</span>
                      {confirmar && (
                        <label className="lt-conferi">
                          <input type="checkbox" checked={confirmados.has(a.codigo)}
                            onChange={(e) => setConfirmados((s) => { const n = new Set(s); if (e.target.checked) n.add(a.codigo); else n.delete(a.codigo); return n; })} />
                          conferi
                        </label>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </section>
      </div>

      {/* ---- tabela do arquivo ---- */}
      {(ajustar || !leitura?.ok) && (
        <section className="lt-tabela-bloco">
          <h4>O arquivo, linha a linha<Dica>Cada coluna tem um papel. Troque o papel no topo da coluna se a leitura estiver errada — o desenho e os avisos se atualizam na hora. Linhas riscadas não são pontos (o motivo aparece ao passar o mouse).</Dica></h4>
          {tabular && (
            <div className="lt-linha-campos lt-controles">
              <label>Separador
                <select value={receita.tokenizacao === "espacos" ? "espacos" : receita.tokenizacao === "regex" ? "regex" : receita.tokenizacao === "largura_fixa" ? "largura_fixa" : receita.delimitador ?? ";"}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === "regex" || v === "largura_fixa") return; // modos da IA: só se sai deles escolhendo um separador
                    editar(v === "espacos"
                      ? { tokenizacao: "espacos", delimitador: null, colunas: null, excedente_em: null, regex: null, cortes: null }
                      : { tokenizacao: "delimitado", delimitador: v, colunas: null, excedente_em: null, regex: null, cortes: null, ...(v === "," ? { decimal: "." } : {}) });
                  }}>
                  {receita.tokenizacao === "regex" && <option value="regex">padrão de texto (lido pela IA)</option>}
                  {receita.tokenizacao === "largura_fixa" && <option value="largura_fixa">colunas de largura fixa</option>}
                  {SEPARADORES.map((s) => <option key={s.valor} value={s.valor}>{s.rotulo}</option>)}
                </select>
              </label>
              <label>Decimal
                <select value={receita.decimal} onChange={(e) => editar({ decimal: e.target.value as "," | "." })}>
                  <option value=",">vírgula (1.234,56)</option><option value=".">ponto (1234.56)</option>
                </select>
              </label>
              <label>Pular no topo
                <input type="number" min={0} max={linhas.length} value={receita.pular_inicio} onChange={(e) => editar({ pular_inicio: Math.max(0, Number(e.target.value) || 0) })} />
              </label>
              <label>Precisões em
                <select value={receita.unidade_sigma} onChange={(e) => editar({ unidade_sigma: e.target.value as "m" | "cm" | "mm" })}>
                  <option value="m">metros</option><option value="cm">centímetros</option><option value="mm">milímetros</option>
                </select>
              </label>
              <label>Nome do ponto
                <select value={receita.nome_formato} onChange={(e) => editar({ nome_formato: e.target.value as Receita["nome_formato"] })}>
                  <option value="numero_e_rotulo">número + rótulo colado</option><option value="texto">nome inteiro</option>
                </select>
              </label>
            </div>
          )}
          <TabelaArquivo linhas={linhas} receita={receita} leitura={leitura} verTodas={verTodas} tabular={tabular} onPapel={definirPapel} />
          {linhas.length > 300 && <button type="button" className="fantasma" onClick={() => setVerTodas((v) => !v)}>{verTodas ? "mostrar só as primeiras 300 linhas" : `mostrar as ${linhas.length} linhas`}</button>}
        </section>
      )}

      {erro && <div className="erro" role="alert">{erro}</div>}
      <div className="lt-rodape">
        <button type="button" className="fantasma voltar-para" onClick={onTrocarArquivo} disabled={criando}>← Trocar arquivo</button>
        <span className="esticar" />
        {faltaConfirmar.length > 0 && leitura?.ok && <span className="sub pequeno">marque “conferi” nos avisos destacados para seguir</span>}
        <button type="button" className="principal" disabled={!pode}
          onClick={() => leitura && onConfirmar({ receita, ordem, excluir: [...excluir], sigma_padrao: sigmaPadrao, confirmados: [...confirmados], versao: leitura.versoes.escolhida })}>
          {criando ? "Criando o serviço…" : `Criar o serviço com ${leitura?.anel.length ?? 0} pontos →`}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Desenho
// ---------------------------------------------------------------------------

function MapaLeitura({ leitura, excluir, onAlternar }: { leitura: Leitura; excluir: Set<number>; onAlternar: (linha: number) => void }) {
  const L = 1000, A = 640, M = 28;
  const pts = leitura.pontos.filter((p) => Number.isFinite(p.e) && Number.isFinite(p.n));
  if (!pts.length) return <div className="lt-vazio">Sem coordenadas para desenhar.</div>;
  const minE = Math.min(...pts.map((p) => p.e)), maxE = Math.max(...pts.map((p) => p.e));
  const minN = Math.min(...pts.map((p) => p.n)), maxN = Math.max(...pts.map((p) => p.n));
  const esc = Math.min((L - 2 * M) / Math.max(maxE - minE, 1e-6), (A - 2 * M) / Math.max(maxN - minN, 1e-6));
  const ox = (L - (maxE - minE) * esc) / 2, oy = (A - (maxN - minN) * esc) / 2;
  const x = (e: number) => ox + (e - minE) * esc;
  const y = (n: number) => A - (oy + (n - minN) * esc);
  const porLinha = new Map(leitura.anel.map((p) => [p.linha, p]));
  const partes = leitura.blocos.map((b) => b.map((k) => leitura.anel[k]));
  const rotular = pts.length <= 160;
  return (
    <svg viewBox={`0 0 ${L} ${A}`} className="lt-svg" role="img" aria-label={`Perímetro com ${leitura.anel.length} pontos`}>
      {partes.map((parte, k) => {
        const cr = cruzamentos(parte);
        const ruins = new Set(cr.flatMap(([i, j]) => [i, j]));
        return (
          <g key={k}>
            <polygon points={parte.map((p) => `${x(p.e)},${y(p.n)}`).join(" ")} className="lt-poligono" />
            {parte.map((p, i) => ruins.has(i) && (
              <line key={i} x1={x(p.e)} y1={y(p.n)} x2={x(parte[(i + 1) % parte.length].e)} y2={y(parte[(i + 1) % parte.length].n)} className="lt-cruza" />
            ))}
          </g>
        );
      })}
      {pts.map((p) => {
        const noAnel = porLinha.get(p.linha);
        const fora = excluir.has(p.linha);
        // outra versão do mesmo ponto: troca-se no bloco "Versão dos pontos", não aqui
        const versao = !!p.foraDaVersao && !fora;
        const cls = p.apoio ? "lt-p-apoio" : fora ? "lt-p-excluido" : versao ? "lt-p-versao" : noAnel ? "lt-p" : "lt-p-excluido";
        return (
          <g key={`${p.linha}-${p.idx}`} className="lt-ponto" onClick={() => !p.apoio && !versao && onAlternar(p.linha)}>
            <title>{`${p.nome || "(sem nome)"} · linha ${p.linha}\nE ${p.e.toFixed(3)}  N ${p.n.toFixed(3)}${p.h !== null ? `  h ${p.h}` : ""}${p.apoio ? "\napoio: fora do perímetro" : fora ? "\nexcluído — clique para trazer de volta" : versao ? "\noutra versão do mesmo ponto: fora do perímetro (troque em “Versão dos pontos”)" : "\nclique para excluir"}`}</title>
            {p.apoio
              ? <rect x={x(p.e) - 5} y={y(p.n) - 5} width={10} height={10} className={cls} />
              : <circle cx={x(p.e)} cy={y(p.n)} r={fora ? 5 : 4} className={cls} />}
            {rotular && <text x={x(p.e) + 6} y={y(p.n) - 6} className="lt-rotulo">{noAnel ? noAnel.nome || noAnel.num : p.nome}</text>}
          </g>
        );
      })}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Tabela
// ---------------------------------------------------------------------------

function TabelaArquivo({ linhas, receita, leitura, verTodas, tabular, onPapel }: {
  linhas: string[]; receita: Receita; leitura: Leitura | null; verTodas: boolean; tabular: boolean;
  onPapel: (coluna: number, papel: Papel | "") => void;
}) {
  const status = useMemo(() => {
    const m = new Map<number, { tipo: string; motivo: string }>();
    for (const p of leitura?.pontos ?? []) m.set(p.linha, { tipo: p.apoio ? "apoio" : "ponto", motivo: p.apoio ? "ponto de apoio (fora do perímetro)" : `ponto ${p.nome}` });
    for (const i of leitura?.ignoradas ?? []) if (!m.has(i.linha) || i.tipo === "excluido" || i.tipo === "repetido" || i.tipo === "versao") m.set(i.linha, { tipo: i.tipo, motivo: i.motivo });
    return m;
  }, [leitura]);
  const mostradas = linhas.map((t, i) => ({ t, n: i + 1 })).filter((x) => x.t.trim()).slice(0, verTodas ? undefined : 300);
  const quebrar = (t: string) => (receita.tokenizacao === "espacos" ? dividirEspacos(t) : receita.tokenizacao === "delimitado" && receita.delimitador ? dividirDelimitado(t, receita.delimitador) : [t]);
  const celulas = tabular && receita.tokenizacao !== "regex" && receita.tokenizacao !== "largura_fixa" ? mostradas.map((x) => quebrar(x.t)) : null;
  const k = celulas ? Math.min(40, Math.max(receita.colunas ?? 0, ...celulas.map((c) => c.length))) : 0;
  const papelDa = (j: number) => (PAPEIS.find((p) => receita.campos[p] === j) ?? "") as Papel | "";
  return (
    <div className="lt-tabela-rolagem">
      <table className="lt-tabela">
        {celulas && (
          <thead>
            <tr>
              <th className="lt-n">linha</th>
              {Array.from({ length: k }, (_, j) => (
                <th key={j}>
                  <select value={papelDa(j)} onChange={(e) => onPapel(j, e.target.value as Papel | "")} aria-label={`Papel da coluna ${j + 1}`} className={papelDa(j) ? "lt-papel-ativo" : ""}>
                    <option value="">— ignorar —</option>
                    {PAPEIS.map((p) => <option key={p} value={p}>{NOME_PAPEL[p]}</option>)}
                  </select>
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {mostradas.map((x, r) => {
            const s = status.get(x.n);
            const cls = !s ? "lt-l-solta" : s.tipo === "ponto" ? "" : s.tipo === "apoio" ? "lt-l-apoio" : s.tipo === "ilegivel" ? "lt-l-ilegivel" : "lt-l-ignorada";
            return (
              <tr key={x.n} className={cls} title={s?.motivo ?? "linha sem explicação"}>
                <td className="lt-n">{x.n}</td>
                {celulas
                  ? Array.from({ length: k }, (_, j) => <td key={j} className={papelDa(j) ? "lt-c-papel" : ""}>{celulas[r][j] ?? ""}</td>)
                  : <td className="lt-c-texto">{x.t}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
