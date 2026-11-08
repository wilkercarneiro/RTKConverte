// O painel "Precisão" do Medir no campo: o que faz o GPS errar menos.
//  • Calibrar num marco — o deslocamento medido sobre um ponto conhecido (vértice
//    certificado do SIGEF, marco do IBGE, coordenada digitada) sai de todos os
//    vértices (lib/campo/calibracao.ts);
//  • Receptor RTK — o receptor GNSS do agrimensor pelo Bluetooth (o painel do
//    receptor entra aqui como `receptor`);
//  • Dicas — o que pesa no GPS do celular e não depende do sistema;
//  • Diagnóstico — grava todas as leituras para medir a precisão de verdade.
import { useState } from "react";
import type { ReactNode } from "react";
import { consultarSigef } from "../../lib/sigef";
import { lerCoordenadaMarco, marcosProximos, textoDeslocamento, calibracaoSuspeita, CALIBRACAO_VALIDA_MS } from "../../lib/campo/calibracao.ts";
import type { MarcoProximo } from "../../lib/campo/calibracao.ts";
import { deslocar, textoDistancia, textoPrecisao } from "../../lib/campo/geometria.ts";
import type { Calibracao, Leitura, LonLat } from "../../lib/campo/tipos.ts";
import { Dica, Gaveta } from "../ui";

export type AbaPrecisao = "calibrar" | "receptor" | "dicas" | "diagnostico";

export interface PropsPrecisao {
  aba: AbaPrecisao;
  onAba: (a: AbaPrecisao) => void;
  onFechar: () => void;
  leitura: Leitura | null;
  /** há medição aberta para receber a calibração */
  temMedicao: boolean;
  calibracoes: Calibracao[];
  marcos: MarcoProximo[];
  onMarcos: (m: MarcoProximo[]) => void;
  escolhido: number | null;
  onEscolher: (i: number | null) => void;
  /** começa a ocupação sobre o marco */
  onCalibrar: (marco: { lon: number; lat: number; rotulo: string }) => void;
  onRemoverCalibracao: (id: string) => void;
  segundosCalibrar: number;
  diagnostico: { ligado: boolean; leituras: number };
  onDiagnostico: (ligar: boolean) => void;
  onBaixarDiagnostico: () => void;
  onApagarDiagnostico: () => void;
  /** o painel do receptor (Bluetooth + correção NTRIP) */
  receptor?: ReactNode;
}

const ABAS: { k: AbaPrecisao; t: string }[] = [
  { k: "calibrar", t: "Calibrar" },
  { k: "receptor", t: "Receptor RTK" },
  { k: "dicas", t: "Dicas" },
  { k: "diagnostico", t: "Diagnóstico" },
];

export function PainelPrecisao(p: PropsPrecisao) {
  return (
    <Gaveta olho="Medir no campo" titulo="Precisão do GPS" onFechar={p.onFechar}>
      <div className="campo-abas" role="tablist" aria-label="Precisão">
        {ABAS.map((a) => (
          <button key={a.k} type="button" role="tab" aria-selected={p.aba === a.k} className={p.aba === a.k ? "ativa" : ""} onClick={() => p.onAba(a.k)}>{a.t}</button>
        ))}
      </div>
      {p.aba === "calibrar" && <AbaCalibrar {...p} />}
      {p.aba === "receptor" && (p.receptor ?? <AjudaReceptor />)}
      {p.aba === "dicas" && <Dicas />}
      {p.aba === "diagnostico" && <AbaDiagnostico {...p} />}
    </Gaveta>
  );
}

// ---------------------------------------------------------------- calibrar

function AbaCalibrar(p: PropsPrecisao) {
  const [buscando, setBuscando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [buscou, setBuscou] = useState(false);
  const [texto, setTexto] = useState("");
  const [erroTexto, setErroTexto] = useState<string | null>(null);
  const aqui = p.leitura;

  async function buscar() {
    if (!aqui) return;
    setBuscando(true); setErro(null);
    try {
      // um quadradinho no lugar e o raio de 500 m: as parcelas da base em volta
      const q = (x: number, y: number) => deslocar([aqui.lon, aqui.lat], x, y) as LonLat;
      const anel = [q(-5, -5), q(5, -5), q(5, 5), q(-5, 5), q(-5, -5)];
      const r = await consultarSigef([anel], { raioM: 500 });
      const ms = marcosProximos(r.parcelas, aqui, 500);
      p.onMarcos(ms);
      p.onEscolher(ms.length ? 0 : null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setBuscando(false); setBuscou(true);
    }
  }

  function usarDigitado() {
    const r = lerCoordenadaMarco(texto);
    if ("erro" in r) { setErroTexto(r.erro); return; }
    setErroTexto(null);
    p.onCalibrar({ ...r, rotulo: "Marco digitado" });
  }

  const marco = p.escolhido != null ? p.marcos[p.escolhido] : null;
  const ultima = p.calibracoes.length ? [...p.calibracoes].sort((a, b) => b.t - a.t)[0] : null;
  const velha = ultima && Date.now() - ultima.t > CALIBRACAO_VALIDA_MS;

  return (
    <div className="campo-precisao">
      <p className="campo-sub">
        Pare em cima de um ponto de coordenada conhecida e o sistema mede quanto o GPS do celular está errando agora.
        Esse erro sai de todos os vértices da medição.
        <Dica>
          O erro do GPS do celular muda devagar: numa medição de até uns 30 minutos, a poucas centenas de metros do marco, ele é quase o mesmo.
          Por isso a correção funciona. Ela não tira o erro de reflexo de cada canto (árvore, parede). Com dois marcos, um no começo e outro no fim,
          o sistema divide a correção ao longo do tempo.
        </Dica>
      </p>
      {!p.temMedicao && <p className="campo-nota">Comece uma medição (Caminhar, Marcar ponto ou Desenhar) para calibrar.</p>}

      <section className="campo-precisao-bloco">
        <b>Vértices certificados do SIGEF por perto</b>
        {!aqui ? <span className="campo-sub">Esperando a posição do GPS…</span> : (
          <button type="button" onClick={() => void buscar()} disabled={buscando}>{buscando ? "Procurando…" : buscou ? "Procurar de novo" : "Procurar marcos em 500 m"}</button>
        )}
        {erro && <p className="campo-alerta" role="alert">Não deu para buscar as parcelas ({erro}).</p>}
        {buscou && !buscando && !erro && !p.marcos.length && (
          <p className="campo-nota">Nenhum vértice SIGEF da base num raio de 500 m. A base tem as parcelas já consultadas pelo sistema; se o vizinho é certificado, digite a coordenada do marco abaixo.</p>
        )}
        {p.marcos.length > 0 && (
          <ul className="campo-marcos" aria-label="Marcos por perto">
            {p.marcos.slice(0, 8).map((m, i) => (
              <li key={`${m.lon},${m.lat}`}>
                <button type="button" className={p.escolhido === i ? "ativo" : ""} onClick={() => p.onEscolher(i)} aria-pressed={p.escolhido === i}>
                  <span>{m.rotulo}</span><small>a {textoDistancia(m.distM)}</small>
                </button>
              </li>
            ))}
          </ul>
        )}
        {marco && (
          <div className="campo-precisao-acao">
            <span className="campo-sub">Vá até o marco (ele aparece no mapa como alvo), pare com o celular em cima dele e toque em Calibrar. O sistema junta as leituras por {p.segundosCalibrar} s.</span>
            <button type="button" className="principal" disabled={!p.temMedicao || !aqui} onClick={() => p.onCalibrar(marco)}>Calibrar neste marco</button>
          </div>
        )}
      </section>

      <section className="campo-precisao-bloco">
        <b>Ou digite a coordenada do marco
          <Dica>Latitude e longitude em graus (-12,345678, -38,123456) ou UTM com o fuso (512345,67 8634567,89 24), em SIRGAS 2000. Pode ser um marco do IBGE ou um ponto que você levantou com o receptor.</Dica>
        </b>
        <form className="campo-ir-linha" onSubmit={(e) => { e.preventDefault(); usarDigitado(); }}>
          <input value={texto} onChange={(e) => { setTexto(e.target.value); setErroTexto(null); }} placeholder="lat, lon  ou  E N fuso" aria-label="Coordenada do marco" aria-invalid={!!erroTexto || undefined} />
          <button type="submit" disabled={!texto.trim() || !p.temMedicao}>Calibrar aqui</button>
        </form>
        {erroTexto && <span className="campo-ir-erro" role="alert">{erroTexto}</span>}
      </section>

      {p.calibracoes.length > 0 && (
        <section className="campo-precisao-bloco">
          <b>Calibrações desta medição</b>
          <ul className="campo-calibracoes">
            {[...p.calibracoes].sort((a, b) => a.t - b.t).map((c) => (
              <li key={c.id}>
                <span>
                  <b>{c.rotulo}</b>
                  <small>{new Date(c.t).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} · o GPS estava {textoDeslocamento({ dE: -c.dE, dN: -c.dN })} · {c.medido.leituras} leituras, {textoPrecisao(c.medido.precisao)}</small>
                  {calibracaoSuspeita(c) && <small className="campo-alerta">Deslocamento grande: confira se é o marco certo.</small>}
                </span>
                <button type="button" className="fantasma" onClick={() => p.onRemoverCalibracao(c.id)}>Tirar</button>
              </li>
            ))}
          </ul>
          {velha && <p className="campo-nota">A última calibração tem mais de 30 minutos: o erro do celular já mudou. Calibre de novo num marco antes de terminar.</p>}
        </section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- dicas

function Dicas() {
  return (
    <div className="campo-precisao campo-dicas">
      <section className="campo-precisao-bloco">
        <b>No celular</b>
        <ul>
          <li><b>Android:</b> Configurações → Localização → <i>Precisão da localização do Google</i> ligada, e a busca por Wi-Fi e Bluetooth ligadas.</li>
          <li><b>Economia de bateria desligada</b> enquanto mede: ela troca o GPS pela rede e piora tudo.</li>
          <li><b>iPhone:</b> Ajustes → Privacidade → Serviços de Localização → Safari → <i>Durante o uso</i> e <i>Localização precisa</i> ligada.</li>
        </ul>
      </section>
      <section className="campo-precisao-bloco">
        <b>No campo</b>
        <ul>
          <li>Segure o celular <b>deitado e acima da cabeça</b> (ou preso num bastão). O corpo tapa metade do céu.</li>
          <li>Longe de <b>copa de árvore, beiral, parede e cerca de arame</b>: o sinal bate e volta (reflexo) e o ponto pula metros.</li>
          <li>Nos cantos que importam, <b>fique parado mais tempo</b>: o erro do celular muda devagar. 20 s é o mínimo; 1 a 3 minutos é bem melhor.</li>
          <li>Ao ligar, espere o GPS <b>aquecer</b> (o selo mostra). As primeiras posições vêm da rede e saem deslocadas.</li>
          <li>Celular com GPS de <b>duas frequências (L1 + L5)</b> erra bem menos sob árvore e perto de construção (Pixel 5 em diante, Galaxy S2x, vários Xiaomi).</li>
        </ul>
      </section>
      <section className="campo-precisao-bloco">
        <b>O que o número quer dizer</b>
        <p className="campo-sub">"±3 m" é o raio onde ficam 2 de cada 3 leituras (68%). O sistema também mostra o raio de 95% ("até ±4,9 m"), que é o que o técnico usa. O celular sozinho não chega ao SIGEF (0,50 m no limite artificial): para isso, use um receptor RTK (aba Receptor RTK).</p>
      </section>
    </div>
  );
}

/** Ajuda do receptor quando o painel de conexão não está disponível (fallback). */
export function AjudaReceptor({ semConexaoDireta = false }: { semConexaoDireta?: boolean }) {
  return (
    <div className="campo-precisao campo-dicas">
      {semConexaoDireta && (
        <p className="campo-nota">Este navegador não liga o receptor direto (no iPhone, o Safari não tem Bluetooth para sites). Use um dos caminhos abaixo.</p>
      )}
      <section className="campo-precisao-bloco">
        <b>Android: o receptor no lugar do GPS do celular</b>
        <ol>
          <li>Pareie o receptor no Bluetooth do Android.</li>
          <li>Instale o <i>Lefebure NTRIP Client</i> ou o <i>GNSS Master</i> (Play Store). Configure o receptor e a correção (RBMC-IP do IBGE é gratuita; outra rede que você assine também serve).</li>
          <li>Opções do desenvolvedor → <i>Selecionar app de local fictício</i> → escolha o app do passo 2.</li>
          <li>Abra o Vertces: o Medir no campo passa a receber a posição do receptor (o selo mostra a precisão em centímetros).</li>
        </ol>
      </section>
      <section className="campo-precisao-bloco">
        <b>iPhone: receptor certificado pela Apple (MFi)</b>
        <p className="campo-sub">Receptores MFi (Emlid Reach RX2, Bad Elf, EOS Arrow, Trimble R1/R2, entre outros) entregam a posição para o iPhone inteiro. Ligue o receptor pelo app do fabricante e abra o Vertces no Safari.</p>
      </section>
      <p className="campo-nota">Nestes dois caminhos o sistema recebe só a posição e a precisão, sem saber se a solução é RTK fixo. Para marcar vértice "apto para SIGEF", ligue o receptor direto pela aba Receptor RTK (Chrome no Android).</p>
    </div>
  );
}

// ---------------------------------------------------------------- diagnóstico

function AbaDiagnostico(p: PropsPrecisao) {
  return (
    <div className="campo-precisao">
      <p className="campo-sub">
        Grava todas as leituras do GPS, do jeito que chegam, neste aparelho. Serve para medir a precisão de verdade:
        pare 10 minutos em cima de um marco SIGEF conhecido e ande o contorno de uma área já certificada. Depois baixe o arquivo e mande para o suporte.
      </p>
      <label className="campo-chave">
        <input type="checkbox" checked={p.diagnostico.ligado} onChange={(e) => p.onDiagnostico(e.target.checked)} />
        <span>Gravar as leituras do GPS</span>
      </label>
      <p className="campo-sub">{p.diagnostico.leituras.toLocaleString("pt-BR")} leituras gravadas neste aparelho.</p>
      <div className="campo-acoes-linha">
        <button type="button" disabled={!p.diagnostico.leituras} onClick={p.onBaixarDiagnostico}>Baixar (JSON)</button>
        <button type="button" className="fantasma" disabled={!p.diagnostico.leituras} onClick={p.onApagarDiagnostico}>Apagar</button>
      </div>
    </div>
  );
}
