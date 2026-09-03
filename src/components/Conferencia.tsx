// Tela de conferência (5.2): dados do serviço, confrontantes (+ mapa SVG),
// vértices e preview fixo no rodapé. O banco é a fonte da verdade;
// "Gerar documentos" salva e chama a Edge Function gerar-documentos.
//
// Experiência: só os campos que bloqueiam a geração ficam sempre visíveis; o
// resto vive em seções recolhíveis com selo de preenchimento. O cartão de
// próxima ação diz em uma frase o que falta, e o trabalho é salvo sozinho.
import { Fragment, useEffect, useMemo, useState } from "react";
import { chamarFuncao, supabase } from "../lib/supabase";
import {
  LADOS, METODOS_POSICIONAMENTO, NATUREZAS_AREA, NATUREZAS_SERVICO,
  rotuloRT, SITUACOES, TIPOS_LIMITE, TIPOS_PESSOA, UFS,
} from "../lib/domains";
import { calcularPreviewLocal } from "../lib/preview";
import { ehRioPorLimite, ehViaPorLimite, moverConfrontacao, numerarConfrontantes, SEM_CONFRONTACAO, trechoDoVertice, viasDaPlanta } from "../lib/trechos";
import { reordenarVertices } from "../lib/ordem";
import type { DestinoOrdem } from "../lib/ordem";
import {
  camposDaSituacao, chaveDoServico, pedeMatricula, rotuloCurto, situacaoDoImovel, vaiAoSigef,
} from "../lib/modalidades";
import type { SituacaoImovel } from "../lib/modalidades";
import { areaHaDoAnel, GlebasEditor } from "./GlebasEditor";
import { partesDasGlebas } from "../lib/glebas";
import type { Gleba } from "../lib/types";
import { contarPreenchidos, inferirUf, useAutosave, useAvisos } from "../lib/ux";
import type { Cliente, Credenciado, RT, Servico, Trecho, Vertice } from "../lib/types";
import type { ResultadoParse } from "./Upload";
import { CORES, MapaSVG } from "./MapaSVG";
import { HistoricoDocs } from "./HistoricoDocs";
import { Avisos, BotaoPerigo, Passos, ProximaAcao, Secao, StatusSalvamento, irPara as rolarAte, type Acao, type Passo } from "./ui";

/** Etapas do serviço: uma por vez, como abas dentro do cabeçalho. */
type Etapa = "dados" | "confrontantes" | "glebas" | "documentos";

/** Em que etapa mora um elemento — para as pendências e a próxima ação levarem
 *  o operador até o campo certo mesmo quando ele está em outra aba. */
function etapaDoAlvo(id: string): Etapa {
  if (id.startsWith("campo-") || id === "bloco-dados") return "dados";
  if (id === "bloco-confrontantes") return "confrontantes";
  if (id === "bloco-vertices") return "confrontantes";   // os vértices moram na mesma etapa dos confrontantes
  if (id === "bloco-glebas") return "glebas";
  return "documentos";
}

interface Gerado {
  memorial_docx: string;
  planilha_ods: string;
  // planta da etapa pré-SIGEF: sai do mesmo cálculo do memorial e da planilha
  planta_pdf?: string | null;
  folha?: string;
  avisos?: string[];
  resumo: { areaHa: number; perimetroM: number; qtdM: number; qtdP: number; qtdV: number; verticeInicial: string };
}

interface PecasGeradas {
  arquivos: { titulo: string; url: string }[];
  resumo: { areaHa: string; perimetro: string; trt: string; vertices: number; cartas: number; via: string | null };
}

interface RelatorioSobreposicao {
  parcelas: { nome: string; areaSobrepostaM2: number; status: "corrigida" | "mesma_gleba" | "interna" | "sem_sobreposicao" }[];
  avisos: string[];
  areaAntesHa: number;
  areaDepoisHa: number;
  totalVertices?: number;
  mantidos?: number;
  removidos: string[];
  novos: string[];
  /** Vértices certificados do vizinho que passaram a descrever a divisa (códigos). */
  compartilhados?: string[];
  /** Quantos vértices nossos foram igualados a um certificado (subconjunto). */
  igualados?: number;
}

const STATUS_PARCELA: Record<RelatorioSobreposicao["parcelas"][number]["status"], { rotulo: string; cor: string }> = {
  corrigida: { rotulo: "corrigida", cor: "#3cb44b" },
  sem_sobreposicao: { rotulo: "sem sobreposição", cor: "#888" },
  mesma_gleba: { rotulo: "mesma gleba já certificada — exige retificação no SIGEF", cor: "#e6194b" },
  interna: { rotulo: "parcela interna — exigiria anel interno", cor: "#f58231" },
};

function bufParaBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

export function Conferencia({ inicial, onVoltar }: { inicial: ResultadoParse; onVoltar: () => void }) {
  const [servico, setServico] = useState<Servico>(inicial.servico);
  // Fonte única da verdade: a confrontação vive no próprio vértice M. Não existe
  // estado paralelo de trechos para sair de sincronia. Ver ARQUITETURA-TRECHOS.md.
  const [vertices, setVertices] = useState<Vertice[]>(inicial.vertices);
  const [credenciados, setCredenciados] = useState<Credenciado[]>([]);
  const [rts, setRts] = useState<RT[]>([]);
  const [detentores, setDetentores] = useState<{ nome: string; cpf: string }[]>([]);
  const [cartorios, setCartorios] = useState<string[]>([]);
  // pares município/UF já usados: alimenta a sugestão automática de UF
  const [acervo, setAcervo] = useState<{ municipio: string | null; uf: string | null }[]>([]);
  const [novoV, setNovoV] = useState({ aposOrdem: "", codigo: "", lat: "", lon: "", h: "", sigmaH: "0,02" });
  const [erro, setErro] = useState<string | null>(null);
  const [gerado, setGerado] = useState<Gerado | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [rtExtras, setRtExtras] = useState({ formacao: "", conselho_sigla: "CFTA", conselho_numero: "", identidade: "", cpf: "" });
  const [pecas, setPecas] = useState<PecasGeradas | null>(null);
  const [gerandoPecas, setGerandoPecas] = useState(false);
  const [erroPecas, setErroPecas] = useState<string | null>(null);
  const [plantaUrl, setPlantaUrl] = useState<string | null>(null);
  const [gerandoPlanta, setGerandoPlanta] = useState(false);
  // Folha da planta (A1/A3): escolha do operador antes de gerar. Sem escolha vale
  // a regra histórica (posse → A3, matrícula → A1). Não é gravada no serviço.
  const [folhaPlanta, setFolhaPlanta] = useState<"A1" | "A3" | null>(null);
  const folhaEfetiva: "A1" | "A3" = folhaPlanta ?? (servico.tipo_imovel === "posse" ? "A3" : "A1");
  const [sigefB64, setSigefB64] = useState<string | null>(null);
  const [sigefNome, setSigefNome] = useState<string | null>(null);
  const [satelite, setSatelite] = useState<{ b64: string; tipo: "png" | "jpg"; nome: string } | null>(null);
  const [ufSugerida, setUfSugerida] = useState(false);
  // Modo de numeração dos confrontantes: só revela os checkboxes. O que fica
  // gravado é a marca por confrontante (`numerado`), não o modo — ligar e
  // desligar o botão não muda nada do que sai na planta.
  const [modoNumeracao, setModoNumeracao] = useState(false);

  // Uma etapa por vez. As pendências e a próxima ação apontam para ids de
  // elementos; como só a etapa ativa está montada, trocar de etapa vem antes
  // de rolar — e a rolagem espera o React montar o alvo.
  const [etapa, setEtapa] = useState<Etapa>("dados");
  const [alvoPendente, setAlvoPendente] = useState<{ id: string; piscar: boolean } | null>(null);
  useEffect(() => {
    if (!alvoPendente) return;
    const t = requestAnimationFrame(() => { rolarAte(alvoPendente.id, alvoPendente.piscar); setAlvoPendente(null); });
    return () => cancelAnimationFrame(t);
  }, [alvoPendente, etapa]);
  function irParaCampo(id: string, piscar = false) {
    setEtapa(etapaDoAlvo(id));
    setAlvoPendente({ id, piscar });
  }
  // CNS e matrícula do confrontante ficam resumidos numa linha; "editar campos"
  // abre os inputs do trecho (chave: ordem do vértice inicial).
  const [camposAbertos, setCamposAbertos] = useState<Set<number>>(() => new Set());
  const [mostrarInserirV, setMostrarInserirV] = useState(false);
  // Vértices marcados para reordenar em bloco (chave = id do vértice, que não
  // muda quando a ordem muda). `ultimoClicado` é a âncora do Shift+clique.
  const [selVert, setSelVert] = useState<Set<string>>(() => new Set());
  const [ultimoClicado, setUltimoClicado] = useState<number | null>(null);
  // Linhas da tabela de vértices abertas (código, método, coordenadas); a
  // tabela em si mostra só nº e rótulo, para caber ao lado do mapa.
  const [expandidos, setExpandidos] = useState<Set<string>>(() => new Set());
  const [previaAberta, setPreviaAberta] = useState(false);
  const [sobreAberto, setSobreAberto] = useState(false);

  // correção de sobreposição SIGEF (CSVs das parcelas certificadas sobrepostas)
  const [sobreCsvs, setSobreCsvs] = useState<{ nome: string; conteudo: string }[]>([]);
  const [afastamento, setAfastamento] = useState("0,50");
  // Divisa descrita pelos vértices certificados do vizinho (mesmo código e
  // coordenadas do CSV) em vez de pontos virtuais afastados. Ver
  // PLANO-VERTICES-CERTIFICADOS.md.
  const [usarCertificados, setUsarCertificados] = useState(true);
  const [tolIgualar, setTolIgualar] = useState("0,50");
  const [corrigindo, setCorrigindo] = useState(false);
  const [relatorioSobre, setRelatorioSobre] = useState<RelatorioSobreposicao | null>(null);

  const [clientes, setClientes] = useState<Cliente[]>([]);
  // glebas do serviço (só carregadas e salvas quando o serviço as tem)
  const [glebas, setGlebas] = useState<Gleba[]>([]);
  // o que ficou guardado no Storage de gerações anteriores (só os nomes)
  const [salvo, setSalvo] = useState<{ satelite?: { nome: string; tipo: "png" | "jpg" }; sigef?: string }>({});
  const [tabular, setTabular] = useState<{ titulo: string; url: string }[] | null>(null);
  const [gerandoTabular, setGerandoTabular] = useState(false);

  const { avisos, avisar, fechar } = useAvisos();
  // Serviço que nasceu unido a vértices certificados de vizinhos: os avisos da
  // união (código repetido, vértice longe do perímetro) aparecem uma vez, ao abrir.
  useEffect(() => {
    for (const a of inicial.preview.certificados?.avisos ?? []) avisar("alerta", a);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    supabase.from("credenciados").select().then(({ data }) => setCredenciados(data ?? []));
    supabase.from("responsaveis_tecnicos").select().then(({ data }) => setRts(data ?? []));
    supabase.from("clientes").select().order("nome").then(({ data }) => setClientes((data as Cliente[]) ?? []));
    // autocomplete a partir de serviços anteriores
    supabase.from("servicos").select("detentor_nome, detentor_cpf, cns, municipio, uf").neq("id", inicial.servico.id)
      .then(({ data }) => {
        const ds = new Map<string, string>();
        const cs = new Set<string>();
        for (const s of data ?? []) {
          if (s.detentor_nome) ds.set(s.detentor_nome, s.detentor_cpf ?? "");
          if (s.cns) cs.add(s.cns);
        }
        setDetentores([...ds.entries()].map(([nome, cpf]) => ({ nome, cpf })));
        setCartorios([...cs]);
        setAcervo(((data ?? []) as { municipio: string | null; uf: string | null }[]).map((s) => ({ municipio: s.municipio, uf: s.uf })));
      });
  }, [inicial.servico.id]);

  // Padrões das Configurações: um serviço novo já nasce com o RT e o
  // credenciado da empresa. Só preenche o que está vazio — nunca sobrescreve.
  useEffect(() => {
    if (inicial.servico.status !== "rascunho") return;
    if (inicial.servico.rt_id && inicial.servico.credenciado_id) return;
    supabase.from("config_empresa").select("key, value").in("key", ["rt_padrao", "credenciado_padrao"])
      .then(({ data }) => {
        const cfg = Object.fromEntries(((data ?? []) as { key: string; value: string }[]).map((l) => [l.key, l.value]));
        if (!cfg.rt_padrao && !cfg.credenciado_padrao) return;
        setServico((s) => ({
          ...s,
          rt_id: s.rt_id ?? (cfg.rt_padrao || null),
          credenciado_id: s.credenciado_id ?? (cfg.credenciado_padrao || null),
        }));
      });
  }, [inicial.servico.id]);

  // O que sobrou da última geração. Só a LISTA, não os arquivos: saber que a
  // imagem existe já permite gerar de novo sem pedir nada ao operador.
  useEffect(() => {
    supabase.storage.from("gerados").list(`${inicial.servico.id}/entrada`).then(({ data }) => {
      const achados: { satelite?: { nome: string; tipo: "png" | "jpg" }; sigef?: string } = {};
      for (const f of data ?? []) {
        if (f.name === "satelite.png") achados.satelite = { nome: f.name, tipo: "png" };
        else if (f.name === "satelite.jpg") achados.satelite = { nome: f.name, tipo: "jpg" };
        else if (f.name === "sigef.pdf") achados.sigef = f.name;
      }
      setSalvo(achados);
    });
  }, [inicial.servico.id]);

  // Glebas só são consultadas quando o serviço as tem: um serviço completo
  // comum não faz esta ida ao banco nem carrega estado que não vai usar.
  useEffect(() => {
    if (!inicial.servico.tem_glebas) return;
    supabase.from("glebas").select().eq("servico_id", inicial.servico.id).order("ordem")
      .then(({ data }) => setGlebas((data as Gleba[]) ?? []));
  }, [inicial.servico.id, inicial.servico.tem_glebas]);

  // etapa 1 concluída: documentos (ODS+DOCX) já gerados nesta sessão ou em sessão anterior
  const docsProntos = gerado !== null || servico.status === "gerado";

  // MODALIDADE. A conferência de área é prévia: para no memorial, não vai ao
  // SIGEF e não gera as 7 peças. Quem responde "até onde vai" é `vaiAoSigef`
  // (src/lib/modalidades.ts) — a MESMA função que a lista de serviços usa para
  // calcular o progresso, para que as duas telas nunca discordem.
  const ehConferencia = !vaiAoSigef(servico);
  const temGlebas = !!servico.tem_glebas;
  // "temos o PDF" inclui o que ficou guardado: reabrir o serviço não pode
  // esconder a planta e as peças só porque o arquivo não está na memória
  const temSigef = !!sigefB64 || !!salvo.sigef;
  const temSatelite = !!satelite || !!salvo.satelite;

  const credenciado = credenciados.find((c) => c.id === servico.credenciado_id) ?? null;
  const rtSel = rts.find((r) => r.id === servico.rt_id) ?? null;

  // carrega extras do RT quando o RT selecionado muda
  useEffect(() => {
    if (rtSel) {
      setRtExtras({
        formacao: rtSel.formacao ?? "", conselho_sigla: rtSel.conselho_sigla ?? "CFTA",
        conselho_numero: rtSel.conselho_numero ?? "", identidade: rtSel.identidade ?? "", cpf: rtSel.cpf ?? "",
      });
    }
  }, [servico.rt_id, rts.length]);

  // Preditivo: o TRT quase sempre é o do RT escolhido — preenche sem esperar
  // que o operador procure o número, mas nunca sobrescreve o que ele digitou.
  useEffect(() => {
    if (rtSel?.trt && !servico.trt) campo("trt", rtSel.trt);
  }, [rtSel?.id]);

  // Preditivo: município e UF sempre vieram juntos no acervo — se a dupla já
  // apareceu, a UF é dedutível e não precisa ser perguntada.
  useEffect(() => {
    if (servico.uf || !servico.municipio) return;
    const uf = inferirUf(servico.municipio, acervo);
    if (uf) { campo("uf", uf); setUfSugerida(true); }
  }, [servico.municipio, servico.uf, acervo]);

  // um M inicia uma confrontação, que vai até o próximo M — os trechos são derivados
  const trechosOrdenados = useMemo<Trecho[]>(
    () => vertices
      .filter((v) => v.tipo === "M")
      .sort((a, b) => a.ordem - b.ordem)
      .map((v) => ({
        servico_id: v.servico_id,
        vertice_inicio_ordem: v.ordem,
        apelido_txt: v.apelido_txt,
        descritivo: v.descritivo ?? "",
        tipo_limite: v.tipo_limite ?? "LA1",
        // LA3 vale como faixa de domínio por si só — o preview mostra a linha
        // dupla vermelha igual à planta e às peças (ver ehViaPorLimite)
        eh_via: v.eh_via || ehViaPorLimite(v.tipo_limite),
        cns: v.cns,
        matricula: v.matricula,
        numerado: !!v.numerado,
      })),
    [vertices],
  );

  // Números como sairão no PDF: mesma função do desenho, para a tela não
  // prometer um "3" que a planta imprime como "2". Chave por vértice inicial.
  const numeracao = useMemo(() => numerarConfrontantes(trechosOrdenados), [trechosOrdenados]);

  // Imóvel em PARTES: as glebas cobrem todos os vértices, cada um numa só (o TXT
  // veio em blocos de numeração). Cada parte é um anel próprio no mapa e na
  // prévia — costurá-las num anel só era o que cruzava o perímetro.
  const partesOrdens = useMemo(() => partesDasGlebas(glebas, vertices), [glebas, vertices]);

  const preview = useMemo(
    () => calcularPreviewLocal(
      servico.fuso_utm ?? 24, vertices, trechosOrdenados, credenciado,
      ehConferencia ? "conferencia" : "oficial",
      partesOrdens,
    ),
    [servico.fuso_utm, vertices, trechosOrdenados, credenciado, ehConferencia, partesOrdens],
  );
  // faixas de domínio: saem da própria planta (trecho marcado como via ou rótulo
  // do confrontante), uma declaração por via — sem campo para digitar
  const viasDetectadas = useMemo(() => viasDaPlanta(trechosOrdenados), [trechosOrdenados]);
  // não é escolha do usuário: o SIGEF exige começar pelo vértice mais ao norte
  const verticeInicial = preview.verticeInicialOrdem ?? -1;

  const pendencias = useMemo(() => {
    const p: { msg: string; alvo: string }[] = [];
    if (!servico.credenciado_id) p.push({ msg: "selecione o Credenciado", alvo: "campo-credenciado" });
    if (!servico.detentor_nome) p.push({ msg: "informe o Detentor", alvo: "campo-detentor" });
    if (!servico.denominacao) p.push({ msg: "informe a Denominação", alvo: "campo-denominacao" });
    if (!servico.municipio) p.push({ msg: "informe o Município", alvo: "campo-municipio" });
    if (!servico.uf) p.push({ msg: "informe a UF", alvo: "campo-uf" });
    // confrontantes (descritivo/apelido) são opcionais — sem eles o memorial
    // segue sem a cláusula "confrontando com a propriedade de"
    return p;
  }, [servico]);

  const [tentouGerar, setTentouGerar] = useState(false);

  // destaca campo obrigatório vazio depois de uma tentativa de geração
  const obg = (v: string | null) => (tentouGerar && !v ? "campo-pendente" : "");

  function campo<K extends keyof Servico>(k: K, v: Servico[K]) {
    setServico((s) => ({ ...s, [k]: v }));
  }

  // Matrícula / posse / ainda sem documento. A tradução para as duas colunas do
  // banco mora em modalidades.ts, junto dos outros mapeamentos tela ↔ modelo.
  const situacaoImovel = situacaoDoImovel(servico);
  const setSituacaoImovel = (v: SituacaoImovel) =>
    setServico((s) => ({ ...s, ...camposDaSituacao(v) }));

  // ------- Bloco 2: trechos -------
  // Editar a confrontação é editar o vértice M: marcar/desmarcar o M é o mesmo ato
  // que criar/remover o trecho, então os dois nunca divergem.
  function setTrecho(t: Trecho, patch: Partial<Trecho>) {
    const { vertice_inicio_ordem: _ord, servico_id: _sid, ...conf } = patch;
    setVertices((vs) => vs.map((v) => (v.ordem === t.vertice_inicio_ordem ? { ...v, ...conf } : v)));
  }
  function addTrecho(ordem: number) {
    setVertices((vs) => vs.map((v) => (v.ordem === ordem && v.tipo !== "M"
      ? { ...v, tipo: "M", descritivo: "", tipo_limite: "LA1", eh_via: false, numerado: false, apelido_txt: v.apelido_txt ?? "" }
      : v)));
  }
  function removeTrecho(t: Trecho) {
    // Ao deixar de ser M o vértice volta ao que era: um ponto inserido à mão é V
    // (tipo V · método PA1) e não vira P só porque a confrontação saiu dele.
    setVertices((vs) => vs.map((v) => (v.ordem === t.vertice_inicio_ordem && v.tipo === "M"
      ? { ...v, tipo: v.inserido_manual ? "V" : "P", ...SEM_CONFRONTACAO }
      : v)));
  }
  // O ponto de início pode vir errado do TXT ou mudar depois da conferência em
  // campo. Mover leva a confrontação inteira para outro vértice — remover e
  // recriar custaria redigitar descritivo, apelido, CNS e matrícula.
  function moverTrecho(t: Trecho, novaOrdem: number) {
    const origem = vertices.find((v) => v.ordem === t.vertice_inicio_ordem);
    const destino = vertices.find((v) => v.ordem === novaOrdem);
    if (!origem || !destino || origem.ordem === destino.ordem) return;
    if (destino.tipo === "M") {
      avisar("alerta", `${nomePonto(destino)} já inicia uma confrontação — escolha outro ponto.`);
      return;
    }
    setVertices((vs) => moverConfrontacao(vs, origem.ordem, destino.ordem));
    avisar("ok", `Confrontação ${origem.apelido_txt ? `"${origem.apelido_txt}" ` : ""}movida de ${nomePonto(origem)} para ${nomePonto(destino)}.`);
  }

  // ------- Bloco 3: vértices -------
  function setVertice(ordem: number, patch: Partial<Vertice>) {
    setVertices((vs) => vs.map((v) => (v.ordem === ordem ? { ...v, ...patch } : v)));
  }
  function inserirV() {
    const apos = Number(novoV.aposOrdem);
    if (!novoV.codigo || !novoV.lat || !novoV.lon || Number.isNaN(apos) || novoV.aposOrdem === "") {
      setErro("Preencha posição, código e coordenadas do vértice V");
      return;
    }
    setErro(null);
    setVertices((vs) => {
      const desloc = vs.map((v) => (v.ordem > apos ? { ...v, ordem: v.ordem + 1 } : v));
      return [...desloc, {
        // id já nasce aqui: o vértice tem identidade estável desde a inserção
        id: crypto.randomUUID(),
        servico_id: servico.id, ordem: apos + 1, num_txt: null, rotulo_txt: null,
        e: null, n: null, h: Number(novoV.h.replace(",", ".")) || 0,
        sigma_pos: 0, sigma_h: Number(novoV.sigmaH.replace(",", ".")) || 0,
        // código digitado pelo operador: nunca é prévia, nem na conferência
        tipo: "V" as const, codigo: novoV.codigo, codigo_provisorio: false, metodo: "PA1", inserido_manual: true,
        lat_gms: novoV.lat, lon_gms: novoV.lon,
        // V é ponto intermediário: nunca carrega confrontação
        descritivo: null, tipo_limite: null, eh_via: false, numerado: false,
        cns: null, matricula: null, apelido_txt: null,
      }].sort((a, b) => a.ordem - b.ordem);
    });
    // a confrontação viaja com o próprio vértice: não há âncora para reindexar
    setNovoV({ aposOrdem: "", codigo: "", lat: "", lon: "", h: "", sigmaH: "0,02" });
    avisar("ok", "Vértice V inserido.");
  }
  // ------- ordem dos vértices -------
  //
  // A ordem É a sequência do anel: o mapa, os trechos (M até o próximo M), os
  // códigos e todos os documentos saem dela. Pontos coletados fora de ordem se
  // corrigem aqui, em bloco: marcar vários e mover. Ver src/lib/ordem.ts.
  const chaveV = (v: Vertice) => v.id ?? `o${v.ordem}`;
  function alternarSelecaoV(idx: number, shift: boolean) {
    const lista = [...vertices].sort((a, b) => a.ordem - b.ordem);
    setSelVert((s) => {
      const n = new Set(s);
      if (shift && ultimoClicado !== null) {
        const [a, b] = ultimoClicado < idx ? [ultimoClicado, idx] : [idx, ultimoClicado];
        for (let k = a; k <= b; k++) n.add(chaveV(lista[k]));
      } else {
        const c = chaveV(lista[idx]);
        if (n.has(c)) n.delete(c); else n.add(c);
      }
      return n;
    });
    setUltimoClicado(idx);
  }
  function reordenar(destino: DestinoOrdem) {
    if (!selVert.size) return;
    setVertices((vs) => reordenarVertices(vs, (v) => selVert.has(chaveV(v)), destino));
    // os campos abertos eram indexados pela ordem antiga
    setCamposAbertos(new Set());
    avisar("ok", `Ordem alterada: ${selVert.size} vértice(s) movido(s). Mapa, trechos e códigos seguem a nova sequência; gere os documentos de novo.`);
  }

  function removerV(ordem: number) {
    setVertices((vs) => vs.filter((v) => v.ordem !== ordem).map((v) => (v.ordem > ordem ? { ...v, ordem: v.ordem - 1 } : v)));
  }

  // ------- persistência -------
  async function salvar(): Promise<void> {
    const { id, status, ...campos } = servico;
    const { error: e1 } = await supabase.from("servicos").update(campos).eq("id", id);
    if (e1) throw e1;
    // Grava por upsert com id estável, em vez de apagar e reinserir a tabela toda.
    // O delete+insert fazia uma aba aberta antes de uma mudança de schema regravar
    // TODOS os vértices sem as colunas que ela não havia carregado — foi assim que
    // a confrontação se perdeu depois da migração. Ver ARQUITETURA-TRECHOS.md.
    const linhas = vertices.map((v) => ({ ...v, id: v.id ?? crypto.randomUUID() }));
    if (linhas.length === 0) throw new Error("Serviço sem vértices");
    const idsMantidos = linhas.map((l) => `"${l.id}"`).join(",");
    const { error: e2 } = await supabase.from("vertices")
      .delete().eq("servico_id", id).not("id", "in", `(${idsMantidos})`);
    if (e2) throw e2;
    // a confrontação vai junto, nas colunas do próprio vértice
    const { error: e3 } = await supabase.from("vertices").upsert(linhas, { onConflict: "id" });
    if (e3) throw e3;
    if (servico.rt_id) {
      await supabase.from("responsaveis_tecnicos").update(rtExtras).eq("id", servico.rt_id);
    }
    // Glebas: upsert com id estável e remoção do que saiu da tela, o mesmo
    // padrão dos vértices. Nada acontece em serviço sem glebas.
    if (servico.tem_glebas) {
      const linhas = glebas.map((g, i) => ({
        id: g.id ?? crypto.randomUUID(),
        servico_id: id,
        ordem: i,
        nome: g.nome,
        anel: g.anel,
        confrontante_interno: g.confrontante_interno ?? null,
      }));
      const ids = linhas.map((l) => `"${l.id}"`).join(",");
      const del = supabase.from("glebas").delete().eq("servico_id", id);
      const { error: e4 } = await (linhas.length ? del.not("id", "in", `(${ids})`) : del);
      if (e4) throw e4;
      if (linhas.length) {
        const { error: e5 } = await supabase.from("glebas").upsert(linhas, { onConflict: "id" });
        if (e5) throw e5;
      }
    }
  }

  // Autossalvamento de tudo que a tela edita — inclusive a confrontação, que
  // mora nos vértices. Suspenso enquanto uma rotina do servidor está no ar:
  // gerar/corrigir gravam e releem o serviço, e uma escrita concorrente
  // sobrescreveria o que acabou de voltar.
  const emRotina = ocupado || corrigindo || gerandoPecas || gerandoPlanta || gerandoTabular;
  const auto = useAutosave(
    { servico, vertices, rtExtras, glebas },
    async () => { await salvar(); },
    { ativo: !emRotina && vertices.length > 0, atraso: 1500 },
  );

  // ------- separar as glebas em serviços próprios -------
  //
  // Uma gleba pode ser negociada e certificada sozinha. Quando isso acontece,
  // ela deixa de ser um desenho dentro do serviço do imóvel e vira um serviço
  // com vida própria — com o seu memorial, a sua planilha e o seu envio ao SIGEF.
  //
  // Os vértices são COPIADOS com os códigos que já têm: eles são do levantamento,
  // não do serviço, e realocar geraria dois códigos oficiais para o mesmo marco
  // de campo. O serviço de origem fica intacto — separar não é mover.
  async function separarGlebas() {
    const fechadas = glebas.filter((g) => g.anel.length >= 3);
    if (!fechadas.length) { setErro("Nenhuma gleba fechada para separar."); return; }
    setOcupado(true);
    setErro(null);
    try {
      await salvar();
      const { id: _id, created_at: _c, ...campos } = servico as Servico & { created_at?: string };
      const chave = (e: number, n: number) => `${e.toFixed(3)}|${n.toFixed(3)}`;
      const porCoord = new Map(
        vertices.filter((v) => v.e !== null && v.n !== null)
          .map((v) => [chave(Number(v.e), Number(v.n)), v]),
      );
      const criados: string[] = [];
      for (const g of fechadas) {
        const { data: novo, error } = await supabase.from("servicos").insert({
          ...campos,
          tem_glebas: false,
          status: "rascunho",
          denominacao_parcela: g.nome,
          // a origem continua existindo e continua com as glebas desenhadas
        }).select().single();
        if (error) throw error;
        const linhas = g.anel
          .map(([e, n], i) => {
            const v = porCoord.get(chave(e, n));
            return {
              servico_id: (novo as Servico).id,
              ordem: i,
              num_txt: v?.num_txt ?? null,
              rotulo_txt: v?.rotulo_txt ?? null,
              e, n,
              h: v?.h ?? 0,
              sigma_pos: v?.sigma_pos ?? 0,
              sigma_h: v?.sigma_h ?? 0,
              tipo: v?.tipo ?? "P",
              codigo: v?.codigo ?? null,
              metodo: v?.metodo ?? "PG6",
              inserido_manual: v?.inserido_manual ?? false,
              lat_gms: v?.lat_gms ?? "",
              lon_gms: v?.lon_gms ?? "",
              descritivo: v?.descritivo ?? null,
              tipo_limite: v?.tipo_limite ?? null,
              eh_via: v?.eh_via ?? false,
              cns: v?.cns ?? null,
              matricula: v?.matricula ?? null,
              apelido_txt: v?.apelido_txt ?? null,
            };
          });
        const { error: eV } = await supabase.from("vertices").insert(linhas);
        if (eV) throw eV;
        criados.push(g.nome);
      }
      avisar("ok", `${criados.length} serviço(s) criado(s): ${criados.join(", ")}. Este serviço continua como está — separar não move nada.`);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(false);
    }
  }

  // ------- entradas que sobrevivem à geração -------
  //
  // A imagem de satélite e o PDF do SIGEF viviam SÓ no estado do React: fechar a
  // aba obrigava a reenviar os dois para regerar qualquer coisa. Como refazer um
  // projeto é rotina — corrigiu um confrontante, gera de novo — os dois passam a
  // morar no Storage, ao lado dos documentos do serviço.
  //
  // A leitura é preguiçosa de propósito: ao abrir a tela só se LISTA a pasta
  // (barato), e o arquivo em si só desce quando for de fato gerar. Baixar uma
  // imagem de satélite de vários MB toda vez que a tela abre pagaria caro por
  // algo que nem sempre é usado.
  const PASTA_ENTRADA = `${servico.id}/entrada`;

  async function guardarEntrada(nome: string, bytes: Blob | File, tipo: string) {
    const up = await supabase.storage.from("gerados")
      .upload(`${PASTA_ENTRADA}/${nome}`, bytes, { upsert: true, contentType: tipo });
    if (up.error) avisar("alerta", `O arquivo foi aceito, mas não ficou guardado para a próxima geração: ${up.error.message}`);
  }

  async function baixarEntrada(nome: string): Promise<string | null> {
    const dl = await supabase.storage.from("gerados").download(`${PASTA_ENTRADA}/${nome}`);
    if (dl.error || !dl.data) return null;
    return bufParaBase64(await dl.data.arrayBuffer());
  }

  /** Base64 da imagem de satélite: a da sessão, ou a guardada na geração anterior. */
  async function garantirSatelite(): Promise<{ b64: string; tipo: "png" | "jpg" } | null> {
    if (satelite) return satelite;
    if (!salvo.satelite) return null;
    const b64 = await baixarEntrada(salvo.satelite.nome);
    if (!b64) return null;
    const s = { b64, tipo: salvo.satelite.tipo, nome: salvo.satelite.nome };
    setSatelite(s);
    return s;
  }

  /** Base64 do PDF do SIGEF, com a mesma regra. */
  async function garantirSigef(): Promise<string | null> {
    if (sigefB64) return sigefB64;
    if (!salvo.sigef) return null;
    const b64 = await baixarEntrada("sigef.pdf");
    if (b64) { setSigefB64(b64); setSigefNome(salvo.sigef); }
    return b64;
  }

  // ------- etapa 2: documento do SIGEF -------
  async function carregarSigef(file: File) {
    setSigefB64(bufParaBase64(await file.arrayBuffer()));
    setSigefNome(file.name);
    setErroPecas(null);
    await guardarEntrada("sigef.pdf", file, "application/pdf");
    setSalvo((s) => ({ ...s, sigef: file.name }));
    avisar("ok", "PDF do SIGEF carregado — agora gere a Planta e as peças técnicas.");
  }

  // ------- vizinhos certificados: refazer a união (fuso) -------
  //
  // Serviço que nasceu unido a vértices certificados: a ORDEM dos pontos depende
  // de TXT e CSV projetados no mesmo fuso. Trocar o fuso aqui, portanto, não é
  // só trocar um número — a função reunir-certificados refaz a união a partir do
  // TXT e dos CSVs guardados no Storage, preservando confrontação, códigos e V
  // digitados. Depois disso os documentos precisam ser gerados de novo.
  const temCertificados = vertices.some((v) => v.inserido_manual && !!v.codigo && v.metodo !== "PA1" && v.num_txt === null);
  const [reunindo, setReunindo] = useState(false);
  async function reunirCertificados(fuso: number) {
    setReunindo(true);
    setErro(null);
    try {
      await salvar(); // confrontação e edições da tela vão ao banco antes de refazer
      const r = await chamarFuncao<{ ok: boolean; vertices: Vertice[]; resumo: { fuso: number; igualados: number; inseridos: number; removidos: number[]; avisos: string[] } }>(
        "reunir-certificados", { servico_id: servico.id, fuso },
      );
      setVertices(r.vertices);
      const { data: sv } = await supabase.from("servicos").select().eq("id", servico.id).single();
      if (sv) setServico(sv as Servico);
      setGerado(null);
      avisar("ok", `União refeita no fuso ${r.resumo.fuso}S: ${r.resumo.igualados} igualado(s), ${r.resumo.inseridos} inserido(s)${r.resumo.removidos.length ? `, pontos ${r.resumo.removidos.join(", ")} do TXT descartados por estarem sobre a divisa certificada` : ""}. Gere os documentos novamente.`);
      for (const a of r.resumo.avisos) avisar("alerta", a);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setReunindo(false);
    }
  }
  function trocarFuso(z: number) {
    campo("fuso_utm", z);
    if (temCertificados && z !== servico.fuso_utm) void reunirCertificados(z);
  }

  // ------- correção de sobreposição SIGEF -------
  async function carregarCsvsSobreposicao(files: FileList | File[]) {
    const lista = [...files].filter((f) => /\.csv$/i.test(f.name));
    if (!lista.length) { setErro("Envie os arquivos CSV exportados pelo SIGEF"); return; }
    setErro(null);
    const lidos = await Promise.all(lista.map(async (f) => ({ nome: f.name, conteudo: await f.text() })));
    setSobreCsvs((prev) => {
      const mapa = new Map(prev.map((c) => [c.nome, c]));
      for (const c of lidos) mapa.set(c.nome, c);
      return [...mapa.values()];
    });
  }

  async function corrigirSobreposicao() {
    if (!sobreCsvs.length) { setErro("Envie ao menos um CSV de parcela sobreposta"); return; }
    setCorrigindo(true);
    setErro(null);
    setRelatorioSobre(null);
    try {
      await salvar(); // estado atual da tela vai ao banco antes da correção
      const r = await chamarFuncao<{ ok: boolean; corrigido: boolean; relatorio: RelatorioSobreposicao }>(
        "corrigir-sobreposicao",
        {
          servico_id: servico.id,
          afastamento: Number(afastamento.replace(",", ".")) || 0.5,
          usar_vertices_certificados: usarCertificados,
          tolerancia_igualar: Number(tolIgualar.replace(",", ".")) || 0.5,
          csvs: sobreCsvs,
        },
      );
      setRelatorioSobre(r.relatorio);
      if (r.corrigido) {
        // recarrega o serviço corrigido e regera os documentos direto do banco
        const { data: sv } = await supabase.from("servicos").select().eq("id", servico.id).single();
        if (sv) setServico(sv as Servico);
        const g = await chamarFuncao<Gerado>("gerar-documentos", {
          servico_id: servico.id,
          satelite_base64: satelite?.b64, satelite_tipo: satelite?.tipo,
          folha: folhaEfetiva,
        });
        setGerado(g);
        const { data: vs } = await supabase.from("vertices").select().eq("servico_id", servico.id).order("ordem");
        if (vs) setVertices(vs as Vertice[]);
        avisar("ok", "Sobreposição corrigida — planilha, memorial e planta regerados. Baixe a nova ODS e reenvie ao SIGEF.");
      } else {
        avisar("alerta", "Nenhuma sobreposição de interior detectada com os CSVs enviados — nada foi alterado.");
      }
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
      // se a correção gravou mas a regeração falhou, garante estado coerente na tela
      const { data: vs } = await supabase.from("vertices").select().eq("servico_id", servico.id).order("ordem");
      if (vs?.length) setVertices(vs as Vertice[]);
    } finally {
      setCorrigindo(false);
    }
  }

  async function carregarSatelite(file: File) {
    const ehPng = /png$/i.test(file.type) || /\.png$/i.test(file.name);
    if (!ehPng && !/jpe?g$/i.test(file.type) && !/\.jpe?g$/i.test(file.name)) {
      setErro("Envie a imagem de satélite em PNG ou JPG");
      return;
    }
    setErro(null);
    const tipo = ehPng ? "png" : "jpg";
    setSatelite({ b64: bufParaBase64(await file.arrayBuffer()), tipo, nome: file.name });
    // guardada com nome fixo: trocar a imagem substitui a anterior em vez de
    // deixar duas na pasta sem dizer qual vale
    await guardarEntrada(`satelite.${tipo}`, file, ehPng ? "image/png" : "image/jpeg");
    setSalvo((s) => ({ ...s, satelite: { nome: `satelite.${tipo}`, tipo } }));
  }

  // ------- etapa 3A: planta (A1 matrícula / A3 posse) -------
  async function gerarPlanta() {
    setGerandoPlanta(true);
    setErro(null);
    try {
      const pdf = await garantirSigef();
      if (!pdf) { setGerandoPlanta(false); setErro("Envie o PDF do SIGEF na etapa anterior"); return; }
      const sat = await garantirSatelite();
      if (!sat) { setGerandoPlanta(false); setErro("Envie a imagem de satélite para gerar a planta"); return; }
      await salvar();
      const r = await chamarFuncao<{ planta_pdf: string }>("gerar-planta", {
        servico_id: servico.id, pdf_base64: pdf,
        satelite_base64: sat.b64, satelite_tipo: sat.tipo,
        folha: folhaEfetiva,
      });
      setPlantaUrl(r.planta_pdf);
      avisar("ok", `Planta ${folhaEfetiva} gerada.`);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setGerandoPlanta(false);
    }
  }

  // ------- etapa 3B: peças técnicas -------
  async function gerarPecas() {
    setGerandoPecas(true);
    setErroPecas(null);
    try {
      const pdf = await garantirSigef();
      if (!pdf) { setGerandoPecas(false); setErroPecas("Envie o PDF do SIGEF na etapa anterior"); return; }
      await salvar();
      const r = await chamarFuncao<PecasGeradas>("gerar-pecas", { servico_id: servico.id, pdf_base64: pdf });
      setPecas(r);
      avisar("ok", "7 peças técnicas geradas.");
    } catch (e) {
      setErroPecas(e instanceof Error ? e.message : String(e));
    } finally {
      setGerandoPecas(false);
    }
  }

  // ------- conferência de área: Memorial Tabular sem PDF do SIGEF -------
  // Chama a MESMA gerar-pecas do fluxo completo, com `origem: "calculo"`: as
  // peças continuam saindo de um gerador só. Ver sigefDoCalculo.
  async function gerarTabular() {
    setGerandoTabular(true);
    setErro(null);
    try {
      await salvar();
      const r = await chamarFuncao<PecasGeradas>("gerar-pecas", {
        servico_id: servico.id, origem: "calculo", apenas: ["2"],
      });
      setTabular(r.arquivos);
      avisar("ok", "Memorial Tabular gerado a partir do cálculo do sistema (prévia).");
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setGerandoTabular(false);
    }
  }

  async function gerar() {
    if (pendencias.length > 0) {
      setTentouGerar(true);
      setErro(`Para gerar, resolva:\n• ${pendencias.map((p) => p.msg).join("\n• ")}`);
      irParaCampo(pendencias[0].alvo, true);
      return;
    }
    setOcupado(true);
    setErro(null);
    try {
      // a planta sai junto do memorial e da planilha, e o quadro PLANTA DE
      // SITUAÇÃO é da imagem de satélite — a da sessão ou a guardada antes
      const sat = await garantirSatelite();
      if (!sat) {
        setOcupado(false);
        setErro("Envie a imagem de satélite: ela entra no quadro PLANTA DE SITUAÇÃO da planta.");
        irParaCampo("bloco-satelite", true);
        return;
      }
      await salvar();
      const r = await chamarFuncao<Gerado>("gerar-documentos", {
        servico_id: servico.id,
        satelite_base64: sat.b64, satelite_tipo: sat.tipo,
        folha: folhaEfetiva,
      });
      setGerado(r);
      for (const a of r.avisos ?? []) avisar("alerta", a);
      avisar("ok", r.planta_pdf ? "Memorial, planilha e planta gerados com sucesso." : "Memorial e planilha gerados com sucesso.");
      const { data } = await supabase.from("vertices").select().eq("servico_id", servico.id).order("ordem");
      if (data) setVertices(data as Vertice[]);
      irParaCampo("bloco-gerados");
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(false);
    }
  }

  async function apenasSalvar() {
    setOcupado(true);
    setErro(null);
    try {
      await salvar();
      avisar("ok", "Rascunho salvo.");
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(false);
    }
  }

  const sel = (valor: string | null, opcoes: string[], set: (v: string) => void) => (
    <select value={valor ?? ""} onChange={(e) => set(e.target.value)}>
      <option value="">—</option>
      {opcoes.map((o) => <option key={o}>{o}</option>)}
    </select>
  );
  const nomePonto = (v: Vertice) => v.num_txt ?? v.codigo ?? `V(${v.ordem})`;
  const corDoTrecho = (t: Trecho) => CORES[trechosOrdenados.indexOf(t) % CORES.length];
  // Via e rio ficam de fora da numeração: o nome da estrada acompanha o traço
  // dela e nunca foi o que empilhava. Mesma regra de numerarConfrontantes.
  const ehNumeravel = (t: Trecho) =>
    !t.eh_via && !ehViaPorLimite(t.tipo_limite) && !ehRioPorLimite(t.tipo_limite);
  const chaveDoTrecho = (t: { descritivo?: string | null; apelido_txt?: string | null }) =>
    (t.descritivo || t.apelido_txt || "").trim().toUpperCase();

  /**
   * Marcar a numeração é um ato sobre o CONFRONTANTE, não sobre o trecho: o
   * mesmo vizinho pode ocupar duas divisas separadas do perímetro, e ele é um
   * só. A marca vai para todas as divisas dele de uma vez — é assim que a tela,
   * o banco e o desenho concordam sobre quem tem número (o desenho procura pelo
   * descritivo, não pelo trecho). Ver numerarConfrontantes.
   */
  function marcarNumeracao(t: Trecho, valor: boolean) {
    const chave = chaveDoTrecho(t);
    if (!chave) return;
    setVertices((vs) => vs.map((v) => (
      v.tipo === "M" && chaveDoTrecho(v) === chave ? { ...v, numerado: valor } : v
    )));
  }

  // ------- estado do processo: trilha de etapas e próxima ação -------
  const confrontantesPreenchidos = trechosOrdenados.filter((t) => t.descritivo || t.apelido_txt).length;
  const pecasProntas = pecas !== null;

  // Interface preditiva: a tela é longa e o processo tem 5 estágios — este
  // cartão elimina a pergunta "e agora?" respondendo com a ação seguinte.
  const proxima = useMemo<Acao>(() => {
    if (pendencias.length > 0) {
      return {
        tom: "pendente",
        titulo: `Faltam ${pendencias.length} ${pendencias.length === 1 ? "campo obrigatório" : "campos obrigatórios"}`,
        detalhe: pendencias.map((p) => p.msg).join(" · "),
        rotuloBotao: "Ir para o primeiro",
        onClick: () => irParaCampo(pendencias[0].alvo, true),
      };
    }
    // a imagem de satélite agora é pedida ANTES da geração: a planta sai junto
    // do memorial e da planilha, e o quadro PLANTA DE SITUAÇÃO vem dela
    if (!temSatelite && !docsProntos) {
      return {
        tom: "neutro",
        titulo: "Envie a imagem de satélite da área",
        detalhe: "entra no quadro PLANTA DE SITUAÇÃO — a mesma imagem serve à planta desta etapa e à planta do SIGEF",
        rotuloBotao: "Enviar imagem",
        onClick: () => irParaCampo("bloco-satelite"),
      };
    }
    if (!docsProntos) {
      return {
        tom: "neutro",
        titulo: "Pronto para gerar o Memorial, a Planilha e a Planta",
        detalhe: `${preview.areaHa} ha · ${preview.perimetroM} m · ${preview.qtdM}/${preview.qtdP}/${preview.qtdV} vértices M/P/V${confrontantesPreenchidos === 0 ? " · nenhum confrontante descrito (opcional)" : ""}`,
        rotuloBotao: "⚡ Gerar documentos",
        onClick: gerar,
      };
    }
    // A conferência acaba aqui: não há SIGEF nem peças depois dos documentos.
    if (ehConferencia) {
      return {
        tom: "pronto",
        titulo: "Conferência concluída",
        detalhe: "memorial e planta de prévia gerados — os pontos saem numerados P-1, P-2…, sem consumir a numeração oficial do credenciado",
      };
    }
    if (!temSigef) {
      return {
        tom: "neutro",
        titulo: "Certifique a planilha no SIGEF e envie o PDF de volta",
        detalhe: "o PDF de prévia/certificação libera a planta oficial e as 7 peças técnicas",
        rotuloBotao: "Enviar PDF",
        onClick: () => irParaCampo("bloco-sigef"),
      };
    }
    if (!temSatelite) {
      return {
        tom: "neutro",
        titulo: "Envie a imagem de satélite da área",
        detalhe: "obrigatória para o quadro PLANTA DE SITUAÇÃO da planta do SIGEF",
        rotuloBotao: "Enviar imagem",
        onClick: () => irParaCampo("bloco-satelite"),
      };
    }
    if (!plantaUrl) {
      return {
        tom: "neutro",
        titulo: `Gere a Planta ${folhaEfetiva} do SIGEF`,
        rotuloBotao: "Ir para a planta",
        onClick: () => irParaCampo("bloco-planta"),
      };
    }
    if (!pecasProntas) {
      return {
        tom: "neutro",
        titulo: "Gere as 7 peças técnicas",
        rotuloBotao: "Ir para as peças",
        onClick: () => irParaCampo("bloco-pecas"),
      };
    }
    return { tom: "pronto", titulo: "Serviço completo", detalhe: "memorial, planilha, as duas plantas e as peças gerados — tudo disponível no histórico abaixo" };
  }, [pendencias, docsProntos, temSigef, temSatelite, plantaUrl, pecasProntas, preview, confrontantesPreenchidos, servico.tipo_imovel, ehConferencia]);

  // selos das seções recolhidas: dizem o que há dentro sem precisar abrir.
  // Na conferência, matrícula e CNS saem daqui: quem manda neles é a escolha
  // "Matrícula ou posse" do bloco da conferência, e o mesmo campo em dois
  // lugares da tela é convite a divergência.
  const camposRegistro = [
    servico.situacao, servico.natureza_area, servico.natureza_servico,
    servico.tipo_pessoa, servico.codigo_sncr,
    ...(ehConferencia ? [] : [servico.cns, servico.matricula]),
  ];
  const seloRegistro = contarPreenchidos(camposRegistro);
  const seloParcela = contarPreenchidos([servico.denominacao_parcela, servico.parcela_numero, servico.lado]);

  // ------- abas de etapa: uma por vez -------
  const etapas: { chave: Etapa; rotulo: string; feita: boolean }[] = [
    { chave: "dados", rotulo: "Dados", feita: pendencias.length === 0 },
    { chave: "confrontantes", rotulo: "Confrontantes e vértices", feita: confrontantesPreenchidos > 0 },
    ...(temGlebas ? [{ chave: "glebas" as Etapa, rotulo: "Glebas", feita: glebas.some((g) => g.anel.length >= 3) }] : []),
    { chave: "documentos", rotulo: "Documentos", feita: ehConferencia ? docsProntos : !!plantaUrl && pecasProntas },
  ];
  const passos: Passo[] = etapas.map((e) => ({
    rotulo: e.rotulo,
    estado: e.chave === etapa ? "ativa" : e.feita ? "feita" : "futura",
  }));
  const indiceEtapa = etapas.findIndex((e) => e.chave === etapa);
  const etapaAnterior = etapas[indiceEtapa - 1] ?? null;
  const etapaSeguinte = etapas[indiceEtapa + 1] ?? null;
  const navEtapa = (
    <div className="etapa-nav">
      {etapaAnterior && <button onClick={() => setEtapa(etapaAnterior.chave)}>← {etapaAnterior.rotulo}</button>}
      {etapaSeguinte && <button className="escuro direita" onClick={() => setEtapa(etapaSeguinte.chave)}>{etapaSeguinte.rotulo} →</button>}
    </div>
  );

  const chave = chaveDoServico(servico);
  const verticeInicialNome = (() => {
    const v = vertices.find((x) => x.ordem === verticeInicial);
    return v ? nomePonto(v) : "—";
  })();
  const proximoTipo = (t: Vertice["tipo"]): Vertice["tipo"] => (t === "M" ? "P" : t === "P" ? "V" : "M");

  return (
    <div className="conferencia">
      <Avisos avisos={avisos} onFechar={fechar} />

      <header className="topo">
        <button className="fantasma voltar" onClick={onVoltar}>← Serviços</button>
        <span className="sep" aria-hidden="true">/</span>
        <h1 className="titulo">{servico.denominacao || servico.nome_arquivo_txt || "Serviço"}</h1>
        <span className={`chip mod-${chave}`}>{rotuloCurto[chave]}</span>
        {servico.nome_arquivo_txt && <span className="arquivo">{servico.nome_arquivo_txt}</span>}
        <StatusSalvamento estado={auto.estado} horaSalvo={auto.horaSalvo} />
        <span className="esticar" />
        {/* Fuso ambíguo era só um alerta em texto: os candidatos viram botões,
            porque a decisão é entre dois valores concretos. */}
        {inicial.preview.fusoAmbiguo && (
          <span className="alerta" style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
            fuso ambíguo — confirme:
            {inicial.preview.candidatos.map((z) => (
              <button key={z} onClick={() => trocarFuso(z)}
                style={{ padding: "0 8px", height: 24, fontSize: 12, fontWeight: 700 }}
                aria-pressed={servico.fuso_utm === z}>{z}S</button>
            ))}
          </span>
        )}
        {inicial.preview.foraDaUf && <em className="alerta">coordenadas fora da UF informada!</em>}
        {inicial.preview.partes && (
          <em className="alerta" title={inicial.preview.partes.map((p) => `${p.nome}: pontos ${p.numeracao} (${p.pontos})`).join("\n")}>
            TXT em {inicial.preview.partes.length} partes ({inicial.preview.partes.map((p) => p.numeracao).join(" · ")}) — cada uma é um anel próprio
          </em>
        )}
        {inicial.preview.certificados && (
          <em className="alerta" title={inicial.preview.certificados.avisos.join("\n") || undefined}>
            {inicial.preview.certificados.total} vértice(s) certificado(s) de {inicial.preview.certificados.parcelas} parcela(s) vizinha(s) unidos ·{" "}
            {inicial.preview.certificados.igualados} igualado(s), {inicial.preview.certificados.inseridos} inserido(s)
            {inicial.preview.certificados.removidos.length > 0 && <> · pontos {inicial.preview.certificados.removidos.join(", ")} do TXT descartados (sobre a divisa certificada)</>}
            {inicial.preview.fusoOrigem === "certificados" && <> · fuso {inicial.preview.fuso}S definido pelos CSVs</>}
          </em>
        )}
        <label>Fuso UTM
          <select value={servico.fuso_utm ?? 24} disabled={reunindo} onChange={(e) => trocarFuso(Number(e.target.value))}>
            {[18, 19, 20, 21, 22, 23, 24, 25].map((z) => (
              <option key={z} value={z}>{z}S{inicial.preview.candidatos.includes(z) ? " •" : ""}</option>
            ))}
          </select>
        </label>
        {temCertificados && (
          <button className="fantasma" disabled={reunindo} onClick={() => reunirCertificados(servico.fuso_utm ?? 24)}
            title="Refaz a união entre o TXT e os vértices certificados dos vizinhos no fuso atual">
            {reunindo ? "reunindo…" : "refazer união"}
          </button>
        )}
        <Passos passos={passos} onClick={(_, i) => setEtapa(etapas[i].chave)} />
      </header>

      <div className="conferencia-corpo fade" key={etapa}>
        <ProximaAcao acao={proxima} />

        {/* ================= Etapa · Dados ================= */}
        {etapa === "dados" && (
          <>
            <section className="bloco" id="bloco-dados">
              <header>
                <h3>Dados do serviço</h3>
                <span className="desc">o essencial fica à vista; o resto abre quando precisar</span>
              </header>

              {/* Sempre visível: exatamente o que bloqueia a geração. Nenhum campo
                  obrigatório pode morar numa seção recolhida — a lista de pendências
                  precisa apontar para algo que o operador vê. */}
              <div className="grade">
                <label>Cliente
                  <select value={servico.cliente_id ?? ""} onChange={(e) => {
                    const cli = clientes.find((c) => c.id === e.target.value) ?? null;
                    setServico((s) => ({
                      ...s,
                      cliente_id: cli?.id ?? null,
                      ...(cli ? {
                        detentor_nome: cli.nome, detentor_cpf: cli.cpf_cnpj,
                        detentor_genero: cli.genero, endereco_detentor: cli.endereco,
                        is_espolio: cli.is_espolio ?? false,
                        inventariante_nome: cli.inventariante_nome ?? null,
                        inventariante_cpf: cli.inventariante_cpf ?? null,
                        inventariante_rg: cli.inventariante_rg ?? null,
                      } : {}),
                    }));
                  }}>
                    <option value="">— (sem vínculo)</option>
                    {clientes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                  </select>
                  <small className="sub">preenche detentor, endereço e espólio de uma vez</small>
                </label>
                <label><span>Credenciado <span className="obrigatorio">*</span></span>
                  <select id="campo-credenciado" className={obg(servico.credenciado_id)}
                    value={servico.credenciado_id ?? ""} onChange={(e) => campo("credenciado_id", e.target.value || null)}>
                    <option value="">—</option>
                    {credenciados.map((c) => <option key={c.id} value={c.id}>{c.nome} ({c.prefixo_vertice})</option>)}
                  </select>
                </label>
                <label><span>Detentor <span className="obrigatorio">*</span></span>
                  <input id="campo-detentor" className={obg(servico.detentor_nome)} list="detentores" value={servico.detentor_nome ?? ""} onChange={(e) => {
                    campo("detentor_nome", e.target.value);
                    const d = detentores.find((x) => x.nome === e.target.value);
                    if (d?.cpf) campo("detentor_cpf", d.cpf);
                  }} />
                  <datalist id="detentores">{detentores.map((d) => <option key={d.nome} value={d.nome} />)}</datalist>
                </label>
                <label>CPF/CNPJ <input className="mono" value={servico.detentor_cpf ?? ""} onChange={(e) => campo("detentor_cpf", e.target.value)} /></label>
                <label><span>Denominação <span className="obrigatorio">*</span></span>
                  <input id="campo-denominacao" className={obg(servico.denominacao)} value={servico.denominacao ?? ""} onChange={(e) => campo("denominacao", e.target.value)} />
                </label>
                <label><span>Município <span className="obrigatorio">*</span></span>
                  <input id="campo-municipio" className={obg(servico.municipio)} value={servico.municipio ?? ""} onChange={(e) => campo("municipio", e.target.value)} />
                </label>
                <label><span>UF <span className="obrigatorio">*</span></span>
                  <select id="campo-uf" className={obg(servico.uf)} value={servico.uf ?? ""}
                    onChange={(e) => { campo("uf", e.target.value); setUfSugerida(false); }}>
                    <option value="">—</option>
                    {UFS.map((u) => <option key={u}>{u}</option>)}
                  </select>
                  {ufSugerida && <small className="sub" style={{ color: "var(--alerta)" }}>sugerida pelo histórico de {servico.municipio} — confira</small>}
                </label>
              </div>

              <div className="secoes" style={{ marginTop: 22 }}>
                <Secao titulo="Responsável técnico e TRT"
                  selo={<span className={rtSel ? "secao-selo completa" : "secao-selo vazia"}>{rtSel ? rtSel.nome : "não definido"}</span>}
                  dica="assina o memorial, as peças e a planta">
                  <div className="grade">
                    <label>Responsável Técnico
                      <select value={servico.rt_id ?? ""} onChange={(e) => campo("rt_id", e.target.value || null)}>
                        <option value="">—</option>
                        {rts.map((r) => <option key={r.id} value={r.id}>{rotuloRT(r)}</option>)}
                      </select>
                      <small className="sub">cadastre novos em Configurações</small>
                    </label>
                    <label>TRT (Termo de Responsabilidade Técnica)
                      <input className="mono" placeholder="ex.: BR20250804764" value={servico.trt ?? ""}
                        onChange={(e) => campo("trt", e.target.value.trim() || null)} />
                      <small className="sub">
                        {rtSel?.trt && servico.trt === rtSel.trt
                          ? `preenchido com o TRT padrão de ${rtSel.nome} — troque se este serviço tem outro`
                          : "vai no memorial, nas peças e na planta; sobrepõe o TRT do PDF do SIGEF"}
                      </small>
                    </label>
                  </div>
                </Secao>

                <Secao titulo={ehConferencia ? "Natureza e classificações" : "Registro, cartório e natureza"}
                  selo={<span className={`secao-selo ${seloRegistro === camposRegistro.length ? "completa" : seloRegistro === 0 ? "vazia" : ""}`}>{seloRegistro} de {camposRegistro.length}</span>}
                  dica={ehConferencia ? "SNCR e classificações do SIGEF" : "matrícula, CNS, SNCR e classificações do SIGEF"}>
                  <div className="grade">
                    <label>Natureza do serviço {sel(servico.natureza_servico, NATUREZAS_SERVICO, (v) => campo("natureza_servico", v))}</label>
                    <label>Tipo pessoa {sel(servico.tipo_pessoa, TIPOS_PESSOA, (v) => campo("tipo_pessoa", v))}</label>
                    <label>Situação {sel(servico.situacao, SITUACOES, (v) => campo("situacao", v))}</label>
                    <label>Natureza da área {sel(servico.natureza_area, NATUREZAS_AREA, (v) => campo("natureza_area", v))}</label>
                    <label>Código SNCR <input className="mono" value={servico.codigo_sncr ?? ""} onChange={(e) => campo("codigo_sncr", e.target.value)} /></label>
                    {!ehConferencia && (
                      <>
                        <label>CNS (cartório)
                          <input className="mono" list="cartorios" value={servico.cns ?? ""} onChange={(e) => campo("cns", e.target.value)} />
                          <datalist id="cartorios">{cartorios.map((c) => <option key={c} value={c} />)}</datalist>
                        </label>
                        <label>Matrícula <input className="mono" value={servico.matricula ?? ""} onChange={(e) => campo("matricula", e.target.value)} /></label>
                      </>
                    )}
                  </div>
                  {ehConferencia && (
                    <p className="sub" style={{ margin: "8px 0 0" }}>
                      Matrícula e CNS ficam na etapa Documentos, junto da escolha entre matrícula e posse.
                    </p>
                  )}
                </Secao>

                <Secao titulo="Identificação da parcela"
                  selo={<span className={`secao-selo ${seloParcela === 3 ? "completa" : seloParcela === 0 ? "vazia" : ""}`}>{seloParcela} de 3</span>}
                  dica="use quando a gleba foi dividida em partes">
                  <div className="grade">
                    <label>Denominação da parcela <input value={servico.denominacao_parcela ?? ""} placeholder="Parte 1" onChange={(e) => campo("denominacao_parcela", e.target.value)} /></label>
                    <label>Parcela número <input value={servico.parcela_numero ?? ""} placeholder="001" onChange={(e) => campo("parcela_numero", e.target.value)} /></label>
                    <label>Lado {sel(servico.lado, LADOS, (v) => campo("lado", v))}</label>
                  </div>
                </Secao>

                <Secao titulo="Espólio e inventariante"
                  selo={<span className={`secao-selo ${servico.is_espolio ? "completa" : ""}`}>{servico.is_espolio ? "é espólio" : "não"}</span>}
                  abrirEm={!!servico.is_espolio}
                  dica="proprietário falecido, representado por inventariante">
                  <label className="linha-check">
                    <input type="checkbox" checked={!!servico.is_espolio} onChange={(e) => campo("is_espolio", e.target.checked)} />
                    É espólio (possuidor/proprietário falecido com inventariante)
                  </label>
                  {servico.is_espolio && (
                    <div className="grade">
                      <label>Nome do inventariante <input value={servico.inventariante_nome ?? ""} onChange={(e) => campo("inventariante_nome", e.target.value || null)} placeholder="Nome do inventariante" /></label>
                      <label>CPF do inventariante <input className="mono" value={servico.inventariante_cpf ?? ""} onChange={(e) => campo("inventariante_cpf", e.target.value || null)} placeholder="000.000.000-00" /></label>
                      <label>RG do inventariante (opcional) <input value={servico.inventariante_rg ?? ""} onChange={(e) => campo("inventariante_rg", e.target.value || null)} placeholder="00.000.000-00" /></label>
                    </div>
                  )}
                </Secao>
              </div>
            </section>
            {navEtapa}
          </>
        )}

        {/* ================= Etapa · Confrontantes ================= */}
        {etapa === "confrontantes" && (
          <>
            <div className="etapa-cabeca" id="bloco-confrontantes">
              <h2>Confrontantes</h2>
              <span className="desc">
                {trechosOrdenados.length} {trechosOrdenados.length === 1 ? "trecho" : "trechos"} · {confrontantesPreenchidos} {confrontantesPreenchidos === 1 ? "descrito" : "descritos"}
                {numeracao.size > 0 ? ` · ${numeracao.size} ${numeracao.size === 1 ? "numerado" : "numerados"}` : ""} — as cores correspondem ao mapa
              </span>
              <span className="esticar" />
              {/* Divisa curta não comporta o bloco de nome do vizinho: o texto quebra
                  em muitas linhas e acaba empilhado no do vizinho de baixo. Marcado
                  aqui, o confrontante sai da planta como número e reaparece por
                  extenso no quadro CONFRONTANTES do rodapé. */}
              <button
                className={modoNumeracao ? "principal" : ""}
                title="Escolher quais confrontantes saem NUMERADOS na planta: no desenho fica só o número e o texto vai para o quadro do rodapé"
                onClick={() => setModoNumeracao((v) => !v)}>
                {modoNumeracao ? "Concluir numeração" : "Adicionar numeração"}
              </button>
            </div>
            {modoNumeracao && (
              <p className="sub" style={{ margin: "-8px 0 0" }}>
                Marque os confrontantes cujo espaço na planta é curto demais para o nome.
                Cada marcado recebe um número, na ordem do perímetro, e os dados dele
                saem no quadro <b>CONFRONTANTES</b> embaixo do desenho. Faixa de domínio
                e curso d'água não entram: o nome deles acompanha o próprio traço.
              </p>
            )}
            <div className="confrontantes">
              <div className="coluna-esq">
              <div className="trechos">
                {trechosOrdenados.map((t) => {
                  const v = vertices.find((x) => x.ordem === t.vertice_inicio_ordem);
                  const camposVisiveis = camposAbertos.has(t.vertice_inicio_ordem);
                  const ehVia = t.eh_via || ehViaPorLimite(t.tipo_limite);
                  return (
                    <div className="trecho" key={`t-${t.vertice_inicio_ordem}`}
                      style={{ ["--cor-trecho" as string]: corDoTrecho(t), marginBottom: 0 }}>
                      <div className="trecho-cabeca">
                        {numeracao.get(t.vertice_inicio_ordem) !== undefined && (
                          <span className="badge-num" title="Sai numerado na planta; os dados vão ao quadro CONFRONTANTES do rodapé">
                            {numeracao.get(t.vertice_inicio_ordem)}
                          </span>
                        )}
                        <input className="apelido" value={t.apelido_txt ?? ""} placeholder="apelido do confrontante"
                          aria-label="Apelido do confrontante"
                          onChange={(e) => setTrecho(t, { apelido_txt: e.target.value || null })} />
                        {/* Trocar o ponto aqui move a confrontação inteira — o descritivo,
                            o apelido, o CNS e a matrícula vão junto. */}
                        <span className="ponto" title="Vértice M onde esta confrontação começa; ela vai até o próximo M. Trocar move a confrontação para o outro ponto, sem redigitar nada.">
                          a partir do ponto
                          <select value={t.vertice_inicio_ordem} aria-label="Ponto inicial da confrontação"
                            onChange={(e) => moverTrecho(t, Number(e.target.value))}>
                            {[...vertices]
                              .filter((x) => x.tipo !== "M" || x.ordem === t.vertice_inicio_ordem)
                              .sort((a, b) => a.ordem - b.ordem)
                              .map((x) => (
                                <option key={x.ordem} value={x.ordem}>{nomePonto(x)}</option>
                              ))}
                          </select>
                        </span>
                        <select className="limite" value={t.tipo_limite} title="Tipo de limite" aria-label="Tipo de limite"
                          onChange={(e) => setTrecho(t, { tipo_limite: e.target.value })}>
                          {TIPOS_LIMITE.map((l) => <option key={l}>{l}</option>)}
                        </select>
                        <label className={`marcador ${ehVia ? "via" : ""}`} title={ehRioPorLimite(t.tipo_limite)
                          ? "LN1 é limite natural de curso d'água: sai na planta como linha dupla AZUL, no lugar da vermelha"
                          : ehViaPorLimite(t.tipo_limite)
                            ? "LA3 é limite de faixa de domínio: sempre via"
                            : "Estrada, rodovia, corredor, linha férrea — desenhada na planta como linha dupla vermelha"}>
                          <input type="checkbox" checked={ehVia}
                            disabled={ehViaPorLimite(t.tipo_limite)}
                            onChange={(e) => setTrecho(t, { eh_via: e.target.checked })} />
                          faixa de domínio{ehViaPorLimite(t.tipo_limite) ? " (LA3)" : ""}
                        </label>
                        {/* LN1 não é escolha de checkbox, é o tipo de limite — do
                            mesmo jeito que LA3. Aqui só se avisa a cor que sai. */}
                        {ehRioPorLimite(t.tipo_limite) && <span className="chip rio">≈ rio (LN1, azul)</span>}
                        {modoNumeracao && (
                          <label className="marcador" title={!ehNumeravel(t)
                            ? "Faixa de domínio e curso d'água não são numerados: o nome acompanha o traço da via"
                            : !chaveDoTrecho(t)
                              ? "Preencha o descritivo ou o apelido: é o texto que sairia no quadro do rodapé"
                              : "Na planta sai só o número; nome, matrícula e CPF vão para o quadro CONFRONTANTES do rodapé"}>
                            <input type="checkbox" checked={!!t.numerado && ehNumeravel(t)}
                              disabled={!ehNumeravel(t) || !chaveDoTrecho(t)}
                              onChange={(e) => marcarNumeracao(t, e.target.checked)} />
                            numerar
                          </label>
                        )}
                        <span style={{ flex: 1 }} />
                        <button className="remover" title="Remover trecho" onClick={() => removeTrecho(t)}>remover</button>
                      </div>
                      <textarea
                        placeholder={"Descritivo formal (opcional), ex.: (MATR.432/CNS.00.770-8) FAZENDA LAMEIRO\\ RUDSON PINTO FERREIRA\\ CPF:791.234.145-53"}
                        value={t.descritivo} onChange={(e) => setTrecho(t, { descritivo: e.target.value })} />
                      {!t.descritivo && (
                        <div className="pendencia neutra">
                          descritivo vazio — o memorial usará o apelido {t.apelido_txt ? `"${t.apelido_txt}"` : "(vazio: segue sem cláusula de confrontação)"} · inicia no pt {v ? nomePonto(v) : "?"}
                        </div>
                      )}
                      {camposVisiveis ? (
                        <div className="trecho-campos">
                          <label>CNS <input className="mono" value={t.cns ?? ""} onChange={(e) => setTrecho(t, { cns: e.target.value || null })} /></label>
                          <label>Matrícula <input className="mono" value={t.matricula ?? ""} onChange={(e) => setTrecho(t, { matricula: e.target.value || null })} /></label>
                          <button className="link" style={{ alignSelf: "end", marginBottom: 10 }}
                            onClick={() => setCamposAbertos((s) => { const n = new Set(s); n.delete(t.vertice_inicio_ordem); return n; })}>ocultar campos</button>
                        </div>
                      ) : (
                        <div className="trecho-resumo">
                          <span>CNS <span className={`mono ${t.cns ? "tem" : ""}`}>{t.cns || "—"}</span></span>
                          <span>Matrícula <span className={`mono ${t.matricula ? "tem" : ""}`}>{t.matricula || "—"}</span></span>
                          <button className="link" onClick={() => setCamposAbertos((s) => new Set(s).add(t.vertice_inicio_ordem))}>editar campos</button>
                        </div>
                      )}
                    </div>
                  );
                })}
                <div className="add-trecho">
                  <span>Nova transição no ponto</span>
                  <select id="novo-trecho-ordem" defaultValue="" aria-label="Ponto da nova transição">
                    <option value="" disabled>—</option>
                    {vertices.filter((v) => v.tipo !== "M")
                      .map((v) => <option key={v.ordem} value={v.ordem}>{nomePonto(v)}</option>)}
                  </select>
                  <button onClick={() => {
                    const el = document.getElementById("novo-trecho-ordem") as HTMLSelectElement;
                    if (el.value !== "") { addTrecho(Number(el.value)); el.value = ""; }
                  }}>+ adicionar transição</button>
                </div>
              </div>
            {/* ------- Vértices: na mesma etapa, porque a ORDEM deles é o que define os
                trechos e o mapa acima; reordenar aqui atualiza tudo ao mesmo tempo. ------- */}
            <div className="etapa-cabeca" id="bloco-vertices">
              <h2>Vértices</h2>
              <span className="desc">{vertices.length} pontos · início automático em {verticeInicialNome} (mais ao norte, exigido pelo SIGEF) · a ordem da tabela é a sequência do perímetro: mudar aqui muda o mapa, os trechos e os documentos</span>
              <span className="esticar" />
              {/* O método era um select por linha: em 60 vértices, 60 cliques para
                  trocar todos. Aqui troca de uma vez, sem perder o ajuste por linha. */}
              <label>Método em massa
                <select defaultValue="" onChange={(e) => {
                  const m = e.target.value;
                  if (!m) return;
                  setVertices((vs) => vs.map((v) => ({ ...v, metodo: m })));
                  e.target.value = "";
                  avisar("ok", `Método ${m} aplicado aos ${vertices.length} vértices.`);
                }}>
                  <option value="">aplicar a todos…</option>
                  {METODOS_POSICIONAMENTO.map((m) => <option key={m}>{m}</option>)}
                </select>
              </label>
              <button className={mostrarInserirV ? "principal" : ""} onClick={() => setMostrarInserirV((v) => !v)}>
                + Vértice pré-existente
              </button>
            </div>

            {mostrarInserirV && (
              <fieldset className="inserir-v painel" style={{ margin: 0 }}>
                <legend>Inserir vértice pré-existente · tipo V · método PA1 — vértice já certificado que precisa entrar no perímetro</legend>
                <label>após o ponto
                  <select value={novoV.aposOrdem} onChange={(e) => setNovoV({ ...novoV, aposOrdem: e.target.value })}>
                    <option value="">—</option>
                    {vertices.map((v) => <option key={v.ordem} value={v.ordem}>{nomePonto(v)}</option>)}
                  </select>
                </label>
                <label>código
                  <input className="mono" placeholder="DSBN-V-0758" value={novoV.codigo} onChange={(e) => setNovoV({ ...novoV, codigo: e.target.value })} />
                </label>
                <label>latitude GMS
                  <input className="mono" placeholder="11 24 30,375 S" value={novoV.lat} onChange={(e) => setNovoV({ ...novoV, lat: e.target.value })} />
                </label>
                <label>longitude GMS
                  <input className="mono" placeholder="39 4 47,198 W" value={novoV.lon} onChange={(e) => setNovoV({ ...novoV, lon: e.target.value })} />
                </label>
                <label>h (m)
                  <input className="mono" placeholder="289,765" style={{ width: 110 }} value={novoV.h} onChange={(e) => setNovoV({ ...novoV, h: e.target.value })} />
                </label>
                <label>sigma h
                  <input className="mono" style={{ width: 90 }} value={novoV.sigmaH} onChange={(e) => setNovoV({ ...novoV, sigmaH: e.target.value })} />
                </label>
                <button className="principal" onClick={inserirV}>Inserir</button>
                <button className="fantasma" onClick={() => setMostrarInserirV(false)}>cancelar</button>
              </fieldset>
            )}

            <div className="ordem-toolbar" role="toolbar" aria-label="Reordenar vértices">
              <b style={{ fontSize: 13 }}>Ordem dos pontos</b>
              <span className="sub" style={{ fontSize: 12.5 }}>
                {selVert.size ? `${selVert.size} selecionado(s)` : "marque os pontos (Shift + clique seleciona um intervalo) e mova o bloco"}
              </span>
              <span className="grupo">
                <button disabled={!selVert.size} onClick={() => reordenar({ tipo: "cima" })} title="sobe um passo">↑ subir</button>
                <button disabled={!selVert.size} onClick={() => reordenar({ tipo: "baixo" })} title="desce um passo">↓ descer</button>
              </span>
              <span className="grupo">
                <button disabled={!selVert.size} onClick={() => reordenar({ tipo: "inicio" })}>para o início</button>
                <button disabled={!selVert.size} onClick={() => reordenar({ tipo: "fim" })}>para o fim</button>
              </span>
              <label className="grupo" style={{ alignItems: "center", gap: 6 }}>
                <span className="sub" style={{ fontSize: 12.5 }}>para depois de</span>
                <select disabled={!selVert.size} defaultValue="" aria-label="Mover os selecionados para depois do ponto"
                  onChange={(e) => { if (e.target.value !== "") { reordenar({ tipo: "depois", ordem: Number(e.target.value) }); e.target.value = ""; } }}>
                  <option value="">—</option>
                  {[...vertices].sort((a, b) => a.ordem - b.ordem)
                    .filter((v) => !selVert.has(chaveV(v)))
                    .map((v) => <option key={chaveV(v)} value={v.ordem}>{v.ordem + 1}º · {nomePonto(v)}</option>)}
                </select>
              </label>
              <button disabled={selVert.size < 2} onClick={() => reordenar({ tipo: "inverter" })} title="inverte a sequência dos selecionados, nas mesmas posições">inverter</button>
              <span style={{ flex: 1 }} />
              <button className="fantasma" onClick={() => setSelVert(new Set(vertices.map(chaveV)))}>selecionar todos</button>
              <button className="fantasma" disabled={!selVert.size} onClick={() => { setSelVert(new Set()); setUltimoClicado(null); }}>limpar</button>
              <button className="fantasma" onClick={() => setExpandidos((e) => (e.size ? new Set() : new Set(vertices.map(chaveV))))}>{expandidos.size ? "recolher todos" : "expandir todos"}</button>
            </div>

            <div className="tabela-wrap" style={{ maxHeight: 640 }}>
              <table className="tabela-vertices compacta">
                <thead>
                  <tr><th></th><th>#</th><th>Nº</th><th>Rótulo TXT</th><th></th><th></th></tr>
                </thead>
                <tbody>
                  {[...vertices].sort((a, b) => a.ordem - b.ordem).map((v, idx) => {
                    const t = trechoDoVertice(trechosOrdenados, v.ordem);
                    const cor = t ? CORES[trechosOrdenados.indexOf(t) % CORES.length] : "#D5DDD8";
                    const ehInicial = v.ordem === verticeInicial;
                    const marcado = selVert.has(chaveV(v));
                    const aberto = expandidos.has(chaveV(v));
                    const alternarDetalhe = () => setExpandidos((s) => { const n = new Set(s); if (n.has(chaveV(v))) n.delete(chaveV(v)); else n.add(chaveV(v)); return n; });
                    return (
                      <Fragment key={chaveV(v)}>
                        <tr className={`${ehInicial ? "inicial" : ""} ${marcado ? "sel" : ""}`}>
                          <td onClick={(e) => alternarSelecaoV(idx, e.shiftKey)}>
                            <input type="checkbox" checked={marcado} aria-label={`Selecionar ${nomePonto(v)}`}
                              onClick={(e) => { e.stopPropagation(); alternarSelecaoV(idx, e.shiftKey); }} onChange={() => { /* onClick decide */ }} />
                          </td>
                          <td className="pos">{v.ordem + 1}</td>
                          <td className="num">{v.num_txt ?? "—"}{ehInicial ? " ★" : ""}</td>
                          <td>
                            <span className="ponto-trecho" style={{ background: cor }} aria-hidden="true" />
                            {v.rotulo_txt ? <span style={{ color: "#33453C" }}>{v.rotulo_txt}</span> : <span className="sub">—</span>}
                          </td>
                          <td className="resumo-v">
                            <span className={`chip ${v.tipo}`}>{v.tipo}</span>
                            {v.codigo && <span className="mono sub" style={{ fontSize: 11.5 }}>{v.codigo}</span>}
                          </td>
                          <td className="acao">
                            <button className="btn-expandir" aria-expanded={aberto} title={aberto ? "recolher" : "ver e editar código, tipo, método, coordenadas"}
                              onClick={alternarDetalhe}>{aberto ? "▴" : "▾"}</button>
                          </td>
                        </tr>
                        {aberto && (
                          <tr className="linha-detalhe">
                            <td colSpan={6}>
                              <div className="detalhe-grid">
                                <span><span className="rot">Código</span><span className="mono">{v.codigo ?? <span className="sub">na geração</span>}</span></span>
                                <span><span className="rot">Tipo</span>
                                  {v.inserido_manual ? (
                                    // V inserido à mão, ou vértice certificado do vizinho (código dele; um M
                                    // nosso igualado a ele continua M — a confrontação mora aí)
                                    <button className={`chip-tipo ${v.tipo}`} disabled
                                      title={/-[MPV]-/.test(v.codigo ?? "") && !/PA1/.test(v.metodo) ? "vértice certificado de parcela vizinha" : "vértice inserido"}>{v.tipo}</button>
                                  ) : (
                                    <button className={`chip-tipo ${v.tipo}`} title="Clique para alternar: M → P → V"
                                      onClick={() => setVertice(v.ordem, { tipo: proximoTipo(v.tipo) })}>{v.tipo}</button>
                                  )}
                                </span>
                                <span><span className="rot">Método</span>
                                  <select value={v.metodo} aria-label="Método de posicionamento" onChange={(e) => setVertice(v.ordem, { metodo: e.target.value })}>
                                    {METODOS_POSICIONAMENTO.map((m) => <option key={m}>{m}</option>)}
                                  </select>
                                </span>
                                <span><span className="rot">Latitude</span><span className="mono">{v.lat_gms}</span></span>
                                <span><span className="rot">Longitude</span><span className="mono">{v.lon_gms}</span></span>
                                <span><span className="rot">h (m)</span><span className="mono">{String(v.h).replace(".", ",")}</span></span>
                                {v.inserido_manual && <button className="remover" title="Remover vértice inserido" onClick={() => removerV(v.ordem)}>remover vértice</button>}
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
              <div className="tabela-rodape">{vertices.length} vértices · {preview.qtdM} M · {preview.qtdP} P · {preview.qtdV} V</div>
            </div>
              </div>{/* coluna-esq */}
              <div className="mapa">
                <MapaSVG vertices={vertices} trechos={trechosOrdenados} verticeInicial={verticeInicial} partes={partesOrdens ?? undefined} />
                {partesOrdens && (
                  <p className="sub" style={{ margin: 0 }}>
                    <b>Imóvel em {partesOrdens.length} partes</b> — cada bloco de numeração do TXT é um anel próprio
                    (glebas {glebas.filter((g) => g.anel.length >= 3).map((g) => g.nome).join(", ")}). Área e perímetro acima são a soma das partes.
                  </p>
                )}
                <div className="legenda">
                  {trechosOrdenados.map((t) => (
                    <span className="item" key={`leg-${t.vertice_inicio_ordem}`}>
                      <span className="ponto-cor" style={{ background: corDoTrecho(t) }} />
                      {numeracao.get(t.vertice_inicio_ordem) !== undefined && (
                        <span className="badge-num pequeno">{numeracao.get(t.vertice_inicio_ordem)}</span>
                      )}
                      {t.apelido_txt || `pt ${nomePonto(vertices.find((v) => v.ordem === t.vertice_inicio_ordem) ?? vertices[0])}`}
                      {ehRioPorLimite(t.tipo_limite)
                        ? <span className="marca-rio" title="Curso d'água (LN1): sai na planta como linha dupla azul"> ≈ rio</span>
                        : t.eh_via && <span className="marca-via" title="Faixa de domínio pública: sai na planta como linha dupla vermelha"> ═ via</span>}
                    </span>
                  ))}
                </div>
                <p className="sub" style={{ margin: 0 }}>
                  A linha dupla vermelha é o que sairá na planta como estrada. Se ela aparecer
                  onde não há estrada, desmarque "faixa de domínio" naquele trecho.
                  A linha dupla azul é o curso d'água: sai em todo trecho com tipo de limite
                  LN1. Se ali não houver rio, troque o tipo de limite.
                </p>
              </div>
            </div>
            {navEtapa}
          </>
        )}

        {/* ================= Etapa · Glebas (só no serviço com gleba) =================
            Fica ANTES da geração de propósito: as divisões têm de estar montadas
            quando a planta for desenhada, que é o pedido do fluxo de gleba. */}
        {etapa === "glebas" && temGlebas && (
          <>
            <section className="bloco" id="bloco-glebas">
              <header>
                <h3>Glebas</h3>
                <span className="desc">{glebas.length} gleba(s) — desenhadas dentro do perímetro, na mesma planta</span>
              </header>
              <GlebasEditor
                glebas={glebas}
                vertices={vertices}
                trechos={trechosOrdenados}
                servicoId={servico.id}
                areaTotalHa={Number(String(preview.areaHa).replace(/\./g, "").replace(",", ".")) || 0}
                onChange={setGlebas}
              />
              {glebas.filter((g) => g.anel.length >= 3).length > 0 && (
                <div className="rodape-bloco">
                  <BotaoPerigo
                    titulo="Separar cada gleba em um serviço próprio"
                    confirmacao={`criar ${glebas.filter((g) => g.anel.length >= 3).length} serviço(s)`}
                    onConfirmar={separarGlebas}
                    className=""
                  >Separar glebas em serviços</BotaoPerigo>
                  <span className="sub" style={{ flex: 1, minWidth: 260 }}>
                    Cria um serviço por gleba, com os vértices e os códigos que ela já tem.
                    Este serviço continua como está — separar não move nada.
                  </span>
                </div>
              )}
            </section>
            {navEtapa}
          </>
        )}

        {/* ================= Etapa · Documentos ================= */}
        {etapa === "documentos" && (
          <>
            {/* ---- Conferência de área: para aqui. No lugar do SIGEF e das peças, o
                que ela tem é o documento do imóvel, a folha da planta e o Memorial
                Tabular. Fica ANTES da imagem de satélite: tudo aqui decide o que a
                planta vai imprimir, e configuração depois do resultado é convite a
                gerar duas vezes. */}
            {ehConferencia && (
              <section className="bloco" id="bloco-conferencia">
                <header>
                  <h3>Conferência de área</h3>
                  <span className="desc">documento do imóvel, folha e entregas da prévia — não vai ao SIGEF e não consome numeração oficial</span>
                </header>

                <div className="grade">
                  <label>Folha da planta
                    <select value={servico.folha_conferencia ?? "A3"}
                      onChange={(e) => campo("folha_conferencia", e.target.value as Servico["folha_conferencia"])}>
                      <option value="A3">A3 (420×297 mm)</option>
                      <option value="A4">A4 (297×210 mm)</option>
                    </select>
                    <small className="sub">padrão A3 · vale na próxima geração dos documentos</small>
                  </label>

                  {/* Matrícula ou posse: é o que decide se a planta imprime
                      "(MATR./CNS.)" ou "(POSSE)". Posse não tem matrícula nem
                      cartório — os campos só aparecem para quem tem matrícula. E a
                      prévia pode acontecer antes de o imóvel ter qualquer documento:
                      é o terceiro estado, que não imprime nem um nem outro. */}
                  <label>Situação do imóvel
                    <select id="conf-situacao-imovel" value={situacaoImovel}
                      onChange={(e) => setSituacaoImovel(e.target.value as SituacaoImovel)}>
                      <option value="matricula">Matrícula (imóvel registrado)</option>
                      <option value="posse">Posse (imóvel sem matrícula)</option>
                      <option value="nao_informar">Ainda sem documento — não imprimir</option>
                    </select>
                    <small className="sub">
                      {situacaoImovel === "matricula" ? "a planta sai com (MATR./CNS.) e o campo Matrícula do Imóvel"
                        : situacaoImovel === "posse" ? "a planta sai com (POSSE) no lugar da matrícula"
                          : "a planta sai sem o bloco de matrícula/posse"}
                    </small>
                  </label>

                  {pedeMatricula(situacaoImovel) && (
                    <>
                      <label>Matrícula
                        <input id="conf-matricula" className="mono" value={servico.matricula ?? ""} placeholder="1.234"
                          onChange={(e) => campo("matricula", e.target.value || null)} />
                      </label>
                      <label>CNS (cartório)
                        <input className="mono" list="cartorios" value={servico.cns ?? ""} placeholder="00.810-2"
                          onChange={(e) => campo("cns", e.target.value || null)} />
                        <datalist id="cartorios">{cartorios.map((c) => <option key={c} value={c} />)}</datalist>
                      </label>
                    </>
                  )}
                </div>

                {/* A prévia acontece antes de o imóvel ter documento: a área pode não
                    ter nome e o TRT pode não ter sido emitido. Campo em branco na
                    planta parece dado perdido — aqui o operador diz o que existe. */}
                <fieldset className="fieldset-plano" style={{ marginTop: 18 }}>
                  <legend>O que sai na planta</legend>
                  {([
                    ["conf_exibir_denominacao", "Nome da fazenda", "a denominação no desenho e no planimétrico"],
                    ["conf_exibir_trt", "TRT", "o número do termo de responsabilidade técnica"],
                  ] as const).map(([campoNome, rotulo, dica]) => (
                    <label key={campoNome}>
                      <input type="checkbox" checked={servico[campoNome] !== false}
                        onChange={(e) => campo(campoNome, e.target.checked)} />
                      <b>{rotulo}</b>
                      <small className="sub">— {dica}</small>
                    </label>
                  ))}
                </fieldset>

                <div className="rodape-bloco">
                  <button onClick={gerarTabular} disabled={!docsProntos || gerandoTabular}>
                    {gerandoTabular ? <><span className="spinner" /> Gerando…</> : "Gerar Memorial Tabular"}
                  </button>
                  <span className="sub" style={{ flex: 1, minWidth: 260 }}>
                    {docsProntos
                      ? "Sai do cálculo do sistema, com os mesmos azimutes e distâncias do Memorial Descritivo. Não são os valores SGL que o SIGEF devolve após certificar — por isso vale como prévia."
                      : "Gere primeiro o memorial e a planta no botão do rodapé."}
                  </span>
                </div>

                {tabular && (
                  <div className="downloads" style={{ marginTop: 10 }}>
                    {tabular.map((a) => (
                      <a key={a.url} className="botao-download" href={a.url} target="_blank" rel="noreferrer">
                        <span className="ext">DOCX</span> {a.titulo}
                      </a>
                    ))}
                  </div>
                )}
              </section>
            )}

            <div className="grade-docs">
              {/* ---- Imagem de satélite: entra na planta desta etapa e na pós-SIGEF ---- */}
              <section className="bloco cartao" id="bloco-satelite">
                <header>
                  <h3>Imagem de satélite</h3>
                  <span className="desc">entra no quadro Planta de Situação · a mesma imagem serve às duas plantas</span>
                </header>
                <label className="dropzone compacta"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) carregarSatelite(f); }}>
                  {satelite
                    ? <><b>{satelite.nome}</b><span>clique para trocar a imagem</span></>
                    : salvo.satelite
                      ? <><b>Imagem guardada da geração anterior</b><span>não precisa reenviar — clique só se quiser trocar</span></>
                      : <><b>Enviar imagem (PNG/JPG)</b><span>necessária para gerar a planta junto do memorial e da planilha</span></>}
                  <input type="file" accept="image/png,image/jpeg" hidden
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) carregarSatelite(f); e.target.value = ""; }} />
                </label>
              </section>

              {/* ---- Documento do SIGEF (só após gerar os documentos) ----
                  Não montado na conferência: os handlers de SIGEF não podem ficar
                  acessíveis numa modalidade que não passa por ele. */}
              {!ehConferencia && (
                <section className={`bloco cartao ${docsProntos && !temSigef ? "destaque" : ""} ${!docsProntos ? "apagado" : ""}`} id="bloco-sigef">
                  <header>
                    <h3><span className="num-etapa">4</span>Documento do SIGEF</h3>
                    <span className="desc">
                      {docsProntos
                        ? "após certificar a planilha, envie o PDF de prévia/certificação — ele libera a planta e as peças"
                        : "liberado após a geração do memorial, da planilha e da planta"}
                    </span>
                  </header>
                  {!docsProntos ? (
                    <p className="sub" style={{ margin: 0 }}>
                      Gere o Memorial (DOCX), a Planilha (ODS) e a Planta (PDF) no botão "Gerar documentos" do rodapé ·
                      certifique no SIGEF · envie o PDF aqui · gere a Planta do SIGEF e as peças técnicas.
                    </p>
                  ) : sigefB64 || salvo.sigef ? (
                    <div className="acoes-linha">
                      <span className="ok" style={{ margin: 0 }}>
                        {sigefB64 ? `${sigefNome} carregado` : "PDF guardado da geração anterior"}
                      </span>
                      <label className="link" style={{ cursor: "pointer", color: "var(--primaria)", fontWeight: 500 }}>
                        trocar PDF
                        <input type="file" accept=".pdf" hidden
                          onChange={(e) => { const f = e.target.files?.[0]; if (f) carregarSigef(f); e.target.value = ""; }} />
                      </label>
                    </div>
                  ) : (
                    <label className="dropzone compacta destaque"
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) carregarSigef(f); }}>
                      <b>Arraste o PDF de prévia do SIGEF</b>
                      <span>com ele o sistema gera a Planta e as 7 peças técnicas</span>
                      <input type="file" accept=".pdf" hidden
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) carregarSigef(f); e.target.value = ""; }} />
                    </label>
                  )}

                  {/* ------- SIGEF acusou sobreposição? ------- */}
                  {docsProntos && (
                    <button className="aviso-sobreposicao" onClick={() => setSobreAberto((v) => !v)} aria-expanded={sobreAberto || sobreCsvs.length > 0}>
                      <b>O SIGEF acusou sobreposição?</b>
                      <span>recorta as invasões e regera a planilha</span>
                      <span className="seta">{sobreAberto || sobreCsvs.length > 0 || relatorioSobre ? "↑" : "→"}</span>
                    </button>
                  )}
                </section>
              )}
            </div>

            {!ehConferencia && docsProntos && (sobreAberto || sobreCsvs.length > 0 || relatorioSobre !== null) && (
              <section className="bloco" id="bloco-sobreposicao">
                <header>
                  <h3>Correção de sobreposição</h3>
                  <span className="desc">CSVs das parcelas certificadas que conflitam com esta</span>
                </header>
                <p className="sub" style={{ marginTop: 0 }}>
                  Quando há sobreposição, o SIGEF não gera o PDF e libera o CSV de cada parcela certificada
                  que conflita. Envie <b>todos</b> esses CSVs aqui. Com a opção abaixo ligada, a divisa com o
                  vizinho passa a ser descrita pelos <b>vértices já certificados dele</b> (mesmo código, mesmas
                  coordenadas do CSV): vértices nossos a menos da tolerância de um vértice certificado são
                  igualados a ele, e os vértices medidos dentro da parcela alheia saem. Onde ainda sobrar
                  conflito, o sistema recorta com o afastamento escolhido e insere vértices calculados
                  (tipo V · método PA1). Ao final regera a planilha ODS para reenvio ao SIGEF.
                </p>
                <div className="acoes-linha">
                  <label className="dropzone linha" style={{ flex: "1 1 280px" }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files?.length) carregarCsvsSobreposicao(e.dataTransfer.files); }}>
                    <b>Enviar CSVs das parcelas sobrepostas</b>
                    <span>exportacao (n).csv — pode selecionar vários de uma vez</span>
                    <input type="file" accept=".csv" multiple hidden
                      onChange={(e) => { if (e.target.files?.length) carregarCsvsSobreposicao(e.target.files); e.target.value = ""; }} />
                  </label>
                  <label className="marcador" style={{ fontSize: 13.5 }}>
                    <input type="checkbox" checked={usarCertificados} onChange={(e) => setUsarCertificados(e.target.checked)} />
                    <span>Usar os vértices certificados do vizinho
                      <small className="sub" style={{ display: "block" }}>divisa pelos pontos do CSV, sem pontos virtuais</small></span>
                  </label>
                  <label>Tolerância p/ igualar (m)
                    <input className="mono" style={{ width: 90 }} value={tolIgualar} disabled={!usarCertificados} onChange={(e) => setTolIgualar(e.target.value)} />
                    <small className="sub">vértice nosso até esta distância vira o certificado</small>
                  </label>
                  <label>Afastamento (m)
                    <input className="mono" style={{ width: 90 }} value={afastamento} onChange={(e) => setAfastamento(e.target.value)} />
                    <small className="sub">{usarCertificados ? "recuo onde ainda sobrar conflito" : "recuo aplicado à divisa"}</small>
                  </label>
                  <button className="principal" disabled={corrigindo || sobreCsvs.length === 0} onClick={corrigirSobreposicao}>
                    {corrigindo ? "Corrigindo e regerando…" : "Corrigir sobreposição e regerar planilha"}
                  </button>
                </div>
                {sobreCsvs.length > 0 && (
                  <div className="chips-arquivos">
                    {sobreCsvs.map((c) => (
                      <span key={c.nome} className="chip arquivo">
                        {c.nome}
                        <button className="remover" title="Remover CSV"
                          onClick={() => setSobreCsvs((prev) => prev.filter((x) => x.nome !== c.nome))}>✕</button>
                      </span>
                    ))}
                  </div>
                )}
                {relatorioSobre && (
                  <div style={{ marginTop: 14 }}>
                    <div className="tabela-wrap" style={{ maxWidth: 720 }}>
                      <table className="tabela-vertices">
                        <thead><tr><th>parcela (CSV)</th><th>sobreposição</th><th>situação</th></tr></thead>
                        <tbody>
                          {relatorioSobre.parcelas.map((p) => (
                            <tr key={p.nome}>
                              <td>{p.nome}</td>
                              <td className="mono">{p.areaSobrepostaM2.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} m²</td>
                              <td style={{ color: STATUS_PARCELA[p.status].cor, fontWeight: 600 }}>{STATUS_PARCELA[p.status].rotulo}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {(relatorioSobre.removidos.length > 0 || (relatorioSobre.compartilhados?.length ?? 0) > 0) && (
                      <p className="sub" style={{ margin: "8px 0 0" }}>
                        Área {relatorioSobre.areaAntesHa.toLocaleString("pt-BR", { minimumFractionDigits: 4 })} ha →{" "}
                        {relatorioSobre.areaDepoisHa.toLocaleString("pt-BR", { minimumFractionDigits: 4 })} ha ·{" "}
                        {relatorioSobre.mantidos} vértices mantidos
                        {(relatorioSobre.compartilhados?.length ?? 0) > 0 && (
                          <> · {relatorioSobre.compartilhados!.length} certificados do vizinho
                            {(relatorioSobre.igualados ?? 0) > 0 ? ` (${relatorioSobre.igualados} igualados)` : ""}:{" "}
                            <span className="mono">{relatorioSobre.compartilhados!.join(", ")}</span></>
                        )}
                        {relatorioSobre.novos.length > 0 && (
                          <> · {relatorioSobre.novos.length} virtuais ({relatorioSobre.novos[0]}…{relatorioSobre.novos[relatorioSobre.novos.length - 1]})</>
                        )}
                        {relatorioSobre.removidos.length > 0 && (
                          <> · {relatorioSobre.removidos.length} removidos: <span className="mono">{relatorioSobre.removidos.join(", ")}</span></>
                        )}
                      </p>
                    )}
                    {relatorioSobre.avisos.map((a, i) => (
                      <div key={i} className="erro" style={{ marginTop: 8, background: "var(--alerta-claro)", color: "var(--alerta-escuro)" }}>{a}</div>
                    ))}
                  </div>
                )}
              </section>
            )}

            {gerado && (
              <section className="bloco gerados" id="bloco-gerados">
                <header>
                  <h3>Documentos gerados</h3>
                  <span className="desc">regeração ilimitada — cada geração vira uma nova versão no histórico</span>
                </header>
                <div className="downloads">
                  <a className="botao-download" href={gerado.memorial_docx} target="_blank" rel="noreferrer">
                    <span className="ext">DOCX</span> Memorial Descritivo GEO
                  </a>
                  <a className="botao-download" href={gerado.planilha_ods} target="_blank" rel="noreferrer">
                    <span className="ext">ODS</span> Planilha SIGEF
                  </a>
                  {gerado.planta_pdf && (
                    <a className="botao-download" href={gerado.planta_pdf} target="_blank" rel="noreferrer">
                      <span className="ext">PDF</span> Planta {gerado.folha ?? "A1"} (dados do sistema)
                    </a>
                  )}
                </div>
                <p className="sub" style={{ margin: 0 }}>
                  Vértice inicial <span className="mono">{gerado.resumo.verticeInicial}</span> · M/P/V: {gerado.resumo.qtdM}/{gerado.resumo.qtdP}/{gerado.resumo.qtdV}
                </p>
              </section>
            )}

            {/* ---- Planta do SIGEF (A1 matrícula / A3 posse) ----
                `!ehConferencia` é redundante com `temSigef` (a conferência não tem
                onde carregar o PDF), mas explícito: a condição de existir é a
                modalidade, não o efeito colateral de um estado vazio. */}
            {!ehConferencia && docsProntos && temSigef && (
              <section className="bloco" id="bloco-planta">
                <header>
                  <h3><span className="num-etapa">5</span>Planta {folhaEfetiva} {servico.tipo_imovel === "posse" ? "(posse)" : "(matrícula)"} do SIGEF</h3>
                  <span className="desc">mesmo padrão da planta gerada com o memorial, mas desenhada a partir do PDF certificado do SIGEF · escala automática · carimbo e desenhista vêm das Configurações</span>
                </header>
                <div className="acoes-linha">
                  <label>Folha
                    <select value={folhaEfetiva} onChange={(e) => setFolhaPlanta(e.target.value as "A1" | "A3")}>
                      <option value="A1">A1 — modelo com quadro analítico</option>
                      <option value="A3">A3 — modelo sem quadro analítico</option>
                    </select>
                    <small className="sub">padrão: {servico.tipo_imovel === "posse" ? "A3 (posse)" : "A1 (matrícula)"}</small>
                  </label>
                  <label className="dropzone linha" style={{ flex: "1 1 280px" }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) carregarSatelite(f); }}>
                    {satelite
                      ? <b>{satelite.nome}</b>
                      : salvo.satelite
                        ? <><b>Imagem guardada da geração anterior</b><span>clique só se quiser trocar</span></>
                        : <><b>Enviar imagem de satélite (PNG/JPG)</b><span>obrigatória — entra no quadro Planta de Situação</span></>}
                    <input type="file" accept="image/png,image/jpeg" hidden
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) carregarSatelite(f); e.target.value = ""; }} />
                  </label>
                  <button className="principal" disabled={gerandoPlanta || !temSatelite} onClick={gerarPlanta}
                    title={!temSatelite ? "Envie a imagem de satélite primeiro" : undefined}>
                    {gerandoPlanta ? "Gerando planta…" : `Gerar Planta ${folhaEfetiva} do SIGEF (PDF)`}
                  </button>
                  {plantaUrl && (
                    <a className="botao-download" href={plantaUrl} target="_blank" rel="noreferrer">
                      <span className="ext">PDF</span> Planta {folhaEfetiva} (SIGEF)
                    </a>
                  )}
                </div>
              </section>
            )}

            {/* ---- Peças técnicas ---- */}
            {!ehConferencia && docsProntos && temSigef && (
              <section className="bloco" id="bloco-pecas">
                <header>
                  <h3><span className="num-etapa">6</span>Peças técnicas</h3>
                  <span className="desc">os dados abaixo + o memorial + o PDF do SIGEF viram as 7 peças (memorial, tabular, cartas, declarações, requerimento)</span>
                </header>

                {/* Só o que muda peça a peça fica à vista; a papelada do RT vem do
                    cadastro e só aparece quando estiver incompleta. */}
                <div className="grade">
                  <label>Situação do imóvel
                    <select value={servico.tipo_imovel ?? "matricula"} onChange={(e) => campo("tipo_imovel", e.target.value as "matricula" | "posse")}>
                      <option value="matricula">Matrícula (proprietário)</option>
                      <option value="posse">Posse (posseiro)</option>
                    </select>
                  </label>
                  <label>Gênero do detentor
                    <select value={servico.detentor_genero ?? "M"} onChange={(e) => campo("detentor_genero", e.target.value as "M" | "F")}>
                      <option value="M">Masculino</option><option value="F">Feminino</option>
                    </select>
                  </label>
                  <label style={{ gridColumn: "span 2" }}>Endereço dos requerentes
                    <input placeholder="Rua ..., Nº ..., Bairro, Cidade, Estado, CEP:..." value={servico.endereco_detentor ?? ""} onChange={(e) => campo("endereco_detentor", e.target.value || null)} />
                  </label>
                  <label>Área constante na matrícula (ha)
                    <input className="mono" placeholder="ex.: 86" value={servico.area_matricula_ha ?? ""} onChange={(e) => campo("area_matricula_ha", e.target.value || null)} />
                  </label>
                  <label>Faixas de domínio (detectadas na planta)
                    <input readOnly value={viasDetectadas.length ? viasDetectadas.join(" · ") : "nenhuma"} />
                    <small className="sub">{viasDetectadas.length
                      ? `sai ${viasDetectadas.length} ${viasDetectadas.length > 1 ? "declarações" : "declaração"} de faixa de domínio, uma por via`
                      : "sem estrada, corredor, linha férrea ou rodovia na confrontação — a declaração não é gerada"}</small>
                  </label>
                </div>

                <div className="secoes" style={{ marginTop: 22 }}>
                  <Secao titulo="Segundo requerente"
                    selo={<span className={`secao-selo ${servico.requerente2_nome ? "completa" : ""}`}>{servico.requerente2_nome || "nenhum"}</span>}
                    abrirEm={!!servico.requerente2_nome}
                    dica="cônjuge ou co-proprietário que assina junto">
                    <div className="grade">
                      <label>Requerente 2 (opcional)
                        <input value={servico.requerente2_nome ?? ""} onChange={(e) => campo("requerente2_nome", e.target.value || null)} />
                      </label>
                      <label>CPF do requerente 2
                        <input className="mono" value={servico.requerente2_cpf ?? ""} onChange={(e) => campo("requerente2_cpf", e.target.value || null)} />
                      </label>
                      <label>Gênero do requerente 2
                        <select value={servico.requerente2_genero ?? "M"} onChange={(e) => campo("requerente2_genero", e.target.value as "M" | "F")}>
                          <option value="M">Masculino</option><option value="F">Feminino</option>
                        </select>
                      </label>
                      <label>RG do detentor (opcional)
                        <input value={servico.detentor_rg ?? ""} onChange={(e) => campo("detentor_rg", e.target.value || null)} />
                      </label>
                    </div>
                  </Secao>

                  <Secao titulo="Dados do responsável técnico nas peças"
                    selo={(() => {
                      const n = contarPreenchidos([rtExtras.formacao, rtExtras.conselho_sigla, rtExtras.conselho_numero, rtExtras.identidade, rtExtras.cpf]);
                      return <span className={`secao-selo ${n === 5 ? "completa" : n === 0 ? "vazia" : ""}`}>{n} de 5</span>;
                    })()}
                    abrirEm={contarPreenchidos([rtExtras.formacao, rtExtras.conselho_numero, rtExtras.identidade, rtExtras.cpf]) < 4}
                    dica={rtSel ? `salvo no cadastro de ${rtSel.nome}` : "selecione um RT na etapa Dados"}>
                    <div className="grade">
                      <label>Formação do RT
                        <input placeholder="Técnico em Agropecuária" value={rtExtras.formacao} onChange={(e) => setRtExtras({ ...rtExtras, formacao: e.target.value })} />
                      </label>
                      <label>Conselho (sigla)
                        <input placeholder="CFTA / CREA" value={rtExtras.conselho_sigla} onChange={(e) => setRtExtras({ ...rtExtras, conselho_sigla: e.target.value })} />
                      </label>
                      <label>Conselho (número)
                        <input className="mono" placeholder="0578839458-9" value={rtExtras.conselho_numero} onChange={(e) => setRtExtras({ ...rtExtras, conselho_numero: e.target.value })} />
                      </label>
                      <label>Identidade do RT
                        <input placeholder="00.000.000-00 SSP/BA" value={rtExtras.identidade} onChange={(e) => setRtExtras({ ...rtExtras, identidade: e.target.value })} />
                      </label>
                      <label>CPF do RT
                        <input className="mono" value={rtExtras.cpf} onChange={(e) => setRtExtras({ ...rtExtras, cpf: e.target.value })} />
                      </label>
                    </div>
                  </Secao>
                </div>

                <div className="rodape-bloco">
                  <button className="principal" disabled={gerandoPecas} onClick={gerarPecas}>
                    {gerandoPecas ? "Gerando as 7 peças técnicas…" : "Gerar peças técnicas"}
                  </button>
                </div>
                {erroPecas && <div className="erro">{erroPecas}</div>}
                {pecas && (
                  <div style={{ marginTop: 14 }}>
                    <p className="sub" style={{ margin: "0 0 8px" }}>
                      Área SGL {pecas.resumo.areaHa} ha · perímetro {pecas.resumo.perimetro} m · TRT {pecas.resumo.trt} ·{" "}
                      {pecas.resumo.vertices} vértices · {pecas.resumo.cartas} carta(s) de anuência{pecas.resumo.via ? ` · via ${pecas.resumo.via}` : ""}
                    </p>
                    <div className="downloads">
                      {pecas.arquivos.map((a) => (
                        <a key={a.titulo} className="botao-download" href={a.url} target="_blank" rel="noreferrer">
                          <span className="ext">DOCX</span> {a.titulo}
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </section>
            )}

            {/* ---- Histórico de documentos ---- */}
            <section className="bloco">
              <header>
                <h3>Histórico de documentos</h3>
                <span className="desc">cada geração vira uma versão preservada — baixe qualquer uma a qualquer momento</span>
              </header>
              <HistoricoDocs servicoId={servico.id} />
            </section>
            {navEtapa}
          </>
        )}
      </div>

      {/* ---------------- Barra fixa (preview) ---------------- */}
      <footer className="preview">
        <div className="stats">
          <span className="stat"><span className="rotulo">Fuso</span><span className="valor">{servico.fuso_utm}S · MC-{Math.abs(6 * (servico.fuso_utm ?? 24) - 183)}°W</span></span>
          <span className="stat"><span className="rotulo">Área</span><span className="valor">{preview.areaHa} ha</span></span>
          <span className="stat"><span className="rotulo">Perímetro</span><span className="valor">{preview.perimetroM} m</span></span>
          <span className="stat"><span className="rotulo">M / P / V</span><span className="valor">{preview.qtdM} / {preview.qtdP} / {preview.qtdV}</span></span>
          {!preview.erro && (
            <button className="link-previa" onClick={() => setPreviaAberta((v) => !v)} aria-expanded={previaAberta}>
              {previaAberta ? "ocultar prévia" : "prévia do memorial"}
            </button>
          )}
          <span className="acoes">
            <button disabled={ocupado} onClick={apenasSalvar}>Salvar rascunho</button>
            {!ehConferencia && (
              <select value={folhaEfetiva} title="Folha da planta que sai junto com o memorial e a planilha" aria-label="Folha da planta"
                onChange={(e) => setFolhaPlanta(e.target.value as "A1" | "A3")}>
                <option value="A1">Planta A1 (com quadro analítico)</option>
                <option value="A3">Planta A3 (sem quadro analítico)</option>
              </select>
            )}
            <button disabled={ocupado} className="principal" onClick={gerar}
              title={pendencias.length
                ? `Pendências: ${pendencias.map((p) => p.msg).join("; ")}`
                : temSatelite ? "Gerar Memorial DOCX + Planilha ODS + Planta PDF" : "Envie a imagem de satélite para gerar a planta junto"}>
              {ocupado ? "Gerando…" : "Gerar documentos"}
            </button>
          </span>
        </div>
        {pendencias.length > 0 && (
          <div className="pendencias-lista">
            Antes de gerar:{" "}
            {pendencias.map((p, i) => (
              <button key={i} className="link-pendencia" onClick={() => irParaCampo(p.alvo, true)}>{p.msg}</button>
            ))}
          </div>
        )}
        {preview.erro
          ? <div className="erro">{preview.erro}</div>
          : <div className={`paragrafo ${previaAberta ? "aberto" : ""}`}>{preview.primeiroParagrafo}</div>}
        {erro && <div className="erro">{erro}</div>}
      </footer>
    </div>
  );
}
