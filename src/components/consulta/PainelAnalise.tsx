// A análise da área, na mesma tela: a frase do topo, os cartões por tema
// (restrições, SIGEF, CAR, queimadas, ambiente) e o laudo por IA. Cada fonte
// aparece assim que responde; a que falhou diz que falhou e tem "tentar de
// novo", e o resto segue.
import { useState } from "react";
import type { ReactNode } from "react";
import { AVISO_RESTRICOES, fmtData, sobreposicaoPequena, textoFonte, textoItem } from "../../lib/restricoes";
import { ehPropriaArea, fraseDaAnalise } from "../../lib/consulta/analise.ts";
import type { Analise, ChaveFonte } from "../../lib/consulta/analise.ts";
import { textoFocos } from "../../lib/consulta/focos.ts";
import { fmtAreaCurta, fmtDist, fmtNum } from "../../lib/consulta/geometria.ts";
import type { Resposta } from "../../lib/consulta/tipos.ts";
import { Dica } from "../ui";

const dataHora = (iso: string) => {
  const d = new Date(iso);
  return `${d.toLocaleDateString("pt-BR")} às ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
};
const rlCurta = (bioma: string, al: boolean | null) =>
  al === false ? "20%" : al && /amaz/i.test(bioma) ? "80%" : al && /cerrado/i.test(bioma) ? "35%" : "20 a 80%";
const mesCurto = (aaaamm: string) => ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"][Number(aaaamm.slice(5, 7)) - 1] ?? "";

export function PainelAnalise({ analise, onTentar, onAtualizar, laudo }: {
  analise: Analise;
  onTentar: (k: ChaveFonte) => void;
  onAtualizar: () => void;
  laudo: { estado: "pronto" | "gravando" | "escrevendo" | "indisponivel"; motivo?: string; onEscrever: (refazer?: boolean) => void };
}) {
  const f = fraseDaAnalise(analise);
  return (
    <section className="cp-bloco ca-analise" aria-live="polite" aria-busy={f.carregando > 0}>
      <div className={`ca-frase ${f.tom}`}>
        <b><span className="ca-sinal" aria-hidden>{f.tom === "ok" ? "✓" : f.tom === "perigo" ? "!" : f.tom === "neutro" ? "…" : "!"}</span>{f.texto}</b>
        {(f.identificacao.length + f.sobreposicoes.length + f.avisos.length + f.pendentes.length) > 0 && (
          <ul>
            {f.identificacao.map((t) => <li key={t} className="c-ident">{t}</li>)}
            {f.sobreposicoes.slice(1).map((t) => <li key={t} className="c-sobre">Sobrepõe {t}</li>)}
            {f.avisos.map((t) => <li key={t} className="c-aviso">{t}</li>)}
            {f.pendentes.map((t) => <li key={t} className="c-pend">{t}</li>)}
          </ul>
        )}
        {f.detalhe && <span className="ca-carregando"><span className="spinner" aria-hidden /> {f.detalhe}</span>}
      </div>

      <CartaoRestricoes a={analise} onTentar={() => onTentar("restricoes")} />
      <div className="ca-grade">
        <CartaoSigef a={analise} onTentar={() => onTentar("sigef")} />
        <CartaoCar a={analise} onTentar={() => onTentar("car")} />
      </div>
      <CartaoFocos a={analise} onTentar={() => onTentar("focos")} />
      <CartaoAmbiente a={analise} onTentar={onTentar} />
      <BlocoLaudo a={analise} {...laudo} />
      <p className="ca-rodape">Consulta em {dataHora(analise.quando)} · bases públicas: alerta, não certidão<Dica>{AVISO_RESTRICOES}</Dica>{!f.carregando && laudo.estado !== "escrevendo" && <> · <button type="button" className="link" onClick={onAtualizar}>consultar tudo de novo</button></>}</p>
    </section>
  );
}

// ---------------------------------------------------------------------------

function Cartao({ titulo, dica, selo, tom, children, falhou, onTentar }: {
  titulo: string; dica?: ReactNode; selo?: { texto: string; tom: string } | null; tom?: string; children?: ReactNode;
  falhou?: string | null; onTentar?: () => void;
}) {
  return (
    <article className={`ca-cartao${falhou ? " falhou" : tom ? ` ${tom}` : ""}`}>
      <header>
        <h3>{titulo}{dica && <Dica>{dica}</Dica>}</h3>
        <span className="esticar" />
        {falhou ? <span className="ca-selo aviso">sem resposta</span> : selo && <span className={`ca-selo ${selo.tom}`}>{selo.texto}</span>}
      </header>
      {falhou ? (
        <>
          <p>Não respondeu: {falhou}.</p>
          {onTentar && <div><button type="button" className="ca-tentar" onClick={onTentar}>Tentar de novo</button></div>}
        </>
      ) : children}
    </article>
  );
}

const carregandoCartao = <><div className="ca-esq" style={{ width: "70%" }} /><div className="ca-esq" style={{ width: "45%" }} /></>;
const seloCarregando = { texto: "consultando", tom: "carregando" };

function CartaoRestricoes({ a, onTentar }: { a: Analise; onTentar: () => void }) {
  const [abertas, setAbertas] = useState(false);
  const dica = "Terras Indígenas (FUNAI), Unidades de Conservação (MMA/CNUC), assentamentos e quilombolas (INCRA), embargos (IBAMA e ICMBio), faixa de fronteira (IBGE), áreas militares e sítios arqueológicos (IPHAN), cruzados na hora com a área, no mesmo cálculo de área do sistema.";
  const r = a.restricoes;
  if (r.estado !== "ok") return <Cartao titulo="Restrições" dica={dica} selo={seloCarregando} falhou={r.estado === "falhou" ? r.motivo : null} onTentar={onTentar}>{carregandoCartao}</Cartao>;
  const fontes = r.dados.fontes;
  const comAlgo = fontes.filter((x) => x.classe !== "livre");
  const livres = fontes.filter((x) => x.classe === "livre");
  const propria = (tipo: string, pct: number) => ehPropriaArea(a.imovel, tipo, pct);
  const sobrepostas = fontes.flatMap((x) => x.itens.filter((it) => it.classe === "sobrepoe" && !propria(x.tipo, it.pct)));
  // só sobreposições pequenas (em % E em ha): provável escala da base — o mesmo tom da frase do topo
  const sobre = sobrepostas.some((it) => !sobreposicaoPequena(it));
  const pequenas = !sobre && sobrepostas.length > 0;
  const faltou = fontes.some((x) => x.classe === "nao_consultado" || x.classe === "incompleta");
  const tom = sobre ? "perigo" : faltou || comAlgo.length ? "aviso" : "";
  const selo = sobre ? { texto: "sobrepõe", tom: "perigo" } : faltou ? { texto: "incompleta", tom: "aviso" } : pequenas ? { texto: "conferir", tom: "aviso" } : comAlgo.length ? { texto: "encosta", tom: "aviso" } : { texto: "livre", tom: "ok" };
  return (
    <Cartao titulo="Restrições" dica={dica} selo={selo} tom={tom}>
      {comAlgo.length > 0 && (
        <ul>
          {comAlgo.flatMap((x) => x.itens.length
            ? x.itens.map((it) => (
              <li key={`${x.tipo}:${it.id}`} className={propria(x.tipo, it.pct) ? "ident" : it.classe === "sobrepoe" && !sobreposicaoPequena(it) ? "sobre" : "encosta"}>
                <span><b>{x.singular}</b> · {it.nome} — {propria(x.tipo, it.pct) ? `é a própria área, ${textoItem(it, fmtAreaCurta)}; o CAR é ${a.imovel.car?.tipo === "AST" ? "de assentamento" : "de povo tradicional"}` : textoItem(it, fmtAreaCurta)}</span>
                {it.detalhes.length > 0 && <small>{it.detalhes.join(" · ")}</small>}
              </li>
            ))
            : [<li key={x.tipo} className="encosta"><span><b>{x.singular}</b> ({x.orgao}) — {textoFonte(x, r.dados.encostaM, fmtAreaCurta)}</span>{x.motivo && <small>{x.motivo}</small>}</li>])}
        </ul>
      )}
      {livres.length > 0 && (
        <p>
          <button type="button" className="link" onClick={() => setAbertas((v) => !v)} aria-expanded={abertas}>
            {abertas ? "▾" : "▸"} {livres.length === fontes.length ? "Todas as 9 bases" : `${livres.length} de ${fontes.length} bases`} sem nada a menos de {r.dados.encostaM} m
          </button>
          {abertas && <><br />{livres.map((x) => `${x.rotulo} (${x.orgao})`).join(" · ")}</>}
        </p>
      )}
      {faltou && <p><button type="button" className="ca-tentar" onClick={onTentar}>Consultar de novo as bases que faltaram</button></p>}
    </Cartao>
  );
}

function CartaoSigef({ a, onTentar }: { a: Analise; onTentar: () => void }) {
  const s = a.sigef;
  const dica = "Parcelas certificadas pelo INCRA (SIGEF): a base do sistema, atualizada na hora pelo INCRA quando ele responde. Sobreposição com parcela certificada impede a certificação da área.";
  if (s.estado !== "ok") return <Cartao titulo="SIGEF · certificado" dica={dica} selo={seloCarregando} falhou={s.estado === "falhou" ? s.motivo : null} onTentar={onTentar}>{carregandoCartao}</Cartao>;
  const d = s.dados;
  const sobre = d.sobreposicoes.filter((x) => !x.mesma_parcela);
  const propria = d.sobreposicoes.find((x) => x.mesma_parcela);
  const local = d.online !== "ok";
  return (
    <Cartao titulo="SIGEF · certificado" dica={dica} tom={sobre.length ? "perigo" : local ? "aviso" : ""}
      selo={sobre.length ? { texto: "sobrepõe", tom: "perigo" } : local ? { texto: "base local", tom: "aviso" } : { texto: "livre", tom: "ok" }}>
      {propria && <p className="forte">É a própria parcela certificada {propria.codigo.slice(0, 8)}…</p>}
      {sobre.length > 0 ? (
        <ul>{sobre.map((x) => (
          <li key={x.codigo} className="sobre"><span><b>{x.nome ?? "Parcela certificada"}</b> — {fmtAreaCurta(x.area_m2)} ({fmtNum(x.percentual_imovel, 2)}% da área)</span><small>{x.codigo}{x.situacao ? ` · ${x.situacao}` : ""}</small></li>
        ))}</ul>
      ) : <p className={propria ? "" : "forte"}>Nenhuma parcela certificada sobrepõe a área.</p>}
      {d.vizinhas.length > 0 ? (
        <p>{d.vizinhas.length} {d.vizinhas.length === 1 ? "parcela certificada" : "parcelas certificadas"} a até {d.raioM} m<Dica>
          Confrontantes certificados em potencial: {d.vizinhas.slice(0, 6).map((v) => `${v.nome ?? v.codigo.slice(0, 8)} (${fmtDist(v.distanciaM)})`).join("; ")}.
        </Dica>: {d.vizinhas.slice(0, 2).map((v) => `${v.nome ?? v.codigo.slice(0, 8)} a ${fmtDist(v.distanciaM)}`).join("; ")}{d.vizinhas.length > 2 ? "…" : ""}</p>
      ) : <p>Nenhuma parcela certificada a até {d.raioM} m.</p>}
      {local && <p>{d.online === "sem-uf" ? "Só a base do sistema (falta a UF para consultar o INCRA na hora)." : "O INCRA não respondeu agora: valeu a base do sistema."} <button type="button" className="link" onClick={onTentar}>tentar de novo</button></p>}
    </Cartao>
  );
}

function CartaoCar({ a, onTentar }: { a: Analise; onTentar: () => void }) {
  const c = a.car;
  const dica = "Outros imóveis inscritos no CAR (SICAR) que cruzam a área ou estão a até 100 m. CAR é declaração do proprietário: sobreposição de CAR é comum e não é título — mas o SICAR aponta e trava a análise.";
  if (c.estado !== "ok") return <Cartao titulo="CAR · declarado" dica={dica} selo={seloCarregando} falhou={c.estado === "falhou" ? c.motivo : null} onTentar={onTentar}>{carregandoCartao}</Cartao>;
  const sobre = c.dados.itens.filter((x) => x.areaM2 > 0);
  const viz = c.dados.itens.filter((x) => x.areaM2 === 0);
  return (
    <Cartao titulo="CAR · declarado" dica={dica} tom={sobre.length ? "aviso" : ""} selo={sobre.length ? { texto: `${sobre.length} sobreposto${sobre.length > 1 ? "s" : ""}`, tom: "aviso" } : c.dados.falhas?.length || c.dados.cortada ? { texto: "resposta incompleta", tom: "aviso" } : { texto: "sem sobreposição", tom: "ok" }}>
      {sobre.length > 0 ? (
        <ul>{sobre.slice(0, 4).map((x) => (
          <li key={x.codigo} className="encosta"><span><b className="mono">{x.codigo.slice(0, 17)}…</b> — {fmtAreaCurta(x.areaM2)} ({fmtNum(x.pct, 2)}%)</span><small>{x.situacao}</small></li>
        ))}</ul>
      ) : <p className="forte">Nenhum outro CAR declarado sobrepõe a área.</p>}
      {sobre.length > 4 && <p>e mais {sobre.length - 4}.</p>}
      {viz.length > 0 && <p>{viz.length} CAR vizinho{viz.length > 1 ? "s" : ""} a até 100 m, sem sobreposição.</p>}
      {c.dados.cortada && <p>Há mais imóveis declarados por perto do que os conferidos (a consulta traz até 50 por vez).</p>}
      {(c.dados.falhas ?? []).map((t) => <p key={t} className="falhou">{t} <button type="button" className="link" onClick={onTentar}>tentar de novo</button></p>)}
    </Cartao>
  );
}

function CartaoFocos({ a, onTentar }: { a: Analise; onTentar: () => void }) {
  const f = a.focos;
  const dica = "Focos de calor detectados por satélite (INPE, BDQueimadas) nos últimos 12 meses, dentro da área e num raio de 1 km. Um incêndio pode aparecer em vários satélites; o \"de referência\" é a série comparável de ano a ano.";
  if (f.estado !== "ok") return <Cartao titulo="Queimadas · 12 meses" dica={dica} selo={seloCarregando} falhou={f.estado === "falhou" ? f.motivo : null} onTentar={onTentar}>{carregandoCartao}</Cartao>;
  const d = f.dados;
  return (
    <Cartao titulo="Queimadas · 12 meses" dica={dica} tom={d.dentro.length || d.cortada ? "aviso" : ""}
      selo={d.cortada ? { texto: "resposta incompleta", tom: "aviso" } : d.dentro.length ? { texto: `${d.dentro.length} dentro`, tom: "aviso" } : d.perto.length ? { texto: `${d.perto.length} perto`, tom: "" } : { texto: "nenhum", tom: "ok" }}>
      <p className="forte">{textoFocos(d)}</p>
      {(d.dentro.length > 0 || d.perto.length > 0) && (
        <p>{d.cortada ? "Achados até aqui: " : `Satélite de referência: ${d.referenciaDentro} dentro · ${d.referenciaPerto} a até 1 km. `}{[...d.dentro, ...d.perto].slice(0, 3).map((x) => `${fmtData(x.quando)} (${x.satelite ?? "satélite"}${x.distanciaM > 0 ? `, a ${fmtDist(x.distanciaM)}` : ", dentro"})`).join(" · ")}</p>
      )}
    </Cartao>
  );
}

function Tile<T>({ rotulo, dica, r, onTentar, children }: { rotulo: string; dica?: ReactNode; r: Resposta<T>; onTentar: () => void; children: (d: T) => ReactNode }) {
  if (r.estado === "carregando") return <div className="ca-tile"><span>{rotulo}</span><div className="ca-esq" style={{ width: "60%", marginTop: 6 }} /></div>;
  if (r.estado === "falhou") {
    return (
      <div className="ca-tile falhou" title={r.motivo}>
        <span>{rotulo}{dica && <Dica>{dica}</Dica>}</span>
        <b>não respondeu</b>
        <small>{r.motivo.length > 70 ? `${r.motivo.slice(0, 70)}…` : r.motivo} · <button type="button" className="link" onClick={onTentar}>tentar de novo</button></small>
      </div>
    );
  }
  return <div className="ca-tile"><span>{rotulo}{dica && <Dica>{dica}</Dica>}</span>{children(r.dados)}</div>;
}

function CartaoAmbiente({ a, onTentar }: { a: Analise; onTentar: (k: ChaveFonte) => void }) {
  return (
    <article className="ca-cartao">
      <header><h3>Ambiente<Dica>Dados públicos do lugar, para orçar e planejar o campo. Bioma e município: IBGE. Solo: SoilGrids (ISRIC), modelo global de 250 m — estimativa, não levantamento. Clima: Open-Meteo (reanálise ERA5), não é estação.</Dica></h3></header>
      <div className="ca-ambiente">
        <Tile rotulo="Bioma" r={a.bioma} onTentar={() => onTentar("bioma")} dica="IBGE, Biomas 1:250.000, e o recorte da Amazônia Legal. A reserva legal mínima de referência é a do Código Florestal (Lei 12.651/2012, art. 12).">
          {(b) => <><b>{b.bioma}</b><small>{b.amazoniaLegal === true ? "Amazônia Legal · " : b.amazoniaLegal === false ? "Fora da Amazônia Legal · " : ""}reserva legal {rlCurta(b.bioma, b.amazoniaLegal)}<Dica>{b.reservaLegal}</Dica></small></>}
        </Tile>
        <Tile rotulo="Solo provável" r={a.solo} onTentar={() => onTentar("solo")}>
          {(s) => <><b>{s.nome}</b><small>WRB {s.wrb}{s.probabilidade != null ? ` · ${s.probabilidade}%` : ""}<Dica>{s.explicacao}{s.alternativas.length ? ` Outras prováveis: ${s.alternativas.map((x) => `${x.nome} (${x.probabilidade}%)`).join(", ")}.` : ""} Estimativa do SoilGrids (250 m).</Dica></small></>}
        </Tile>
        <Tile rotulo="Chuva · 12 meses" r={a.clima} onTentar={() => onTentar("clima")} dica="Open-Meteo, reanálise ERA5 (não é estação). A barra de cada mês é a chuva acumulada.">
          {(c) => {
            // só os meses inteiros: a janela de 365 dias corta o primeiro e o último, e um mês de 5 dias pareceria seca
            const meses = c.meses.filter((m) => m.inteiro !== false).slice(-12);
            const max = Math.max(1, ...meses.map((m) => m.chuvaMm));
            return (
              <>
                <b>{fmtNum(c.chuva12mMm, 0)} mm</b>
                <small>{fmtNum(c.chuva30dMm, 0)} mm nos últimos 30 dias{c.tempMediaC != null ? ` · ${fmtNum(c.tempMediaC, 1)} °C de média` : ""}</small>
                <div className="ca-barras" aria-hidden>{meses.map((m) => <i key={m.mes} className={m.chuvaMm < max * 0.15 ? "seco" : ""} style={{ height: `${Math.max(4, (m.chuvaMm / max) * 100)}%` }} title={`${mesCurto(m.mes)}: ${fmtNum(m.chuvaMm, 0)} mm`} />)}</div>
                <div className="ca-barras-meses" aria-hidden>{meses.map((m) => <span key={m.mes}>{mesCurto(m.mes).charAt(0)}</span>)}</div>
              </>
            );
          }}
        </Tile>
        <Tile rotulo="Município" r={a.municipio} onTentar={() => onTentar("municipio")}>
          {(m) => m ? <><b>{m.nome}/{m.uf}</b><small>{m.regiaoImediata ? `Região imediata de ${m.regiaoImediata}` : `IBGE ${m.codigo}`}{a.clima.estado === "ok" && a.clima.dados.altitudeM != null ? ` · ~${fmtNum(a.clima.dados.altitudeM, 0)} m de altitude` : ""}</small></> : <b>Fora de município</b>}
        </Tile>
      </div>
    </article>
  );
}

function BlocoLaudo({ a, estado, motivo, onEscrever }: { a: Analise; estado: "pronto" | "gravando" | "escrevendo" | "indisponivel"; motivo?: string; onEscrever: (refazer?: boolean) => void }) {
  const [copiado, setCopiado] = useState(false);
  const pronto = a.laudo;
  const completo = !fraseDaAnalise(a).carregando;
  return (
    <section className="ca-laudo">
      <header>
        <h3>Laudo técnico<Dica>Um parecer preliminar escrito por IA SÓ com os dados desta consulta, citando a fonte de cada afirmação. Não inventa: o que uma base não respondeu aparece como pendência. Entra no PDF. Até 20 laudos por dia por empresa, sem gastar crédito. Revise antes de enviar: a responsabilidade técnica é sua.</Dica></h3>
        <span className="ca-ia">IA</span>
        <span className="esticar" />
        {pronto && <>
          <button type="button" className="fantasma" onClick={() => { void navigator.clipboard?.writeText(pronto.texto).then(() => { setCopiado(true); setTimeout(() => setCopiado(false), 1600); }); }}>{copiado ? "Copiado ✓" : "Copiar"}</button>
          <button type="button" className="fantasma" disabled={estado === "escrevendo"} onClick={() => onEscrever(true)}>{estado === "escrevendo" ? "Reescrevendo…" : "Reescrever"}</button>
        </>}
      </header>
      {pronto ? (
        <>
          <div className="ca-laudo-texto">{pronto.texto}</div>
          <p>Escrito em {dataHora(pronto.quando)}{pronto.modelo ? ` · ${pronto.modelo}` : ""} · revise antes de usar.</p>
        </>
      ) : (
        <div className="ca-acoes">
          <button type="button" className="escuro" disabled={!completo || estado !== "pronto"} onClick={() => onEscrever()}>
            {estado === "escrevendo" ? "Escrevendo o laudo…" : estado === "gravando" && completo ? "Guardando a consulta…" : "Escrever o laudo"}
          </button>
          <p>{estado === "indisponivel" ? motivo : !completo ? "Fica disponível quando todas as fontes responderem." : estado === "escrevendo" ? "Leva uns 20 segundos." : "Parecer em 5 seções, com a fonte de cada dado."}</p>
        </div>
      )}
    </section>
  );
}

