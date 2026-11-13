// Sobreposição do CAR com os vizinhos (CAR do SICAR + parcelas do SIGEF) e o
// ajuste automático do terreno (src/lib/car/sobreposicao.ts).
//
// useSobreposicaoCar: consulta os vizinhos quando o serviço abre (e de novo se o
// perímetro sair da caixa já consultada), cruza e, se o imóvel invade algum,
// devolve o perímetro ajustado — Car.tsx aplica sozinho e avisa.
// CartaoSobreposicao: o quadro "Sobreposição com vizinhos" do painel.
import { useEffect, useMemo, useRef, useState } from "react";
import { ajustarSobreposicao } from "../../lib/car/sobreposicao.ts";
import type { AjusteSobreposicao, ItemSobreposicao } from "../../lib/car/sobreposicao.ts";
import { dentroDaCaixa, motivosIncompleta, vizinhosReais } from "../../lib/car/vizinhos.ts";
import type { FonteVizinhos, VizinhosDoCar } from "../../lib/car/vizinhos.ts";
import { fmtHa, fmtNum } from "../../lib/car/motor.ts";
import type { ProjetoCar } from "../../lib/car/motor.ts";
import { Dica } from "../ui";

export interface EstadoVizinhos { carregando: boolean; dados: VizinhosDoCar | null; erro: string | null }

export function useSobreposicaoCar(projeto: ProjetoCar | null, uf: string | null, fonte: FonteVizinhos = vizinhosReais) {
  const [st, setSt] = useState<EstadoVizinhos>({ carregando: false, dados: null, erro: null });
  const [versao, setVersao] = useState(0);
  const perimetro = projeto?.perimetro;
  const dadosRef = useRef<VizinhosDoCar | null>(null);
  dadosRef.current = st.dados;
  const forcar = useRef(false);
  // nova consulta só se o perímetro saiu da caixa já consultada (o ajuste não sai)
  const precisa = !!perimetro && perimetro.length >= 3 && (!st.dados || !dentroDaCaixa(perimetro, st.dados.caixa));
  const chave = precisa ? JSON.stringify(perimetro!.map((p) => [Math.round(p[0] * 1e5), Math.round(p[1] * 1e5)])) : "";

  useEffect(() => {
    if (!perimetro || perimetro.length < 3) return;
    if (!precisa && !forcar.current) return;
    forcar.current = false;
    let vivo = true;
    setSt((s) => ({ ...s, carregando: true, erro: null }));
    const t = setTimeout(() => {
      fonte(perimetro, uf)
        .then((d) => { if (vivo) setSt({ carregando: false, dados: d, erro: null }); })
        .catch((e) => { if (vivo) setSt((s) => ({ carregando: false, dados: s.dados, erro: e instanceof Error ? e.message : String(e) })); });
    }, 400);
    return () => { vivo = false; clearTimeout(t); };
  }, [chave, versao]); // eslint-disable-line react-hooks/exhaustive-deps

  const reg = projeto?.sobreposicao;
  const ajuste: AjusteSobreposicao | null = useMemo(() => {
    if (!perimetro || perimetro.length < 3 || !st.dados) return null;
    try {
      return ajustarSobreposicao(perimetro, st.dados.vizinhos, { ignorar: reg?.ignorar, forcar: reg?.forcar, nomesVertices: projeto?.nomesVertices });
    } catch { return null; }
  }, [perimetro, st.dados, reg?.ignorar, reg?.forcar]); // eslint-disable-line react-hooks/exhaustive-deps

  return { ...st, ajuste, deNovo: () => { forcar.current = true; setVersao((v) => v + 1); } };
}

const fmtArea = (m2: number) => (m2 >= 10_000 ? fmtHa(m2) : `${fmtNum(m2, m2 < 10 ? 2 : 0)} m²`);
const rotuloFonte = (f: ItemSobreposicao["fonte"]) => (f === "car" ? "CAR declarado (SICAR)" : "parcela certificada (SIGEF)");

export function CartaoSobreposicao({ estado, ajuste, projeto, fator, onDesfazer, onRecortar, onDeNovo, travado = false, onAplicar }: {
  estado: EstadoVizinhos;
  ajuste: AjusteSobreposicao | null;
  projeto: ProjetoCar;
  /** área na base escolhida ÷ área no plano (res.fatorArea) */
  fator: number;
  onDesfazer: () => void;
  onRecortar: (codigo: string) => void;
  onDeNovo: () => void;
  /** CAR já exportado: o ajuste NÃO é aplicado sozinho, só pelo botão */
  travado?: boolean;
  onAplicar?: () => void;
}) {
  const reg = projeto.sobreposicao;
  const ajustado = !!reg?.original && reg.cortes.length > 0;
  const pendentes = (ajuste?.itens ?? []).filter((i) => i.decisao !== "cortado" && i.decisao !== "proprio");
  const proprios = (ajuste?.itens ?? []).filter((i) => i.decisao === "proprio");
  const n = estado.dados?.vizinhos.length ?? 0;
  // sem todas as bases (ou com resposta parcial) não dá para dizer "livre"
  const motivos = motivosIncompleta(estado.dados);
  const incompleta = motivos.length > 0;
  const aCortar = travado ? (ajuste?.perimetro ? ajuste.itens.filter((i) => i.decisao === "cortado") : []) : [];
  const tom = pendentes.length || aCortar.length ? "alerta" : incompleta ? "alerta" : ajustado ? "ajustado" : estado.dados ? "livre" : "";

  let resumo: string;
  if (estado.carregando && !estado.dados) resumo = "consultando os CAR do SICAR e o SIGEF…";
  else if (estado.erro && !estado.dados) resumo = `não deu para consultar: ${estado.erro}`;
  else if (pendentes.length || aCortar.length) resumo = `${pendentes.length + aCortar.length} sobreposição(ões) para conferir`;
  else if (ajustado) resumo = incompleta ? "ajustado nos vizinhos encontrados — mas a consulta veio incompleta" : "ajustado: o terreno não sobrepõe mais ninguém";
  else if (estado.dados) resumo = incompleta ? "consulta incompleta: não dá para dizer que está livre" : `sem sobreposição (${n} vizinho${n === 1 ? "" : "s"} conferido${n === 1 ? "" : "s"})`;
  else resumo = "";

  return (
    <section className={`car-cartao car-sobreposicao ${tom}`} id="car-sobreposicao">
      <header>
        <h3>Sobreposição com vizinhos<Dica>
          O perímetro é cruzado com os CAR já inscritos no SICAR e com as parcelas certificadas do SIGEF — o que o SEIA e o
          SICAR conferem quando o CAR chega. Se o imóvel invade um vizinho, o sistema recorta o terreno pela divisa dele
          (com 10 cm de folga, para o SICAR não ler a divisa comum como sobreposição) e avisa. O CAR que cobre o mesmo
          terreno (o deste imóvel já inscrito, numa retificação) e o vizinho que levaria mais da metade do imóvel não são
          recortados sozinhos: ficam aqui para você decidir.
        </Dica></h3>
        {estado.carregando && <span className="spinner" aria-label="consultando" />}
      </header>
      <p className="car-sob-resumo">{resumo}</p>

      {ajustado && reg && (
        <div className="car-sob-ajuste" role="status">
          <b>Deu sobreposição, mas ajustamos o terreno.</b>
          <ul>
            {reg.cortes.map((c) => (
              <li key={`${c.fonte}:${c.codigo}`}><span className="car-sob-cod">{c.rotulo}</span> <small>{rotuloFonte(c.fonte)}</small> — {fmtArea(c.areaM2 * fator)} saíram do imóvel</li>
            ))}
          </ul>
          <p>Área total: {fmtHa(reg.antesM2 * fator)} → <b>{fmtHa(reg.depoisM2 * fator)}</b>. No mapa, o pedaço tirado está hachurado em vermelho.</p>
          <div className="car-botoes">
            <button className="fantasma" onClick={onDesfazer} title="Volta ao perímetro do arquivo, com a sobreposição">Desfazer ajuste</button>
          </div>
        </div>
      )}

      {aCortar.length > 0 && (
        <div className="car-sob-item" role="status">
          <p>
            <b>Este CAR já foi exportado</b>, então o terreno não é mexido sozinho. A consulta achou sobreposição com{" "}
            {aCortar.map((i, k) => <span key={`${i.fonte}:${i.codigo}`}>{k ? ", " : ""}<span className="car-sob-cod">{i.rotulo}</span> ({fmtArea(i.areaM2 * fator)})</span>)}.
            Se recortar, baixe os shapefiles de novo.
          </p>
          <div className="car-botoes"><button onClick={onAplicar}>Recortar o terreno agora</button></div>
        </div>
      )}

      {proprios.map((i) => (
        <p key={`${i.fonte}:${i.codigo}`} className="car-sob-proprio">
          Este imóvel já {i.fonte === "car" ? "tem CAR no SICAR" : "está certificado no SIGEF"}: <span className="car-sob-cod">{i.rotulo}</span>{" "}
          <small>({i.situacao ?? ""}{i.situacao ? "; " : ""}{fmtNum(i.pctImovel, 1)}% do mesmo terreno)</small>. Não conta como sobreposição — numa retificação, é o próprio.
        </p>
      ))}

      {pendentes.map((i) => (
        <div key={`${i.fonte}:${i.codigo}`} className="car-sob-item">
          <p>
            <span className="car-sob-cod">{i.rotulo}</span> <small>{rotuloFonte(i.fonte)}{i.situacao ? ` · ${i.situacao}` : ""}</small><br />
            {i.decisao === "grande" && <>Sobrepõe {fmtArea(i.areaM2 * fator)} ({fmtNum(i.pctImovel, 1)}% do imóvel). Recortar levaria mais da metade do terreno — confira antes.</>}
            {i.decisao === "dentro" && <>Está inteiro dentro do imóvel ({fmtArea(i.areaM2 * fator)}). O recorte faria um buraco no meio, e o imóvel do CAR é um contorno só — confira o desenho.</>}
            {i.decisao === "inativo" && <>Sobrepõe {fmtArea(i.areaM2 * fator)} ({fmtNum(i.pctImovel, 2)}% do imóvel), mas o {i.fonte === "car" ? "CAR" : "registro"} está {i.situacao ?? "inativo"}. Não foi recortado sozinho — confira a situação antes de tirar terreno do cliente.</>}
            {i.decisao === "ignorado" && <>Sobrepõe {fmtArea(i.areaM2 * fator)} ({fmtNum(i.pctImovel, 2)}% do imóvel). Você desfez o ajuste: o SEIA/SICAR vai acusar.</>}
          </p>
          {i.decisao !== "dentro" && (
            <div className="car-botoes"><button onClick={() => onRecortar(i.codigo)}>Recortar este também</button></div>
          )}
        </div>
      ))}

      {incompleta && (
        <div className="car-sob-falha" role="alert">
          <ul>{motivos.map((m) => <li key={m}>{m}.</li>)}</ul>
          Pode haver sobreposição com algum imóvel que não veio — confira no SEIA/SICAR antes de enviar, ou consulte de novo.
        </div>
      )}
      {(estado.dados || estado.erro) && (
        <div className="car-sob-rodape">
          {estado.dados && <small>Consultado às {new Date(estado.dados.quando).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</small>}
          <button type="button" className="link" disabled={estado.carregando} onClick={onDeNovo}>consultar de novo</button>
        </div>
      )}
    </section>
  );
}
