// Laboratório do Medir no campo (#/lab/campo, só no npm run dev): a tela de
// verdade, sem login e sem GPS, com um trajeto gravado (lib/campo/
// trajeto_exemplo.ts) tocado como se fosse o celular andando no pasto.
//
// Cenas (#/lab/campo?cena=…): inicio · medindo · fechada · retomar · mao ·
// sem-gps · sem-permissao · lista-vazia · conta-fora · sem-tabela · conflito
// (a conta tem uma versão mais nova da medição deste aparelho).
// "&limpo" esconde o painel do laboratório (para as capturas).
//
// O aparelho do laboratório grava com o prefixo "lab:" no localStorage (não
// mistura com as medições de verdade). "Fechar a página e voltar" desmonta a
// tela e monta de novo: o que estava gravado no aparelho reaparece na retomada.
import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AppShell } from "../AppShell";
import { avisar } from "../ui";
import { Campo } from "./Campo";
import { rotaParaHash } from "../../lib/rota";
import type { Rota } from "../../lib/rota";
import { pegarAreaTransferida } from "../../lib/area_transferida";
import { CHAVE_APARELHO, gravarAparelho, guardarMedicao, novoId } from "../../lib/campo/aparelho.ts";
import type { Armazem } from "../../lib/campo/aparelho.ts";
import { criarSimulador, fonteComErro } from "../../lib/campo/gps.ts";
import type { FonteGps } from "../../lib/campo/gps.ts";
import { verticeAoCaminhar } from "../../lib/campo/motor.ts";
import { repositorioMemoria } from "../../lib/campo/repositorio.ts";
import type { TipoErroConta } from "../../lib/campo/repositorio.ts";
import { CANTOS_EXEMPLO, TRAJETO_EXEMPLO } from "../../lib/campo/trajeto_exemplo.ts";
import { OPCOES_PADRAO } from "../../lib/campo/tipos.ts";
import type { Medicao, VerticeCampo } from "../../lib/campo/tipos.ts";

const CENAS = ["inicio", "medindo", "fechada", "retomar", "mao", "sem-gps", "sem-permissao", "lista-vazia", "conta-fora", "sem-tabela", "conflito"] as const;
type Cena = typeof CENAS[number];

const parametros = () => new URLSearchParams(location.hash.split("?")[1] ?? "");

const armazemLab: Armazem = {
  getItem: (k) => { try { return localStorage.getItem(`lab:${k}`); } catch { return null; } },
  setItem: (k, v) => { localStorage.setItem(`lab:${k}`, v); },
  removeItem: (k) => { try { localStorage.removeItem(`lab:${k}`); } catch { /* sem storage */ } },
};

/** A medição que o modo Caminhar faria com as primeiras `ate` leituras do trajeto. */
function medicaoAndando(ate: number, nome: string, inicio: Date): Medicao {
  const vs: VerticeCampo[] = [];
  for (const l of TRAJETO_EXEMPLO.slice(0, ate)) {
    const r = verticeAoCaminhar(vs, l, OPCOES_PADRAO);
    if (r) vs.push(r.vertice);
  }
  const iso = inicio.toISOString();
  return { id: novoId(), nome, criadaEm: iso, atualizadaEm: new Date(inicio.getTime() + ate * 1000).toISOString(), vertices: vs, fechada: false };
}

/** As medições "da conta" do laboratório (outro aparelho, outro dia). */
function medicoesDaConta(): Medicao[] {
  const ontem = new Date(); ontem.setDate(ontem.getDate() - 1); ontem.setHours(9, 10, 0, 0);
  const semana = new Date(); semana.setDate(semana.getDate() - 4); semana.setHours(15, 42, 0, 0);
  const desloca = (dx: number, dy: number, prec: number) => CANTOS_EXEMPLO.map(([lon, lat], i): VerticeCampo => ({
    lon: lon + dx, lat: lat + dy, precisao: prec + (i % 3) * 0.4, t: ontem.getTime() + i * 60000, modo: "ponto", leituras: 5,
  }));
  return [
    { id: "a0c1e6d2-0000-4000-8000-000000000001", nome: "Pasto do Sr. João (cerca nova)", criadaEm: ontem.toISOString(), atualizadaEm: ontem.toISOString(), vertices: desloca(0.0042, 0.0031, 2.8), fechada: true },
    { id: "a0c1e6d2-0000-4000-8000-000000000002", nome: "Orçamento Fazenda Rio Verde", criadaEm: semana.toISOString(), atualizadaEm: semana.toISOString(), vertices: desloca(-0.0061, -0.0012, 4.1).slice(0, 5), fechada: true },
  ];
}

function prepararCena(cena: Cena): { abrir?: Medicao; inicioTrajeto: number; conta?: Medicao[] } {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith("lab:")) localStorage.removeItem(k);
  } catch { /* sem storage */ }
  const hoje = new Date(); hoje.setHours(14, 32, 0, 0);
  if (cena === "medindo") return { abrir: medicaoAndando(330, "Medição 06/11 14:32", hoje), inicioTrajeto: 330 };
  if (cena === "fechada") {
    const m = medicaoAndando(TRAJETO_EXEMPLO.length, "Pasto da sede", hoje);
    return { abrir: { ...m, fechada: true }, inicioTrajeto: TRAJETO_EXEMPLO.length - 1 };
  }
  if (cena === "retomar") {
    const m = medicaoAndando(260, "Medição 06/11 14:32", hoje);
    gravarAparelho(armazemLab, guardarMedicao({ atualId: null, registros: {} }, m, true));
    return { inicioTrajeto: 260 };
  }
  if (cena === "conflito") {
    // o celular mediu e não enviou; enquanto isso o escritório renomeou a mesma medição
    const m = { ...medicaoAndando(TRAJETO_EXEMPLO.length, "Pasto da sede", hoje), fechada: true };
    const doEscritorio = { ...m, nome: "Pasto da sede (renomeada no escritório)", vertices: m.vertices.slice(0, 8), atualizadaEm: new Date(Date.parse(m.atualizadaEm) + 3_600_000).toISOString() };
    return { abrir: m, inicioTrajeto: TRAJETO_EXEMPLO.length - 1, conta: [doEscritorio, ...medicoesDaConta()] };
  }
  return { inicioTrajeto: 0 };
}

export function LaboratorioCampo() {
  const p = parametros();
  const cena = (CENAS as readonly string[]).includes(p.get("cena") ?? "") ? (p.get("cena") as Cena) : "inicio";
  const limpo = p.has("limpo");
  const [preparo] = useState(() => prepararCena(cena));
  const [montagem, setMontagem] = useState(0);
  const [falhaConta, setFalhaConta] = useState<TipoErroConta | null>(cena === "conta-fora" ? "outro" : cena === "sem-tabela" ? "sem-tabela" : null);

  const sim = useMemo(() => {
    const s = criarSimulador(TRAJETO_EXEMPLO, 1000);
    s.irPara(preparo.inicioTrajeto);
    return s;
  }, [preparo]);
  const est = useSyncExternalStore(sim.assinar, sim.estado, sim.estado);

  const fonte: FonteGps = useMemo(
    () => (cena === "sem-gps" ? fonteComErro("indisponivel") : cena === "sem-permissao" ? fonteComErro("sem-permissao") : sim),
    [cena, sim],
  );
  // a falha é lida na hora de cada chamada: "conta volta" sem recriar a conta
  const falhaRef = useRef(falhaConta);
  falhaRef.current = falhaConta;
  const repo = useMemo(
    () => repositorioMemoria(cena === "lista-vazia" ? [] : preparo.conta ?? medicoesDaConta(), { falha: () => falhaRef.current, demoraMs: 300 }),
    [cena, preparo],
  );

  function ir(r: Rota) {
    // o CAR e a Consulta recebem a área pelo mesmo canal (lib/area_transferida.ts)
    const a = pegarAreaTransferida();
    avisar("ok", `Laboratório: iria para ${rotaParaHash(r)}${a ? ` com "${a.nome}" (${a.perimetro.length} vértices · ${a.origem})` : ""}.`);
    if (a) console.info("[lab campo] área levada:", a);
  }

  return (
    <AppShell rota={{ t: "campo" }} ir={() => {}} usuario={{ nome: "Laboratório", papel: "Dono" }}>
      <Campo key={montagem} ir={ir} fonte={fonte} repositorio={repo} armazem={armazemLab}
        abrir={montagem === 0 ? preparo.abrir : undefined} ligarGps={cena !== "mao"} />
      {!limpo && (
        <details className="campo-lab" open={false}>
          <summary>Laboratório · GPS simulado</summary>
          <div className="campo-lab-corpo">
            <span className="campo-lab-pos">Leitura {est.indice + 1} de {est.total}{est.tocando ? ` · tocando ${est.velocidade}×` : " · parado"}</span>
            <div className="campo-lab-linha">
              {est.tocando
                ? <button type="button" onClick={() => sim.pausar()}>⏸ Pausar</button>
                : <button type="button" className="principal" onClick={() => sim.tocar()}>▶ Tocar trajeto</button>}
              <button type="button" onClick={() => sim.avancar(10)}>+10 leituras</button>
              <select value={est.velocidade} onChange={(e) => sim.velocidade(Number(e.target.value))} aria-label="Velocidade">
                {[1, 4, 10, 30].map((v) => <option key={v} value={v}>{v}×</option>)}
              </select>
            </div>
            <div className="campo-lab-linha">
              <button type="button" onClick={() => sim.piorar(est.piora > 1 ? 1 : 4)}>{est.piora > 1 ? "Sinal normal" : "Sinal ruim (×4)"}</button>
              <button type="button" onClick={() => sim.irPara(Math.round(TRAJETO_EXEMPLO.length * 0.66))}>Ir para as árvores</button>
              <button type="button" onClick={() => setMontagem((m) => m + 1)}>Fechar a página e voltar</button>
            </div>
            <div className="campo-lab-linha">
              <button type="button" onClick={() => setFalhaConta((f) => (f ? null : "sem-rede"))}>{falhaConta ? "Conta volta" : "Cortar a internet"}</button>
              <button type="button" onClick={() => { try { localStorage.removeItem(`lab:${CHAVE_APARELHO}`); } catch { /* */ } setMontagem((m) => m + 1); }}>Limpar o aparelho</button>
            </div>
            <div className="campo-lab-cenas">
              {CENAS.map((c) => <a key={c} href={`#/lab/campo?cena=${c}`} onClick={() => setTimeout(() => location.reload(), 0)} aria-current={c === cena || undefined}>{c}</a>)}
            </div>
          </div>
        </details>
      )}
    </AppShell>
  );
}
