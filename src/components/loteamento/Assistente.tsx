// As perguntas antes do desenho. Cada resposta vira um parâmetro do projeto —
// nada aqui é definitivo: tudo pode ser mudado depois no editor, e o
// loteamento se recalcula. O objetivo é sair daqui com uma proposta pronta,
// não com um formulário preenchido.
import { useMemo, useState } from "react";
import { gerarPropostasEmSegundoPlano } from "../../lib/loteamento/auto.ts";
import { buscarTerreno, faixaDeCotas } from "../../lib/loteamento/terreno.ts";
import type { Proposta } from "../../lib/loteamento/auto.ts";
import { fmt } from "../../lib/loteamento/calculo.ts";
import type { Perimetro, Resultado } from "../../lib/loteamento/calculo.ts";
import { criarPlano, paraPlano } from "../../lib/loteamento/plano.ts";
import { FAIXA_SUGERIDA, ROTULO_BORDA, conferirFaixas, faixasDerivadas, mudarLote } from "../../lib/loteamento/modelo.ts";
import type { Borda, Parametros, Projeto, TipoBorda } from "../../lib/loteamento/modelo.ts";
import { caixa, dist } from "../../lib/loteamento/geom.ts";
import type { Poligono, Pt } from "../../lib/loteamento/geom.ts";
import { CampoNum } from "./Painel";

interface Props {
  projeto: Projeto;
  perimetro: Perimetro;
  onMudar: (pr: Projeto) => void;
  /** proposta escolhida (ou projeto sem ruas, para desenhar à mão) */
  onPronto: (pr: Projeto) => void;
  fuso: number;
}

/** Perfis prontos: o ponto de partida mais comum de cada tipo de loteamento. */
const PERFIS: { nome: string; desc: string; p: Partial<Parametros> }[] = [
  { nome: "Mínimo da Lei 6.766", desc: "125 m² · frente 5 m", p: { frente: 5, profundidade: 25, areaMin: 125, frenteMin: 5, ruaLargura: 12, ruaPista: 7 } },
  { nome: "Popular", desc: "8 × 25 m = 200 m²", p: { frente: 8, profundidade: 25, areaMin: 160, frenteMin: 8, ruaLargura: 12, ruaPista: 8 } },
  { nome: "Padrão", desc: "10 × 25 m = 250 m²", p: { frente: 10, profundidade: 25, areaMin: 200, frenteMin: 10, ruaLargura: 12, ruaPista: 8 } },
  { nome: "Médio", desc: "12 × 30 m = 360 m²", p: { frente: 12, profundidade: 30, areaMin: 300, frenteMin: 12, ruaLargura: 14, ruaPista: 9 } },
  { nome: "Chácaras", desc: "20 × 50 m = 1.000 m²", p: { frente: 20, profundidade: 50, areaMin: 1000, frenteMin: 20, ruaLargura: 14, ruaPista: 8, quadraCompMax: 300 } },
];

function pathPol(p: Poligono, T: (q: Pt) => Pt): string {
  const r = (a: Pt[]) => "M" + a.map((q) => T(q).map((x) => x.toFixed(1)).join(" ")).join("L") + "Z";
  return r(p.ext) + p.furos.map(r).join("");
}

/** Desenho pequeno de um resultado (cartões das propostas). */
export function Miniatura({ res, largura = 300, altura = 210 }: { res: Resultado; largura?: number; altura?: number }) {
  const { min, max } = caixa(res.gleba.ext);
  const s = Math.min((largura - 12) / (max[0] - min[0]), (altura - 12) / (max[1] - min[1]));
  const ox = (largura - (max[0] - min[0]) * s) / 2, oy = (altura - (max[1] - min[1]) * s) / 2;
  const T = (q: Pt): Pt => [ox + (q[0] - min[0]) * s, altura - oy - (q[1] - min[1]) * s];
  const cor: Record<string, string> = { verde: "#9AD27F", institucional: "#F0BE75", lazer: "#9BD0EA", app: "#8DBDEB" };
  return (
    <svg viewBox={`0 0 ${largura} ${altura}`} width={largura} height={altura} className="lot-mini">
      <path d={pathPol(res.gleba, T)} fill="#CFCAC0" />
      {res.areas.map((a) => a.pols.map((p, i) => <path key={a.id + i} d={pathPol(p, T)} fill={cor[a.tipo]} />))}
      {res.lotes.map((l) => <path key={l.id} d={pathPol(l.pol, T)} fill={l.problemas.length ? "#F6B5B5" : "#FFFBEA"} stroke="#6D776F" strokeWidth={0.35} />)}
      <path d={pathPol(res.gleba, T)} fill="none" stroke="#12201A" strokeWidth={1.4} />
    </svg>
  );
}

export function Assistente({ projeto, perimetro, onMudar, onPronto, fuso }: Props) {
  const p = projeto.params;
  const setP = (patch: Partial<Parametros>) => onMudar({ ...projeto, params: { ...p, ...patch } });
  // lote: as faixas mín/padrão/máx andam juntas (ver mudarLote)
  const setLote = (patch: Partial<Parametros>) => onMudar({ ...projeto, params: mudarLote(p, patch) });
  const usarPerfil = (pp: Partial<Parametros>) => {
    const base = { ...p, ...pp };
    onMudar({ ...projeto, params: { ...base, ...faixasDerivadas(base) } });
  };
  const [ladoAtivo, setLadoAtivo] = useState<number | null>(null);
  const [modoRuas, setModoRuas] = useState<"auto" | "lado" | "mao">("auto");
  const [ladoRef, setLadoRef] = useState(0);
  const [propostas, setPropostas] = useState<Proposta[] | null>(null);
  const [gerando, setGerando] = useState(false);
  const [etapaGerar, setEtapaGerar] = useState<"relevo" | "malha">("relevo");
  const [erro, setErro] = useState<string | null>(null);

  // perímetro no plano, para o mapa dos lados
  const plano = useMemo(() => criarPlano(perimetro.pts, perimetro.altitudes, false), [perimetro]);
  const pts = useMemo(() => perimetro.pts.map((q) => paraPlano(plano, q)), [perimetro, plano]);
  const areaHa = useMemo(() => {
    let a = 0;
    for (let i = 0; i < pts.length; i++) { const q = pts[i], r = pts[(i + 1) % pts.length]; a += q[0] * r[1] - r[0] * q[1]; }
    return Math.abs(a / 2) / 1e4;
  }, [pts]);
  const W = 520, H = 360;
  const { min, max } = caixa(pts);
  const s = Math.min((W - 60) / (max[0] - min[0]), (H - 60) / (max[1] - min[1]));
  const ox = (W - (max[0] - min[0]) * s) / 2, oy = (H - (max[1] - min[1]) * s) / 2;
  const T = (q: Pt): Pt => [ox + (q[0] - min[0]) * s, H - oy - (q[1] - min[1]) * s];

  const setBorda = (i: number, patch: Partial<Borda>) => {
    const bordas = projeto.bordas.slice();
    bordas[i] = { ...bordas[i], ...patch };
    onMudar({ ...projeto, bordas });
  };
  const corBorda: Record<TipoBorda, string> = { divisa: "#12201A", via: "#C0262D", rio: "#1D5FD1", rodovia: "#8A4B00", ferrovia: "#6B21A8" };

  function gerar() {
    setErro(null);
    if (modoRuas === "mao") { onPronto({ ...projeto, ruas: projeto.ruas.filter((r) => r.id.startsWith("m")), gerado: true }); return; }
    setGerando(true);
    setPropostas(null);
    setEtapaGerar("relevo");
    let angulo: number | undefined;
    if (modoRuas === "lado") {
      const a = pts[ladoRef], b = pts[(ladoRef + 1) % pts.length];
      angulo = Math.atan2(b[1] - a[1], b[0] - a[0]);
    }
    // o relevo decide onde ficam as áreas verdes: busca uma vez e guarda no projeto
    (projeto.terreno ? Promise.resolve(projeto.terreno) : buscarTerreno(perimetro.pts, perimetro.altitudes, fuso))
      .then((terreno) => {
        const comRelevo = terreno && !projeto.terreno ? { ...projeto, terreno } : projeto;
        if (comRelevo !== projeto) onMudar(comRelevo);
        setEtapaGerar("malha");
        return gerarPropostasEmSegundoPlano(comRelevo, perimetro, { quantas: angulo === undefined ? 3 : 1, angulo });
      })
      .then((ps) => {
        if (!ps.length || !ps[0].lotes) setErro("Não coube nenhum lote com esses parâmetros. Diminua a frente/profundidade ou a largura das ruas.");
        setPropostas(ps);
      })
      .catch((e) => setErro(e instanceof Error ? e.message : String(e)))
      .finally(() => setGerando(false));
  }

  const lotePadrao = p.frente * p.profundidade;
  return (
    <div className="lot-assistente">
      <section className="bloco">
        <header><h3>1. O terreno e os acessos</h3><span className="desc">{fmt(areaHa, 4)} ha · {pts.length} lados. Clique num lado para dizer o que existe nele.</span></header>
        <div className="lot-terreno">
          <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="lot-mapa-lados">
            <path d={"M" + pts.map((q) => T(q).join(" ")).join("L") + "Z"} fill="#EEF3EC" />
            {pts.map((a, i) => {
              const b = pts[(i + 1) % pts.length];
              const A = T(a), B = T(b);
              const bd = projeto.bordas[i];
              const m: Pt = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
              return (
                <g key={i} className="lot-lado" onClick={() => setLadoAtivo(i)}>
                  <line x1={A[0]} y1={A[1]} x2={B[0]} y2={B[1]} stroke="transparent" strokeWidth={16} />
                  <line x1={A[0]} y1={A[1]} x2={B[0]} y2={B[1]} stroke={corBorda[bd?.tipo ?? "divisa"]} strokeWidth={ladoAtivo === i ? 6 : bd?.tipo === "divisa" ? 2 : 4.5} />
                  <circle cx={m[0]} cy={m[1]} r={10} fill={ladoAtivo === i ? "#178552" : "#fff"} stroke={corBorda[bd?.tipo ?? "divisa"]} />
                  <text x={m[0]} y={m[1] + 3.5} textAnchor="middle" fontSize={10} fontWeight={700} fill={ladoAtivo === i ? "#fff" : "#12201A"}>{i + 1}</text>
                </g>
              );
            })}
          </svg>
          <div className="lot-lados-lista">
            {pts.map((a, i) => {
              const b = pts[(i + 1) % pts.length];
              const bd = projeto.bordas[i];
              return (
                <div key={i} className={`lot-lado-linha${ladoAtivo === i ? " ativo" : ""}`} onClick={() => setLadoAtivo(i)}>
                  <span className="n" style={{ borderColor: corBorda[bd.tipo] }}>{i + 1}</span>
                  <span className="comp">{fmt(dist(a, b), 1)} m</span>
                  <select value={bd.tipo} onChange={(e) => {
                    const tipo = e.target.value as TipoBorda;
                    setBorda(i, { tipo, faixa: FAIXA_SUGERIDA[tipo] });
                  }}>
                    {(Object.keys(ROTULO_BORDA) as TipoBorda[]).map((t) => <option key={t} value={t}>{ROTULO_BORDA[t]}</option>)}
                  </select>
                  {(bd.tipo === "rio" || bd.tipo === "rodovia" || bd.tipo === "ferrovia") && (
                    <CampoNum valor={bd.faixa} sufixo="m de faixa" casas={0} onAplicar={(v) => setBorda(i, { faixa: v ?? 0 })}
                      titulo="Faixa não loteável a partir da divisa (APP do rio pelo Código Florestal; 15 m de rodovia/ferrovia pela Lei 6.766)" />
                  )}
                  {bd.tipo !== "divisa" && (
                    <input className="nome" placeholder={bd.tipo === "via" ? "nome da estrada" : "nome"} value={bd.nome ?? ""} onChange={(e) => setBorda(i, { nome: e.target.value })} />
                  )}
                  {bd.tipo === "divisa" && perimetro.confrontantes[i] && <span className="conf" title={perimetro.confrontantes[i] ?? ""}>{perimetro.confrontantes[i]}</span>}
                </div>
              );
            })}
            <p className="lot-dica">
              Marque como <b>rua/estrada existente</b> o lado por onde se chega: os lotes desse lado ganham frente para ela e o
              sistema confere se toda rua nova se liga a um acesso. Rio pede APP (30 m para rio de até 10 m de largura — Código
              Florestal, art. 4º); rodovia e ferrovia pedem 15 m non aedificandi (Lei 6.766, art. 4º, III).
            </p>
          </div>
        </div>
      </section>

      <section className="bloco">
        <header><h3>2. Os lotes</h3><span className="desc">Comece por um perfil e ajuste. Lote mínimo federal: 125 m² e 5 m de frente (Lei 6.766, art. 4º, II) — o município pode exigir mais.</span></header>
        <div className="lot-perfis">
          {PERFIS.map((pf) => (
            <button key={pf.nome} className={pf.p.frente === p.frente && pf.p.profundidade === p.profundidade ? "ativo" : ""} onClick={() => usarPerfil(pf.p)}>
              <b>{pf.nome}</b><span>{pf.desc}</span>
            </button>
          ))}
        </div>
        <div className="lot-faixas" role="table" aria-label="Medidas do lote">
          <span role="columnheader" />
          <span role="columnheader">Mínima</span>
          <span role="columnheader">Padrão</span>
          <span role="columnheader">Máxima</span>
          {([
            ["Frente", "m", "frenteMin", "frente", "frenteMax"],
            ["Profundidade", "m", "profundidadeMin", "profundidade", "profundidadeMax"],
            ["Área", "m²", "areaMin", "areaPadrao", "areaMax"],
          ] as const).map(([rot, suf, ...ks]) => (
            <div key={rot} role="row" className="lot-faixas-linha">
              <b role="rowheader">{rot}</b>
              {ks.map((k) => (
                <CampoNum key={k} valor={p[k]} sufixo={suf} casas={suf === "m²" ? 0 : 2} onAplicar={(v) => v && setLote({ [k]: v })} />
              ))}
            </div>
          ))}
        </div>
        <p className="lot-dica">
          O gerador busca o <b>padrão</b> ({fmt(p.frente)} × {fmt(p.profundidade)} m = {fmt(lotePadrao)} m²) e não deixa lote fora das faixas:
          o que passa da máxima é dividido ou aparado no fundo, o que fica abaixo da mínima se junta ao vizinho. Na prancheta,
          a edição também respeita as faixas. Quadra de duas fileiras: {fmt(2 * p.profundidade)} m de fundo a fundo.
        </p>
        {conferirFaixas(p).map((t) => <p key={t} className="lot-aviso">Atenção: {t}.</p>)}
        <div className="lot-grade">
          <label>Quando a fileira não fecha em lotes inteiros, a sobra vai para
            <select value={p.sobra} onChange={(e) => setP({ sobra: e.target.value as Parametros["sobra"] })}>
              <option value="esquinas">os lotes de esquina (ficam um pouco maiores)</option>
              <option value="ultimo">o último lote da fileira</option>
              <option value="distribuir">todos os lotes, igualmente</option>
              <option value="extra">um lote a mais, se couber o mínimo</option>
            </select>
          </label>
          <label>Lotes que encostam na divisa do terreno
            <select value={p.divisa} onChange={(e) => setP({ divisa: e.target.value as Parametros["divisa"] })}>
              <option value="padronizar">padronizados, com a mesma frente dos outros</option>
              <option value="areas_iguais">em áreas iguais (absorvem a divisa torta)</option>
            </select>
          </label>
        </div>
        <p className="lot-dica">Depois, no desenho, cada quadra pode ter a sua regra: padronizada, áreas iguais ou quantidade fixa — e cada lote pode ser travado numa frente ou área.</p>
      </section>

      <section className="bloco">
        <header><h3>3. As ruas</h3><span className="desc">Largura total = pista + calçadas dos dois lados.</span></header>
        <div className="lot-grade">
          <label>Largura total<CampoNum valor={p.ruaLargura} sufixo="m" onAplicar={(v) => v && setP({ ruaLargura: v })} /></label>
          <label>Pista<CampoNum valor={p.ruaPista} sufixo="m" onAplicar={(v) => v && setP({ ruaPista: Math.min(v, p.ruaLargura) })} /></label>
          <label>Esquinas
            <select value={p.esquina} onChange={(e) => setP({ esquina: e.target.value as Parametros["esquina"], esquinaValor: e.target.value === "chanfro" ? 3 : 6 })}>
              <option value="raio">arredondadas (raio)</option>
              <option value="chanfro">chanfradas</option>
              <option value="nenhuma">canto vivo</option>
            </select>
          </label>
          {p.esquina !== "nenhuma" && <label>{p.esquina === "raio" ? "Raio no alinhamento" : "Chanfro em cada lado"}<CampoNum valor={p.esquinaValor} sufixo="m" onAplicar={(v) => v !== undefined && setP({ esquinaValor: v })} /></label>}
          <label>Comprimento máximo da quadra<CampoNum valor={p.quadraCompMax} sufixo="m" casas={0} onAplicar={(v) => v && setP({ quadraCompMax: v })} /></label>
        </div>
        <p className="lot-dica">Calçada de {fmt(Math.max(0, (p.ruaLargura - p.ruaPista) / 2))} m de cada lado. Leis municipais costumam pedir via de 12 a 14 m e quadra de 100 a 250 m.</p>
        <p className="lot-dica">
          <b>Acesso:</b> rua só encosta no perímetro onde existe estrada (lado marcado na pergunta 1). Na divisa com vizinho, no rio
          ou na rodovia ela termina num cruzamento — em geral numa rua de contorno a uma profundidade de lote da divisa, que deixa
          os lotes da beirada com o fundo na divisa — ou num balão de retorno. Rua desenhada à mão contra a divisa vira pendência.
        </p>
        <div className="lot-opcoes-ruas">
          <label className={modoRuas === "auto" ? "ativo" : ""}><input type="radio" checked={modoRuas === "auto"} onChange={() => setModoRuas("auto")} />
            <b>O sistema traça</b><span>testa as direções do terreno, com e sem rua de contorno, e mostra as 3 que rendem mais lotes</span></label>
          <label className={modoRuas === "lado" ? "ativo" : ""}><input type="radio" checked={modoRuas === "lado"} onChange={() => setModoRuas("lado")} />
            <b>Paralelas a um lado</b>
            <span>ruas acompanhando o lado <select value={ladoRef} onClick={(e) => e.stopPropagation()} onChange={(e) => setLadoRef(Number(e.target.value))}>
              {pts.map((_, i) => <option key={i} value={i}>{i + 1}{projeto.bordas[i]?.tipo === "via" ? " (estrada)" : ""}</option>)}
            </select></span></label>
          <label className={modoRuas === "mao" ? "ativo" : ""}><input type="radio" checked={modoRuas === "mao"} onChange={() => setModoRuas("mao")} />
            <b>Vou desenhar</b><span>começa sem ruas; você clica o eixo de cada uma no desenho (tecla R)</span></label>
        </div>
      </section>

      <section className="bloco">
        <header><h3>4. Áreas públicas</h3><span className="desc">Desde a Lei 9.785/99 o percentual é do município; muitos ainda pedem 35% somando viário, verde e institucional.</span></header>
        <div className="lot-grade">
          <label>Área verde (mín.)<CampoNum valor={p.pctVerdeMin} sufixo="% da gleba" casas={1} onAplicar={(v) => v !== undefined && setP({ pctVerdeMin: v })} /></label>
          <label>Institucional (mín.)<CampoNum valor={p.pctInstitucionalMin} sufixo="% da gleba" casas={1} onAplicar={(v) => v !== undefined && setP({ pctInstitucionalMin: v })} /></label>
          <label>Públicas no total (mín.)<CampoNum valor={p.pctPublicasMin} sufixo="%" casas={1} onAplicar={(v) => v !== undefined && setP({ pctPublicasMin: v })} /></label>
        </div>
        <p className="lot-dica">
          A área verde vai para a terra menos valorizada: retalhos sem frente, baixadas (cota mais baixa), encostas íngremes, buracos e o
          que fica longe do acesso. Lote de frente para a estrada <b>nunca</b> vira área verde. A institucional fica numa ponta da quadra mais
          central. No desenho, qualquer lote ou quadra vira área pública com um clique — e volta.
        </p>
        {projeto.terreno && (() => {
          const f = faixaDeCotas(projeto.terreno);
          return (
            <p className="lot-dica">
              Relevo {projeto.terreno.fonte === "dem" ? "do modelo digital de elevação, calibrado pelas cotas do levantamento" : "estimado pelas cotas dos marcos do perímetro"}:
              cotas de <b>{fmt(f.min, 1)}</b> a <b>{fmt(f.max, 1)} m</b> ({fmt(f.max - f.min, 1)} m de desnível).
              <button className="fantasma" style={{ marginLeft: 8, padding: 0, height: "auto" }} onClick={() => onMudar({ ...projeto, terreno: undefined })}>ler de novo</button>
            </p>
          );
        })()}
      </section>

      <section className="bloco">
        <header><h3>5. Numeração e medidas</h3></header>
        <div className="lot-grade">
          <label>Quadras
            <select value={p.numeracaoQuadras} onChange={(e) => setP({ numeracaoQuadras: e.target.value as Parametros["numeracaoQuadras"] })}>
              <option value="letras">por letra (A, B, C…)</option><option value="numeros">por número (01, 02…)</option>
            </select>
          </label>
          <label>Lotes
            <select value={p.sentidoLotes} onChange={(e) => setP({ sentidoLotes: e.target.value as Parametros["sentidoLotes"] })}>
              <option value="horario">sentido horário, a partir do canto noroeste</option><option value="antihorario">sentido anti-horário</option>
            </select>
          </label>
          <label className="lot-check"><input type="checkbox" checked={p.distanciasTerreno} onChange={(e) => setP({ distanciasTerreno: e.target.checked })} />
            <span><b>Medidas de terreno</b> — o lote de 10 m mede 10 m na trena; a locação volta para UTM com o fator de escala</span></label>
        </div>
      </section>

      <div className="lot-gerar">
        <button className="principal grande" disabled={gerando} onClick={gerar}>
          {gerando ? <><span className="spinner" /> {etapaGerar === "relevo" ? "Lendo o relevo do terreno…" : "Testando direções, contorno e defasagens…"}</> : modoRuas === "mao" ? "Ir para o desenho →" : propostas ? "Gerar de novo" : "Gerar o loteamento"}
        </button>
        {erro && <p className="lot-erro">{erro}</p>}
      </div>

      {propostas && propostas.length > 0 && (
        <section className="lot-propostas">
          {propostas.map((pr, i) => (
            <article key={i} className={`lot-proposta${i === 0 ? " melhor" : ""}`}>
              <header><b>{pr.titulo}</b>{i === 0 && <span className="chip ok-chip">mais lotes</span>}</header>
              <Miniatura res={pr.resultado} />
              <div className="lot-metricas">
                <div><b>{pr.lotes}</b><span>lotes</span></div>
                <div><b>{fmt(pr.pctLotes, 1)}%</b><span>vendável</span></div>
                <div><b>{fmt(pr.pctViario, 1)}%</b><span>viário</span></div>
                <div><b>{pr.resultado.ruas.length}</b><span>ruas</span></div>
              </div>
              <p className="lot-dica">
                Verde {fmt((100 * (pr.resultado.quadro.verde + pr.resultado.quadro.lazer)) / pr.resultado.quadro.gleba, 1)}% ·
                institucional {fmt((100 * pr.resultado.quadro.institucional) / pr.resultado.quadro.gleba, 1)}% ·
                {" "}{pr.resultado.problemas.filter((x) => x.nivel === "erro").length} lote(s) com pendência
              </p>
              <button className="principal" onClick={() => onPronto(pr.projeto)}>Usar esta proposta →</button>
            </article>
          ))}
        </section>
      )}
    </div>
  );
}
