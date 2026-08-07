// Tela de conferência (5.2): dados do serviço, confrontantes (+ mapa SVG),
// vértices e preview fixo no rodapé. O banco é a fonte da verdade;
// "Gerar documentos" salva e chama a Edge Function gerar-documentos.
//
// Experiência: só os campos que bloqueiam a geração ficam sempre visíveis; o
// resto vive em seções recolhíveis com selo de preenchimento. O cartão de
// próxima ação diz em uma frase o que falta, e o trabalho é salvo sozinho.
import { useEffect, useMemo, useState } from "react";
import { chamarFuncao, supabase } from "../lib/supabase";
import {
  LADOS, METODOS_POSICIONAMENTO, NATUREZAS_AREA, NATUREZAS_SERVICO,
  rotuloRT, SITUACOES, TIPOS_LIMITE, TIPOS_PESSOA, UFS,
} from "../lib/domains";
import { calcularPreviewLocal } from "../lib/preview";
import { ehViaPorLimite, moverConfrontacao, SEM_CONFRONTACAO, viasDaPlanta } from "../lib/trechos";
import { chaveDoServico, rotuloCurto, vaiAoSigef } from "../lib/modalidades";
import { areaHaDoAnel, GlebasEditor } from "./GlebasEditor";
import type { Gleba } from "../lib/types";
import { contarPreenchidos, inferirUf, useAutosave, useAvisos } from "../lib/ux";
import type { Cliente, Credenciado, RT, Servico, Trecho, Vertice } from "../lib/types";
import type { ResultadoParse } from "./Upload";
import { CORES, MapaSVG } from "./MapaSVG";
import { HistoricoDocs } from "./HistoricoDocs";
import { Avisos, BotaoPerigo, Passos, ProximaAcao, Secao, StatusSalvamento, irPara, type Acao, type Passo } from "./ui";

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
}

const STATUS_PARCELA: Record<RelatorioSobreposicao["parcelas"][number]["status"], { rotulo: string; cor: string }> = {
  corrigida: { rotulo: "corrigida (afastada)", cor: "#3cb44b" },
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
  const [sigefB64, setSigefB64] = useState<string | null>(null);
  const [sigefNome, setSigefNome] = useState<string | null>(null);
  const [satelite, setSatelite] = useState<{ b64: string; tipo: "png" | "jpg"; nome: string } | null>(null);
  const [ufSugerida, setUfSugerida] = useState(false);

  // correção de sobreposição SIGEF (CSVs das parcelas certificadas sobrepostas)
  const [sobreCsvs, setSobreCsvs] = useState<{ nome: string; conteudo: string }[]>([]);
  const [afastamento, setAfastamento] = useState("0,50");
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
      })),
    [vertices],
  );

  const preview = useMemo(
    () => calcularPreviewLocal(servico.fuso_utm ?? 24, vertices, trechosOrdenados, credenciado),
    [servico.fuso_utm, vertices, trechosOrdenados, credenciado],
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

  // ------- Bloco 2: trechos -------
  // Editar a confrontação é editar o vértice M: marcar/desmarcar o M é o mesmo ato
  // que criar/remover o trecho, então os dois nunca divergem.
  function setTrecho(t: Trecho, patch: Partial<Trecho>) {
    const { vertice_inicio_ordem: _ord, servico_id: _sid, ...conf } = patch;
    setVertices((vs) => vs.map((v) => (v.ordem === t.vertice_inicio_ordem ? { ...v, ...conf } : v)));
  }
  function addTrecho(ordem: number) {
    setVertices((vs) => vs.map((v) => (v.ordem === ordem && v.tipo !== "M"
      ? { ...v, tipo: "M", descritivo: "", tipo_limite: "LA1", eh_via: false, apelido_txt: v.apelido_txt ?? "" }
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
        tipo: "V" as const, codigo: novoV.codigo, metodo: "PA1", inserido_manual: true,
        lat_gms: novoV.lat, lon_gms: novoV.lon,
        // V é ponto intermediário: nunca carrega confrontação
        descritivo: null, tipo_limite: null, eh_via: false,
        cns: null, matricula: null, apelido_txt: null,
      }].sort((a, b) => a.ordem - b.ordem);
    });
    // a confrontação viaja com o próprio vértice: não há âncora para reindexar
    setNovoV({ aposOrdem: "", codigo: "", lat: "", lon: "", h: "", sigmaH: "0,02" });
    avisar("ok", "Vértice V inserido.");
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
        { servico_id: servico.id, afastamento: Number(afastamento.replace(",", ".")) || 0.5, csvs: sobreCsvs },
      );
      setRelatorioSobre(r.relatorio);
      if (r.corrigido) {
        // recarrega o serviço corrigido e regera os documentos direto do banco
        const { data: sv } = await supabase.from("servicos").select().eq("id", servico.id).single();
        if (sv) setServico(sv as Servico);
        const g = await chamarFuncao<Gerado>("gerar-documentos", {
          servico_id: servico.id,
          satelite_base64: satelite?.b64, satelite_tipo: satelite?.tipo,
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
      });
      setPlantaUrl(r.planta_pdf);
      avisar("ok", `Planta ${servico.tipo_imovel === "posse" ? "A3" : "A1"} gerada.`);
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
      irPara(pendencias[0].alvo, true);
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
        irPara("bloco-satelite", true);
        return;
      }
      await salvar();
      const r = await chamarFuncao<Gerado>("gerar-documentos", {
        servico_id: servico.id,
        satelite_base64: sat.b64, satelite_tipo: sat.tipo,
      });
      setGerado(r);
      for (const a of r.avisos ?? []) avisar("alerta", a);
      avisar("ok", r.planta_pdf ? "Memorial, planilha e planta gerados com sucesso." : "Memorial e planilha gerados com sucesso.");
      const { data } = await supabase.from("vertices").select().eq("servico_id", servico.id).order("ordem");
      if (data) setVertices(data as Vertice[]);
      requestAnimationFrame(() => document.querySelector(".gerados")?.scrollIntoView({ behavior: "smooth", block: "center" }));
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

  // ------- estado do processo: trilha de etapas e próxima ação -------
  const confrontantesPreenchidos = trechosOrdenados.filter((t) => t.descritivo || t.apelido_txt).length;
  const pecasProntas = pecas !== null;

  // A trilha da conferência tem 3 etapas e termina nos documentos; a do serviço
  // completo segue até as peças. É a mesma lista, cortada — não duas listas.
  const passos: Passo[] = [
    { rotulo: "Dados", estado: pendencias.length === 0 ? "feita" : "ativa", alvo: "bloco-dados" },
    {
      rotulo: "Confrontantes",
      estado: confrontantesPreenchidos > 0 ? "feita" : pendencias.length === 0 ? "ativa" : "futura",
      alvo: "bloco-confrontantes",
    },
    ...(temGlebas ? [{
      rotulo: "Glebas",
      estado: (glebas.some((g) => g.anel.length >= 3) ? "feita" : "ativa") as Passo["estado"],
      alvo: "bloco-glebas",
    }] : []),
    {
      rotulo: ehConferencia ? "Memorial & planta" : "Memorial, planilha & planta",
      estado: docsProntos ? "feita" : "futura",
      alvo: docsProntos ? "bloco-gerados" : undefined,
    },
    ...(ehConferencia ? [] : [
      { rotulo: "PDF do SIGEF", estado: (temSigef ? "feita" : docsProntos ? "ativa" : "futura") as Passo["estado"], alvo: docsProntos ? "bloco-sigef" : undefined },
      {
        rotulo: "Planta do SIGEF & Peças",
        estado: (plantaUrl && pecasProntas ? "feita" : temSigef ? "ativa" : "futura") as Passo["estado"],
        alvo: sigefB64 ? "bloco-planta" : undefined,
      },
    ]),
  ];

  // Interface preditiva: a tela é longa e o processo tem 5 estágios — este
  // cartão elimina a pergunta "e agora?" respondendo com a ação seguinte.
  const proxima = useMemo<Acao>(() => {
    if (pendencias.length > 0) {
      return {
        tom: "pendente",
        titulo: `Faltam ${pendencias.length} ${pendencias.length === 1 ? "campo obrigatório" : "campos obrigatórios"}`,
        detalhe: pendencias.map((p) => p.msg).join(" · "),
        rotuloBotao: "Ir para o primeiro",
        onClick: () => irPara(pendencias[0].alvo, true),
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
        onClick: () => irPara("bloco-satelite"),
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
        detalhe: "memorial e planta de prévia gerados — os códigos são provisórios e a numeração oficial não foi consumida",
      };
    }
    if (!temSigef) {
      return {
        tom: "neutro",
        titulo: "Certifique a planilha no SIGEF e envie o PDF de volta",
        detalhe: "o PDF de prévia/certificação libera a planta oficial e as 7 peças técnicas",
        rotuloBotao: "Enviar PDF",
        onClick: () => irPara("bloco-sigef"),
      };
    }
    if (!temSatelite) {
      return {
        tom: "neutro",
        titulo: "Envie a imagem de satélite da área",
        detalhe: "obrigatória para o quadro PLANTA DE SITUAÇÃO da planta do SIGEF",
        rotuloBotao: "Enviar imagem",
        onClick: () => irPara("bloco-satelite"),
      };
    }
    if (!plantaUrl) {
      return {
        tom: "neutro",
        titulo: `Gere a Planta ${servico.tipo_imovel === "posse" ? "A3" : "A1"} do SIGEF`,
        rotuloBotao: "Ir para a planta",
        onClick: () => irPara("bloco-planta"),
      };
    }
    if (!pecasProntas) {
      return {
        tom: "neutro",
        titulo: "Gere as 7 peças técnicas",
        rotuloBotao: "Ir para as peças",
        onClick: () => irPara("bloco-pecas"),
      };
    }
    return { tom: "pronto", titulo: "Serviço completo", detalhe: "memorial, planilha, as duas plantas e as peças gerados — tudo disponível no histórico abaixo" };
  }, [pendencias, docsProntos, temSigef, temSatelite, plantaUrl, pecasProntas, preview, confrontantesPreenchidos, servico.tipo_imovel, ehConferencia]);

  // selos das seções recolhidas: dizem o que há dentro sem precisar abrir
  const seloRegistro = contarPreenchidos([
    servico.situacao, servico.natureza_area, servico.natureza_servico,
    servico.tipo_pessoa, servico.codigo_sncr, servico.cns, servico.matricula,
  ]);
  const seloParcela = contarPreenchidos([servico.denominacao_parcela, servico.parcela_numero, servico.lado]);

  return (
    <div className="conferencia">
      <Avisos avisos={avisos} onFechar={fechar} />
      <Passos passos={passos} />

      <header className="topo">
        <button className="fantasma" onClick={onVoltar}>← Serviços</button>
        <span className={`chip mod-${chaveDoServico(servico)}`}>{rotuloCurto[chaveDoServico(servico)]}</span>
        <span className="arquivo">📄 {servico.nome_arquivo_txt}</span>
        <StatusSalvamento estado={auto.estado} horaSalvo={auto.horaSalvo} />
        <span className="esticar" />
        <label>Fuso UTM{" "}
          <select value={servico.fuso_utm ?? 24} onChange={(e) => campo("fuso_utm", Number(e.target.value))}>
            {[18, 19, 20, 21, 22, 23, 24, 25].map((z) => (
              <option key={z} value={z}>{z}S{inicial.preview.candidatos.includes(z) ? " •" : ""}</option>
            ))}
          </select>
        </label>
        {/* Fuso ambíguo era só um alerta em texto: agora os candidatos viram
            botões, porque a decisão é entre dois valores concretos. */}
        {inicial.preview.fusoAmbiguo && (
          <span className="alerta" style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
            fuso ambíguo — confirme:
            {inicial.preview.candidatos.map((z) => (
              <button key={z} onClick={() => campo("fuso_utm", z)}
                style={{ padding: "2px 8px", fontSize: 12, fontWeight: 700 }}
                aria-pressed={servico.fuso_utm === z}>{z}S</button>
            ))}
          </span>
        )}
        {inicial.preview.foraDaUf && <em className="alerta">coordenadas fora da UF informada!</em>}
      </header>

      <ProximaAcao acao={proxima} />

      {/* ---------------- Bloco 1: dados do serviço ---------------- */}
      <section className="bloco" id="bloco-dados">
        <header>
          <span className="num-bloco">1</span>
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
          <label>Credenciado *
            <select id="campo-credenciado" className={obg(servico.credenciado_id)}
              value={servico.credenciado_id ?? ""} onChange={(e) => campo("credenciado_id", e.target.value || null)}>
              <option value="">—</option>
              {credenciados.map((c) => <option key={c.id} value={c.id}>{c.nome} ({c.prefixo_vertice})</option>)}
            </select>
          </label>
          <label>Detentor *
            <input id="campo-detentor" className={obg(servico.detentor_nome)} list="detentores" value={servico.detentor_nome ?? ""} onChange={(e) => {
              campo("detentor_nome", e.target.value);
              const d = detentores.find((x) => x.nome === e.target.value);
              if (d?.cpf) campo("detentor_cpf", d.cpf);
            }} />
            <datalist id="detentores">{detentores.map((d) => <option key={d.nome} value={d.nome} />)}</datalist>
          </label>
          <label>CPF/CNPJ <input value={servico.detentor_cpf ?? ""} onChange={(e) => campo("detentor_cpf", e.target.value)} /></label>
          <label>Denominação * <input id="campo-denominacao" className={obg(servico.denominacao)} value={servico.denominacao ?? ""} onChange={(e) => campo("denominacao", e.target.value)} /></label>
          <label>Município * <input id="campo-municipio" className={obg(servico.municipio)} value={servico.municipio ?? ""} onChange={(e) => campo("municipio", e.target.value)} /></label>
          <label>UF *
            <select id="campo-uf" className={obg(servico.uf)} value={servico.uf ?? ""}
              onChange={(e) => { campo("uf", e.target.value); setUfSugerida(false); }}>
              <option value="">—</option>
              {UFS.map((u) => <option key={u}>{u}</option>)}
            </select>
            {ufSugerida && <small className="sub">sugerida pelo histórico de {servico.municipio} — confira</small>}
          </label>
        </div>

        <Secao titulo="Responsável técnico e TRT"
          selo={<span className={rtSel ? "secao-selo completa" : "secao-selo vazia"}>{rtSel ? rtSel.nome : "não definido"}</span>}
          dica="assina o memorial, as peças e a planta">
          <div className="grade">
            <label>Responsável Técnico
              <select value={servico.rt_id ?? ""} onChange={(e) => campo("rt_id", e.target.value || null)}>
                <option value="">—</option>
                {rts.map((r) => <option key={r.id} value={r.id}>{rotuloRT(r)}</option>)}
              </select>
              <small className="sub">cadastre novos em ⚙ Configurações</small>
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

        <Secao titulo="Registro, cartório e natureza"
          selo={<span className={`secao-selo ${seloRegistro === 7 ? "completa" : seloRegistro === 0 ? "vazia" : ""}`}>{seloRegistro} de 7</span>}
          dica="matrícula, CNS, SNCR e classificações do SIGEF">
          <div className="grade">
            <label>Natureza do serviço {sel(servico.natureza_servico, NATUREZAS_SERVICO, (v) => campo("natureza_servico", v))}</label>
            <label>Tipo pessoa {sel(servico.tipo_pessoa, TIPOS_PESSOA, (v) => campo("tipo_pessoa", v))}</label>
            <label>Situação {sel(servico.situacao, SITUACOES, (v) => campo("situacao", v))}</label>
            <label>Natureza da área {sel(servico.natureza_area, NATUREZAS_AREA, (v) => campo("natureza_area", v))}</label>
            <label>Código SNCR <input value={servico.codigo_sncr ?? ""} onChange={(e) => campo("codigo_sncr", e.target.value)} /></label>
            <label>CNS (cartório)
              <input list="cartorios" value={servico.cns ?? ""} onChange={(e) => campo("cns", e.target.value)} />
              <datalist id="cartorios">{cartorios.map((c) => <option key={c} value={c} />)}</datalist>
            </label>
            <label>Matrícula <input value={servico.matricula ?? ""} onChange={(e) => campo("matricula", e.target.value)} /></label>
          </div>
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
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", marginBottom: 10 }}>
            <input type="checkbox" checked={!!servico.is_espolio} onChange={(e) => campo("is_espolio", e.target.checked)} />
            <b>É Espólio? (possuidor/proprietário falecido com inventariante)</b>
          </label>
          {servico.is_espolio && (
            <div className="grade">
              <label>Nome do Inventariante <input value={servico.inventariante_nome ?? ""} onChange={(e) => campo("inventariante_nome", e.target.value || null)} placeholder="Nome do inventariante" /></label>
              <label>CPF do Inventariante <input value={servico.inventariante_cpf ?? ""} onChange={(e) => campo("inventariante_cpf", e.target.value || null)} placeholder="000.000.000-00" /></label>
              <label>RG do Inventariante (opcional) <input value={servico.inventariante_rg ?? ""} onChange={(e) => campo("inventariante_rg", e.target.value || null)} placeholder="00.000.000-00" /></label>
            </div>
          )}
        </Secao>
      </section>

      {/* ---------------- Bloco 2: confrontantes ---------------- */}
      <section className="bloco" id="bloco-confrontantes">
        <header>
          <span className="num-bloco">2</span>
          <h3>Confrontantes</h3>
          <span className="desc">
            {trechosOrdenados.length} trecho(s) · {confrontantesPreenchidos} descrito(s) — as cores correspondem ao mapa
          </span>
        </header>
        <div className="confrontantes">
          <div className="trechos">
            {trechosOrdenados.map((t) => {
              const v = vertices.find((x) => x.ordem === t.vertice_inicio_ordem);
              return (
                <div className="trecho" key={`t-${t.vertice_inicio_ordem}`}
                  style={{ ["--cor-trecho" as string]: corDoTrecho(t) }}>
                  <div className="linha">
                    {/* Trocar o ponto aqui move a confrontação inteira — o descritivo,
                        o apelido, o CNS e a matrícula vão junto. */}
                    <label title="Vértice M onde esta confrontação começa; ela vai até o próximo M. Trocar move a confrontação para o outro ponto, sem redigitar nada.">
                      Inicia no ponto
                      <select className="mono" style={{ fontWeight: 700 }}
                        value={t.vertice_inicio_ordem}
                        onChange={(e) => moverTrecho(t, Number(e.target.value))}>
                        {[...vertices]
                          .filter((x) => x.tipo !== "M" || x.ordem === t.vertice_inicio_ordem)
                          .sort((a, b) => a.ordem - b.ordem)
                          .map((x) => (
                            <option key={x.ordem} value={x.ordem}>
                              {nomePonto(x)}{x.ordem === t.vertice_inicio_ordem ? " (atual)" : ""}
                            </option>
                          ))}
                      </select>
                    </label>
                    <label>Apelido
                      <input value={t.apelido_txt ?? ""} placeholder="ex.: Varguim Serra"
                        style={{ width: 150 }}
                        onChange={(e) => setTrecho(t, { apelido_txt: e.target.value || null })} />
                    </label>
                    <label>Tipo limite
                      <select value={t.tipo_limite} onChange={(e) => setTrecho(t, { tipo_limite: e.target.value })}>
                        {TIPOS_LIMITE.map((l) => <option key={l}>{l}</option>)}
                      </select>
                    </label>
                    <label title={ehViaPorLimite(t.tipo_limite)
                      ? "LA3 é limite de faixa de domínio: sempre via"
                      : "Estrada, rodovia, corredor, linha férrea, rio — desenhada na planta como linha dupla vermelha"}>
                      <input type="checkbox" checked={t.eh_via || ehViaPorLimite(t.tipo_limite)}
                        disabled={ehViaPorLimite(t.tipo_limite)}
                        onChange={(e) => setTrecho(t, { eh_via: e.target.checked })} />
                      {" "}faixa de domínio pública{ehViaPorLimite(t.tipo_limite) ? " (LA3)" : ""}
                    </label>
                    <label>CNS <input style={{ width: 110 }} value={t.cns ?? ""} onChange={(e) => setTrecho(t, { cns: e.target.value || null })} /></label>
                    <label>Matrícula <input style={{ width: 100 }} value={t.matricula ?? ""} onChange={(e) => setTrecho(t, { matricula: e.target.value || null })} /></label>
                    <span style={{ flex: 1 }} />
                    <button className="remover" title="Remover trecho" onClick={() => removeTrecho(t)}>✕ remover</button>
                  </div>
                  <textarea
                    placeholder={"Descritivo formal (opcional), ex.: (MATR.432/CNS.00.770-8) FAZENDA LAMEIRO\\ RUDSON PINTO FERREIRA\\ CPF:791.234.145-53"}
                    value={t.descritivo} onChange={(e) => setTrecho(t, { descritivo: e.target.value })} />
                  {!t.descritivo && <div className="pendencia" style={{ color: "var(--texto-2)" }}>descritivo vazio — o memorial usará o apelido {t.apelido_txt ? `"${t.apelido_txt}"` : "(vazio: segue sem cláusula de confrontação)"} · inicia no pt {v ? nomePonto(v) : "?"}</div>}
                </div>
              );
            })}
            <div className="add-trecho">
              <span>Nova transição de confrontante no ponto</span>
              <select id="novo-trecho-ordem" defaultValue="">
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
          <div className="mapa">
            <MapaSVG vertices={vertices} trechos={trechosOrdenados} verticeInicial={verticeInicial} />
            <div className="legenda">
              {trechosOrdenados.map((t) => (
                <span className="item" key={`leg-${t.vertice_inicio_ordem}`}>
                  <span className="ponto-cor" style={{ background: corDoTrecho(t) }} />
                  {t.apelido_txt || `pt ${nomePonto(vertices.find((v) => v.ordem === t.vertice_inicio_ordem) ?? vertices[0])}`}
                  {t.eh_via && <span className="marca-via" title="Faixa de domínio pública: sai na planta como linha dupla vermelha"> ═ via</span>}
                </span>
              ))}
            </div>
            <p className="desc" style={{ marginTop: 6 }}>
              A linha dupla vermelha é o que sairá na planta como estrada. Se ela aparecer
              onde não há estrada, desmarque "faixa de domínio pública" naquele trecho.
            </p>
          </div>
        </div>
      </section>

      {/* ---------------- Bloco 3: vértices ---------------- */}
      <section className="bloco" id="bloco-vertices">
        <header>
          <span className="num-bloco">3</span>
          <h3>Vértices</h3>
          <span className="desc">
            {vertices.length} pontos · início automático em {(() => {
              const v = vertices.find((x) => x.ordem === verticeInicial);
              return v ? nomePonto(v) : "—";
            })()} (mais ao norte, exigido pelo SIGEF)
          </span>
        </header>
        <div className="acoes-vertices">
          {/* O método era um select por linha: em 60 vértices, 60 cliques para
              trocar todos. Aqui troca de uma vez, sem perder o ajuste por linha. */}
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            Método de posicionamento em massa
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
          <Secao titulo="Inserir vértice pré-existente" dica="tipo V · método PA1 — vértice já certificado que precisa entrar no perímetro">
            <div className="inserir-v" style={{ border: "none", padding: 0, background: "transparent" }}>
              <label>após o ponto
                <select value={novoV.aposOrdem} onChange={(e) => setNovoV({ ...novoV, aposOrdem: e.target.value })}>
                  <option value="">—</option>
                  {vertices.map((v) => <option key={v.ordem} value={v.ordem}>{nomePonto(v)}</option>)}
                </select>
              </label>
              <label>código
                <input placeholder="DSBN-V-0758" value={novoV.codigo} onChange={(e) => setNovoV({ ...novoV, codigo: e.target.value })} />
              </label>
              <label>latitude GMS
                <input placeholder="11 24 30,375 S" value={novoV.lat} onChange={(e) => setNovoV({ ...novoV, lat: e.target.value })} />
              </label>
              <label>longitude GMS
                <input placeholder="39 4 47,198 W" value={novoV.lon} onChange={(e) => setNovoV({ ...novoV, lon: e.target.value })} />
              </label>
              <label>h (m)
                <input placeholder="289,765" style={{ width: 100 }} value={novoV.h} onChange={(e) => setNovoV({ ...novoV, h: e.target.value })} />
              </label>
              <label>sigma h
                <input style={{ width: 80 }} value={novoV.sigmaH} onChange={(e) => setNovoV({ ...novoV, sigmaH: e.target.value })} />
              </label>
              <button onClick={inserirV}>+ inserir</button>
            </div>
          </Secao>
        </div>
        <div className="tabela-wrap">
          <table className="tabela-vertices">
            <thead>
              <tr><th>nº TXT</th><th>código</th><th>tipo</th><th>método</th><th>latitude</th><th>longitude</th><th>h (m)</th><th></th></tr>
            </thead>
            <tbody>
              {vertices.map((v) => (
                <tr key={v.ordem} className={v.ordem === verticeInicial ? "inicial" : ""}>
                  <td>{v.num_txt ?? "—"}{v.rotulo_txt ? ` · ${v.rotulo_txt}` : ""}{v.ordem === verticeInicial ? " ★" : ""}</td>
                  <td className="mono">{v.codigo ?? <span style={{ color: "var(--texto-2)" }}>na geração</span>}</td>
                  <td>
                    {v.inserido_manual ? <span className="chip V">V</span> : (
                      <select value={v.tipo} onChange={(e) => setVertice(v.ordem, { tipo: e.target.value as Vertice["tipo"] })}>
                        <option>M</option><option>P</option><option>V</option>
                      </select>
                    )}
                  </td>
                  <td>
                    <select value={v.metodo} onChange={(e) => setVertice(v.ordem, { metodo: e.target.value })}>
                      {METODOS_POSICIONAMENTO.map((m) => <option key={m}>{m}</option>)}
                    </select>
                  </td>
                  <td className="mono">{v.lat_gms}</td>
                  <td className="mono">{v.lon_gms}</td>
                  <td className="mono">{String(v.h).replace(".", ",")}</td>
                  <td>{v.inserido_manual && <button className="remover" title="Remover vértice inserido" onClick={() => removerV(v.ordem)}>✕</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ---------------- Glebas: só no serviço com gleba ----------------
          Fica ANTES da geração de propósito: as divisões têm de estar montadas
          quando a planta for desenhada, que é o pedido do fluxo de gleba. */}
      {temGlebas && (
        <section className="bloco" id="bloco-glebas">
          <header>
            <span className="num-bloco">🧩</span>
            <h3>Glebas</h3>
            <span className="desc">
              {glebas.length} gleba(s) — desenhadas dentro do perímetro, na mesma planta
            </span>
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
            <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <BotaoPerigo
                titulo="Separar cada gleba em um serviço próprio"
                confirmacao={`criar ${glebas.filter((g) => g.anel.length >= 3).length} serviço(s)`}
                onConfirmar={separarGlebas}
              >⧉ Separar glebas em serviços</BotaoPerigo>
              <span className="sub" style={{ flex: 1, minWidth: 260 }}>
                Cria um serviço por gleba, com os vértices e os códigos que ela já tem.
                Este serviço continua como está — separar não move nada.
              </span>
            </div>
          )}
        </section>
      )}

      {/* ---------------- Imagem de satélite: entra na planta desta etapa e na pós-SIGEF ---------------- */}
      <section className="bloco" id="bloco-satelite">
        <header>
          <span className="num-bloco">🛰</span>
          <h3>Imagem de satélite</h3>
          <span className="desc">entra no quadro PLANTA DE SITUAÇÃO · a mesma imagem serve às duas plantas</span>
        </header>
        <label className="dropzone" style={{ padding: "14px 18px" }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) carregarSatelite(f); }}>
          {satelite
            ? <><b>🛰 {satelite.nome}</b><span>clique para trocar a imagem</span></>
            : salvo.satelite
              ? <><b>🛰 imagem guardada da geração anterior</b><span>não precisa reenviar — clique só se quiser trocar</span></>
              : <><b>🛰 Enviar imagem de satélite (PNG/JPG)</b><span>necessária para gerar a planta junto do memorial e da planilha</span></>}
          <input type="file" accept="image/png,image/jpeg" hidden
            onChange={(e) => { const f = e.target.files?.[0]; if (f) carregarSatelite(f); e.target.value = ""; }} />
        </label>
      </section>

      {gerado && (
        <section className="bloco gerados" id="bloco-gerados">
          <header>
            <span className="num-bloco">✓</span>
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
          <p style={{ color: "var(--texto-2)" }}>
            Vértice inicial {gerado.resumo.verticeInicial} · M/P/V: {gerado.resumo.qtdM}/{gerado.resumo.qtdP}/{gerado.resumo.qtdV}
          </p>
        </section>
      )}

      {/* ---------------- Conferência de área: entregas opcionais ----------------
          A conferência para aqui. No lugar do SIGEF e das peças, o que ela
          oferece é o Memorial Tabular e a escolha da folha da planta. */}
      {ehConferencia && (
        <section className="bloco" id="bloco-conferencia">
          <header>
            <span className="num-bloco">📐</span>
            <h3>Entregas da conferência</h3>
            <span className="desc">prévia de área — não vai ao SIGEF e não consome numeração oficial</span>
          </header>

          <div className="grade">
            <label>Folha da planta
              <select value={servico.folha_conferencia ?? "A4"}
                onChange={(e) => campo("folha_conferencia", e.target.value as Servico["folha_conferencia"])}>
                <option value="A4">A4 (297×210 mm)</option>
                <option value="A3">A3 (420×297 mm)</option>
              </select>
              <small className="sub">vale na próxima geração dos documentos</small>
            </label>
          </div>

          <div style={{ marginTop: 12 }}>
            <button onClick={gerarTabular} disabled={!docsProntos || gerandoTabular}>
              {gerandoTabular ? <><span className="spinner" /> Gerando…</> : "📄 Gerar Memorial Tabular"}
            </button>
            <p className="sub" style={{ marginTop: 6 }}>
              {docsProntos
                ? "Sai do cálculo do sistema, com os mesmos azimutes e distâncias do Memorial Descritivo. Não são os valores SGL que o SIGEF devolve após certificar — por isso vale como prévia."
                : "Gere primeiro o memorial e a planta no botão do rodapé."}
            </p>
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

      {/* ---------------- Etapa 4: documento do SIGEF (só após gerar os documentos) ----------------
          Não montado na conferência: os handlers de SIGEF não podem ficar
          acessíveis numa modalidade que não passa por ele. */}
      {ehConferencia ? null : !docsProntos ? (
        <section className="bloco" style={{ opacity: 0.6 }}>
          <header>
            <span className="num-bloco">4</span>
            <h3>PDF do SIGEF, planta oficial e peças</h3>
            <span className="desc">liberados após a geração do memorial, da planilha e da planta</span>
          </header>
          <p style={{ color: "var(--texto-2)", margin: 0 }}>
            Gere o Memorial (DOCX), a Planilha (ODS) e a Planta (PDF) no botão "⚡ Gerar documentos" no rodapé ·
            certifique no SIGEF · envie o PDF aqui · gere a Planta do SIGEF e as peças técnicas.
          </p>
        </section>
      ) : (
        <section className="bloco" id="bloco-sigef">
          <header>
            <span className="num-bloco">4</span>
            <h3>Documento do SIGEF</h3>
            <span className="desc">após certificar a planilha, envie o PDF de prévia/certificação — ele libera a planta e as peças</span>
          </header>
          {sigefB64 || salvo.sigef ? (
            <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
              <span className="ok" style={{ margin: 0 }}>
                📄 {sigefB64 ? `${sigefNome} carregado` : "PDF guardado da geração anterior"}
              </span>
              <label style={{ cursor: "pointer", color: "var(--primaria)" }}>
                trocar PDF
                <input type="file" accept=".pdf" hidden
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) carregarSigef(f); e.target.value = ""; }} />
              </label>
            </div>
          ) : (
            <label className="dropzone dropzone-pdf" style={{ padding: "26px 20px" }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) carregarSigef(f); }}>
              <b>📄 Arraste ou clique para enviar o PDF de prévia do SIGEF</b>
              <span>com ele o sistema gera a Planta e as 7 peças técnicas</span>
              <input type="file" accept=".pdf" hidden
                onChange={(e) => { const f = e.target.files?.[0]; if (f) carregarSigef(f); e.target.value = ""; }} />
            </label>
          )}

          {/* ------- SIGEF acusou sobreposição? ------- */}
          <Secao titulo="⚠️ O SIGEF acusou sobreposição?"
            dica="recorta as invasões e regera a planilha"
            abrirEm={sobreCsvs.length > 0 || relatorioSobre !== null}>
            <p style={{ color: "var(--texto-2)", marginTop: 0 }}>
              Quando há sobreposição, o SIGEF não gera o PDF e libera o CSV de cada parcela certificada
              que conflita. Envie <b>todos</b> esses CSVs aqui: o sistema recorta as invasões com o
              afastamento escolhido (vértices medidos fora do conflito não são alterados), substitui os
              vértices atingidos por vértices calculados (tipo V · método PA1) e regera a planilha ODS
              para reenvio ao SIGEF.
            </p>
            <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
              <label className="dropzone" style={{ padding: "14px 18px", flex: "1 1 280px" }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files?.length) carregarCsvsSobreposicao(e.dataTransfer.files); }}>
                <b>📑 Enviar CSVs das parcelas sobrepostas</b>
                <span>exportacao (n).csv — pode selecionar vários de uma vez</span>
                <input type="file" accept=".csv" multiple hidden
                  onChange={(e) => { if (e.target.files?.length) carregarCsvsSobreposicao(e.target.files); e.target.value = ""; }} />
              </label>
              <label>Afastamento (m)
                <input style={{ width: 80 }} value={afastamento} onChange={(e) => setAfastamento(e.target.value)} />
                <small className="sub">recuo aplicado à divisa</small>
              </label>
              <button className="principal" disabled={corrigindo || sobreCsvs.length === 0} onClick={corrigirSobreposicao}>
                {corrigindo ? "Corrigindo e regerando…" : "🛠 Corrigir sobreposição e regerar planilha"}
              </button>
            </div>
            {sobreCsvs.length > 0 && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                {sobreCsvs.map((c) => (
                  <span key={c.nome} className="chip" style={{ display: "inline-flex", gap: 6, alignItems: "center", background: "#eef", borderRadius: 12, padding: "2px 10px" }}>
                    📄 {c.nome}
                    <button className="remover" title="Remover CSV"
                      onClick={() => setSobreCsvs((prev) => prev.filter((x) => x.nome !== c.nome))}>✕</button>
                  </span>
                ))}
              </div>
            )}
            {relatorioSobre && (
              <div style={{ marginTop: 14 }}>
                <table className="tabela-vertices" style={{ maxWidth: 720 }}>
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
                {relatorioSobre.removidos.length > 0 && (
                  <p style={{ color: "var(--texto-2)", margin: "8px 0 0" }}>
                    Área {relatorioSobre.areaAntesHa.toLocaleString("pt-BR", { minimumFractionDigits: 4 })} ha →{" "}
                    {relatorioSobre.areaDepoisHa.toLocaleString("pt-BR", { minimumFractionDigits: 4 })} ha ·{" "}
                    {relatorioSobre.mantidos} vértices mantidos · {relatorioSobre.novos.length} novos (
                    {relatorioSobre.novos[0]}…{relatorioSobre.novos[relatorioSobre.novos.length - 1]}) ·{" "}
                    {relatorioSobre.removidos.length} removidos: <span className="mono">{relatorioSobre.removidos.join(", ")}</span>
                  </p>
                )}
                {relatorioSobre.avisos.map((a, i) => (
                  <div key={i} className="erro" style={{ marginTop: 8, background: "#fff4e5", color: "#8a5300" }}>⚠️ {a}</div>
                ))}
              </div>
            )}
          </Secao>
        </section>
      )}

      {/* ---------------- Etapa 5A: planta (A1 matrícula / A3 posse) ----------------
          `!ehConferencia` é redundante com `sigefB64` (a conferência não tem
          onde carregar o PDF), mas explícito: a condição de existir é a
          modalidade, não o efeito colateral de um estado vazio. */}
      {!ehConferencia && docsProntos && temSigef && (
        <section className="bloco" id="bloco-planta">
          <header>
            <span className="num-bloco">5</span>
            <h3>Planta {servico.tipo_imovel === "posse" ? "A3 (posse)" : "A1 (matrícula)"} do SIGEF</h3>
            <span className="desc">mesmo padrão da planta gerada com o memorial, mas desenhada a partir do PDF certificado do SIGEF · escala automática · carimbo e desenhista vêm das Configurações</span>
          </header>
          <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
            <label className="dropzone" style={{ padding: "14px 18px", flex: "1 1 280px" }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) carregarSatelite(f); }}>
              {satelite
                ? <b>🛰 {satelite.nome}</b>
                : <><b>🛰 Enviar imagem de satélite (PNG/JPG)</b><span>obrigatória — entra no quadro PLANTA DE SITUAÇÃO</span></>}
              <input type="file" accept="image/png,image/jpeg" hidden
                onChange={(e) => { const f = e.target.files?.[0]; if (f) carregarSatelite(f); e.target.value = ""; }} />
            </label>
            <button className="principal" disabled={gerandoPlanta || !satelite} onClick={gerarPlanta}
              title={!satelite ? "Envie a imagem de satélite primeiro" : undefined}>
              {gerandoPlanta ? "Gerando planta…" : `🗺 Gerar Planta ${servico.tipo_imovel === "posse" ? "A3" : "A1"} do SIGEF (PDF)`}
            </button>
            {plantaUrl && (
              <a className="botao-download" href={plantaUrl} target="_blank" rel="noreferrer">
                <span className="ext">PDF</span> Planta {servico.tipo_imovel === "posse" ? "A3" : "A1"} (SIGEF)
              </a>
            )}
          </div>
        </section>
      )}

      {/* ---------------- Etapa 5B: peças técnicas ---------------- */}
      {!ehConferencia && docsProntos && temSigef && (
      <section className="bloco" id="bloco-pecas">
        <header>
          <span className="num-bloco">6</span>
          <h3>Peças técnicas</h3>
          <span className="desc">os dados abaixo + o memorial + o PDF do SIGEF viram as 7 peças (memorial, tabular, cartas, declarações, requerimento)</span>
        </header>

        {/* Só o que muda peça a peça fica à vista; a papelada do RT vem do
            cadastro e só aparece quando estiver incompleta. */}
        <div className="grade" style={{ marginBottom: 12 }}>
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
            <input placeholder="ex.: 86" value={servico.area_matricula_ha ?? ""} onChange={(e) => campo("area_matricula_ha", e.target.value || null)} />
          </label>
          <label>Faixas de domínio (detectadas na planta)
            <input readOnly value={viasDetectadas.length ? viasDetectadas.join(" · ") : "nenhuma"} />
            <small className="sub">{viasDetectadas.length
              ? `sai ${viasDetectadas.length} ${viasDetectadas.length > 1 ? "declarações" : "declaração"} de faixa de domínio, uma por via`
              : "sem estrada, corredor, linha férrea ou rodovia na confrontação — a declaração não é gerada"}</small>
          </label>
        </div>

        <Secao titulo="Segundo requerente"
          selo={<span className={`secao-selo ${servico.requerente2_nome ? "completa" : ""}`}>{servico.requerente2_nome || "nenhum"}</span>}
          abrirEm={!!servico.requerente2_nome}
          dica="cônjuge ou co-proprietário que assina junto">
          <div className="grade">
            <label>Requerente 2 (opcional)
              <input value={servico.requerente2_nome ?? ""} onChange={(e) => campo("requerente2_nome", e.target.value || null)} />
            </label>
            <label>CPF do requerente 2
              <input value={servico.requerente2_cpf ?? ""} onChange={(e) => campo("requerente2_cpf", e.target.value || null)} />
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
          dica={rtSel ? `salvo no cadastro de ${rtSel.nome}` : "selecione um RT no bloco 1"}>
          <div className="grade">
            <label>Formação do RT
              <input placeholder="Técnico em Agropecuária" value={rtExtras.formacao} onChange={(e) => setRtExtras({ ...rtExtras, formacao: e.target.value })} />
            </label>
            <label>Conselho (sigla)
              <input placeholder="CFTA / CREA" value={rtExtras.conselho_sigla} onChange={(e) => setRtExtras({ ...rtExtras, conselho_sigla: e.target.value })} />
            </label>
            <label>Conselho (número)
              <input placeholder="0578839458-9" value={rtExtras.conselho_numero} onChange={(e) => setRtExtras({ ...rtExtras, conselho_numero: e.target.value })} />
            </label>
            <label>Identidade do RT
              <input placeholder="00.000.000-00 SSP/BA" value={rtExtras.identidade} onChange={(e) => setRtExtras({ ...rtExtras, identidade: e.target.value })} />
            </label>
            <label>CPF do RT
              <input value={rtExtras.cpf} onChange={(e) => setRtExtras({ ...rtExtras, cpf: e.target.value })} />
            </label>
          </div>
        </Secao>

        <button className="principal" style={{ marginTop: 14 }} disabled={gerandoPecas} onClick={gerarPecas}>
          {gerandoPecas ? "Gerando as 7 peças técnicas…" : "⚡ Gerar peças técnicas"}
        </button>
        {erroPecas && <div className="erro">{erroPecas}</div>}
        {pecas && (
          <div className="gerados" style={{ border: "none", background: "transparent", padding: "12px 0 0" }}>
            <p style={{ color: "var(--texto-2)", margin: "4px 0 8px" }}>
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

      {/* ---------------- Histórico de documentos ---------------- */}
      <section className="bloco">
        <header><h3>📁 Histórico de documentos deste serviço</h3>
          <span className="desc">cada geração vira uma versão preservada — baixe qualquer uma a qualquer momento</span></header>
        <HistoricoDocs servicoId={servico.id} />
      </section>

      {/* ---------------- Preview (rodapé fixo) ---------------- */}
      <footer className="preview">
        <div className="stats">
          <span className="stat"><span className="rotulo">Fuso</span><span className="valor">{servico.fuso_utm}S · MC-{Math.abs(6 * (servico.fuso_utm ?? 24) - 183)}°W</span></span>
          <span className="stat"><span className="rotulo">Área</span><span className="valor">{preview.areaHa} ha</span></span>
          <span className="stat"><span className="rotulo">Perímetro</span><span className="valor">{preview.perimetroM} m</span></span>
          <span className="stat"><span className="rotulo">M / P / V</span><span className="valor">{preview.qtdM} / {preview.qtdP} / {preview.qtdV}</span></span>
          <span className="acoes">
            <button disabled={ocupado} onClick={apenasSalvar}>Salvar rascunho</button>
            <button disabled={ocupado} className="principal" onClick={gerar}
              title={pendencias.length
                ? `Pendências: ${pendencias.map((p) => p.msg).join("; ")}`
                : satelite ? "Gerar Memorial DOCX + Planilha ODS + Planta PDF" : "Envie a imagem de satélite para gerar a planta junto"}>
              {ocupado ? "Gerando…" : "⚡ Gerar documentos"}
            </button>
          </span>
        </div>
        {pendencias.length > 0 && (
          <div className="pendencias-lista">
            Antes de gerar:{" "}
            {pendencias.map((p, i) => (
              <button key={i} className="link-pendencia" onClick={() => irPara(p.alvo, true)}>{p.msg}</button>
            ))}
          </div>
        )}
        {preview.erro
          ? <div className="erro">{preview.erro}</div>
          : <div className="paragrafo">{preview.primeiroParagrafo}</div>}
        {erro && <div className="erro">{erro}</div>}
      </footer>
    </div>
  );
}
