// Dados de exemplo da central de suporte, dos tutoriais e dos acessos para o
// laboratório do painel (#/lab/admin, só no `npm run dev`). As RPCs do suporte
// mexem nestas listas em memória: responder, mudar status e marcar como lido
// funcionam de verdade na tela, sem banco. Ver LaboratorioAdmin.tsx.

type Linha = Record<string, unknown>;

const agora = () => new Date().toISOString();
const min = (n: number) => new Date(Date.now() - n * 60_000).toISOString();
const hor = (n: number) => min(n * 60);
const dia = (n: number) => min(n * 60 * 24);

// ------------------------------------------------------------------ imagens (SVG → data URL)
const svgUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
const janela = (titulo: string, corpo: string) => svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="960" height="600" viewBox="0 0 960 600" font-family="Segoe UI, Arial, sans-serif">
  <rect width="960" height="600" fill="#F3F5F2"/>
  <rect width="960" height="44" fill="#0E3B2B"/>
  <circle cx="22" cy="22" r="6" fill="#E46B5D"/><circle cx="42" cy="22" r="6" fill="#E9B949"/><circle cx="62" cy="22" r="6" fill="#62C27E"/>
  <text x="92" y="27" fill="#A9CBBA" font-size="14">vertces.com.br/app — ${titulo}</text>
  <rect x="0" y="44" width="190" height="556" fill="#123F2F"/>
  ${["Início", "Serviços", "Clientes", "Equipe", "Créditos"].map((t, i) => `<text x="24" y="${92 + i * 38}" fill="${i === 1 ? "#FFFFFF" : "#7FA894"}" font-size="15">${t}</text>`).join("")}
  ${corpo}
</svg>`);

const IMG_ERRO = janela("Documentos", `
  <text x="222" y="92" fill="#16241D" font-size="24" font-weight="700">Fazenda Lagoa Grande</text>
  <text x="222" y="118" fill="#5B6B63" font-size="14">Georreferenciamento completo · 48,7215 ha · 32 vértices</text>
  <rect x="222" y="146" width="700" height="96" rx="14" fill="#fff" stroke="#E3E8E5"/>
  <text x="246" y="182" fill="#16241D" font-size="16" font-weight="600">Planta do SIGEF (A1)</text>
  <text x="246" y="208" fill="#8A978F" font-size="13">Gerando… 74%</text>
  <rect x="246" y="220" width="420" height="8" rx="4" fill="#EEF2F0"/><rect x="246" y="220" width="310" height="8" rx="4" fill="#178552"/>
  <rect x="222" y="266" width="700" height="132" rx="14" fill="#FBEAEA" stroke="#E7B4B4"/>
  <circle cx="256" cy="304" r="14" fill="#B93A3A"/><text x="251" y="310" fill="#fff" font-size="17" font-weight="700">!</text>
  <text x="284" y="300" fill="#B93A3A" font-size="17" font-weight="700">Falha ao gerar a planta</text>
  <text x="284" y="326" fill="#7A2B2B" font-size="14">Vértice M-0457 sem coordenada na reconciliação com o SIGEF.</text>
  <text x="284" y="350" fill="#7A2B2B" font-size="14">Confira o vértice na conferência e gere de novo.</text>
  <rect x="284" y="364" width="150" height="24" rx="7" fill="#fff" stroke="#E7B4B4"/><text x="300" y="381" fill="#B93A3A" font-size="12.5" font-weight="600">Ver detalhes técnicos</text>
  <rect x="222" y="422" width="340" height="140" rx="14" fill="#fff" stroke="#E3E8E5"/>
  <text x="246" y="456" fill="#16241D" font-size="15" font-weight="600">Memorial descritivo</text><text x="246" y="480" fill="#178552" font-size="13">Gerado · 12/10</text>
  <rect x="582" y="422" width="340" height="140" rx="14" fill="#fff" stroke="#E3E8E5"/>
  <text x="606" y="456" fill="#16241D" font-size="15" font-weight="600">Planilha ODS</text><text x="606" y="480" fill="#178552" font-size="13">Gerada · 12/10</text>`);

const IMG_PLANTA = janela("Conferência", `
  <text x="222" y="92" fill="#16241D" font-size="24" font-weight="700">Fazenda Boa Vista · confrontação</text>
  <rect x="222" y="112" width="700" height="460" rx="14" fill="#fff" stroke="#E3E8E5"/>
  <polygon points="330,200 610,170 700,330 560,500 340,460 280,320" fill="#E4F3EB" stroke="#178552" stroke-width="3"/>
  <polygon points="610,170 860,150 880,380 700,330" fill="#FFF4D6" stroke="#B7791F" stroke-width="2.5" stroke-dasharray="8 6"/>
  ${[[330, 200], [610, 170], [700, 330], [560, 500], [340, 460], [280, 320]].map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="7" fill="#178552"/><text x="${x + 10}" y="${y - 10}" fill="#126B42" font-size="13" font-weight="600">M-04${50 + i}</text>`).join("")}
  ${[[860, 150], [880, 380]].map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="7" fill="#B93A3A"/><text x="${x - 76}" y="${y + 24}" fill="#B93A3A" font-size="13" font-weight="700">M-08${11 + i} ?</text>`).join("")}
  <text x="742" y="270" fill="#7A5410" font-size="13" font-weight="600">Vizinho certificado</text>
  <text x="742" y="288" fill="#7A5410" font-size="12">CNS 01.234-5</text>`);

const IMG_CREDITOS = janela("Créditos", `
  <text x="222" y="92" fill="#16241D" font-size="24" font-weight="700">Créditos de outubro</text>
  ${[["Georreferenciamento completo", 18, 20, "#178552"], ["CAR", 4, 4, "#B93A3A"], ["Conferência", 6, 10, "#178552"], ["Peças técnicas", 1, 5, "#178552"]].map(([n, u, t, c], i) => `
  <rect x="222" y="${120 + i * 92}" width="700" height="76" rx="14" fill="#fff" stroke="#E3E8E5"/>
  <text x="246" y="${152 + i * 92}" fill="#16241D" font-size="16" font-weight="600">${n}</text>
  <text x="840" y="${152 + i * 92}" fill="${c}" font-size="16" font-weight="700">${u} de ${t}</text>
  <rect x="246" y="${166 + i * 92}" width="652" height="9" rx="4.5" fill="#EEF2F0"/>
  <rect x="246" y="${166 + i * 92}" width="${(652 * (u as number)) / (t as number)}" height="9" rx="4.5" fill="${c}"/>`).join("")}
  <rect x="222" y="500" width="700" height="56" rx="14" fill="#FBF3E3" stroke="#EBD48B"/>
  <text x="246" y="534" fill="#7A5410" font-size="14" font-weight="600">Limite de CAR atingido. Peça créditos extras para continuar.</text>`);

const TEXTO = (t: string) => `data:text/plain;charset=utf-8,${encodeURIComponent(t)}`;

/** Arquivos "no bucket": path → URL assinada (data URL). */
export const ARQUIVOS: Record<string, string> = {
  "e1/ch1/a1b2c3d4-erro-planta.png": IMG_ERRO,
  "e1/ch1/b2c3d4e5-memorial-lagoa-grande.pdf": TEXTO("Memorial descritivo — Fazenda Lagoa Grande (exemplo do laboratório)"),
  "e0/ch2/c3d4e5f6-planta-confrontacao.png": IMG_PLANTA,
  "e4/ch3/d4e5f6a7-creditos-outubro.png": IMG_CREDITOS,
  "e0/ch7/e5f6a7b8-levantamento-gnss.txt": TEXTO("PONTO;E;N;ALT\nM-0001;512345.123;8654321.456;612.34"),
};

// ------------------------------------------------------------------ chamados
interface ChamadoLab extends Linha {
  id: string; numero: number; escritorio_id: string; lido_suporte_em: string | null;
  status: string; prioridade: string; ultima_mensagem_em: string; ultima_mensagem_de: string;
  primeira_resposta_em: string | null; resolvido_em: string | null;
}

const ctx = (tela: string, navegador: string, sistema: string, tamanho: string, ip: string) =>
  ({ tela, url: `https://vertces.com.br/app/#/${tela}`, navegador, sistema, tamanho, ip });

export const CHAMADOS: ChamadoLab[] = [
  {
    id: "ch1", numero: 1042, escritorio_id: "e1", empresa: "AGRIMENSURA SERTÃO LTDA", plano: "Profissional", autor: "Marta Ribeiro",
    autor_email: "marta@agrimensurasertao.com.br", assunto: "Planta do SIGEF não gera: erro no vértice M-0457", categoria: "erro",
    prioridade: "urgente", status: "aberto", criado_em: min(38), ultima_mensagem_em: min(12), ultima_mensagem_de: "cliente",
    primeira_resposta_em: null, resolvido_em: null, avaliacao: null, avaliacao_comentario: null, lido_suporte_em: null,
    contexto: ctx("servico/8f2c41/documentos", "Chrome 130", "Windows", "1366×768", "177.37.142.18"),
  },
  {
    id: "ch2", numero: 1041, escritorio_id: "e0", empresa: "D'PROL GEORREFERENCIAMENTO", plano: "Completo", autor: "Daniel Nascimento",
    autor_email: "daniel@dprol.com.br", assunto: "Como confrontar com área certificada do vizinho?", categoria: "duvida",
    prioridade: "normal", status: "em_atendimento", criado_em: hor(27), ultima_mensagem_em: min(50), ultima_mensagem_de: "cliente",
    primeira_resposta_em: hor(26), resolvido_em: null, avaliacao: null, avaliacao_comentario: null, lido_suporte_em: hor(2),
    contexto: ctx("servico/2b77e0/conferencia", "Edge 129", "Windows", "1920×1080", "189.45.200.7"),
  },
  {
    id: "ch3", numero: 1040, escritorio_id: "e4", empresa: "MEDIÇÕES RECÔNCAVO", plano: "Completo", autor: "José Carlos",
    autor_email: "jose@medicoesreconcavo.com.br", assunto: "Créditos de CAR acabaram antes do fim do mês", categoria: "financeiro",
    prioridade: "alta", status: "aberto", criado_em: hor(3), ultima_mensagem_em: hor(3), ultima_mensagem_de: "cliente",
    primeira_resposta_em: null, resolvido_em: null, avaliacao: null, avaliacao_comentario: null, lido_suporte_em: null,
    contexto: ctx("creditos", "Chrome 130", "macOS", "1440×900", "200.150.33.91"),
  },
  {
    id: "ch4", numero: 1039, escritorio_id: "e2", empresa: "TOPO NORTE ENGENHARIA", plano: "Essencial", autor: "Paulo Sena",
    autor_email: "paulo@toponorte.eng.br", assunto: "Operador de campo não consegue entrar", categoria: "acesso",
    prioridade: "normal", status: "aguardando_cliente", criado_em: hor(6), ultima_mensagem_em: hor(5), ultima_mensagem_de: "suporte",
    primeira_resposta_em: hor(5), resolvido_em: null, avaliacao: null, avaliacao_comentario: null, lido_suporte_em: hor(5),
    contexto: { ...ctx("equipe", "Safari 17", "iOS", "390×844", "179.104.12.230"), dispositivo: "celular" },
  },
  {
    id: "ch5", numero: 1038, escritorio_id: "e5", empresa: "CHAPADA GEO SERVIÇOS", plano: null, autor: "Rita Prado",
    autor_email: "rita@chapadageo.com.br", assunto: "Sugestão: exportar o memorial em Word (.docx)", categoria: "sugestao",
    prioridade: "baixa", status: "aguardando_cliente", criado_em: dia(2), ultima_mensagem_em: hor(44), ultima_mensagem_de: "suporte",
    primeira_resposta_em: hor(44), resolvido_em: null, avaliacao: null, avaliacao_comentario: null, lido_suporte_em: hor(44),
    contexto: ctx("servico/77d1aa/documentos", "Firefox 131", "Linux", "1600×900", "186.212.4.77"),
  },
  {
    id: "ch6", numero: 1036, escritorio_id: "e1", empresa: "AGRIMENSURA SERTÃO LTDA", plano: "Profissional", autor: "Marta Ribeiro",
    autor_email: "marta@agrimensurasertao.com.br", assunto: "Área da matrícula diferente da calculada", categoria: "duvida",
    prioridade: "normal", status: "resolvido", criado_em: dia(4), ultima_mensagem_em: min(4 * 1440 - 25), ultima_mensagem_de: "suporte",
    primeira_resposta_em: min(4 * 1440 - 25), resolvido_em: dia(3), avaliacao: 5,
    avaliacao_comentario: "Resolveu na hora, explicação muito clara. Obrigada!", lido_suporte_em: dia(3),
    contexto: ctx("servico/5c90b3/conferencia", "Chrome 129", "Windows", "1366×768", "177.37.142.18"),
  },
  {
    id: "ch7", numero: 1033, escritorio_id: "e0", empresa: "D'PROL GEORREFERENCIAMENTO", plano: "Completo", autor: "Daniel Nascimento",
    autor_email: "daniel@dprol.com.br", assunto: "Erro ao importar o TXT do GNSS", categoria: "erro",
    prioridade: "alta", status: "resolvido", criado_em: dia(9), ultima_mensagem_em: min(9 * 1440 - 200), ultima_mensagem_de: "cliente",
    primeira_resposta_em: min(9 * 1440 - 70), resolvido_em: dia(8), avaliacao: 4, avaliacao_comentario: null, lido_suporte_em: dia(8),
    contexto: ctx("novo/completo", "Chrome 128", "Windows", "1920×1080", "189.45.200.7"),
  },
];

let seq = 0;
const m = (chamado_id: string, autor_tipo: "cliente" | "suporte" | "sistema", created_at: string, texto: string,
  o: { interna?: boolean; anexos?: { path: string; nome: string; tipo: string; tamanho: number }[] } = {}): Linha => ({
  id: ++seq, chamado_id, autor_id: autor_tipo === "sistema" ? null : `u-${autor_tipo}`, autor_tipo, texto,
  anexos: o.anexos ?? [], interna: o.interna ?? false, created_at,
});

export const MENSAGENS: Linha[] = [
  m("ch1", "cliente", min(38), "Boa tarde! Ao gerar a planta do serviço Fazenda Lagoa Grande aparece \"Falha ao gerar a planta\" e o PDF não sai. Já tentei duas vezes. Segue o print da tela.",
    { anexos: [{ path: "e1/ch1/a1b2c3d4-erro-planta.png", nome: "erro-planta.png", tipo: "image/png", tamanho: 188_416 }] }),
  m("ch1", "cliente", min(12), "Preciso protocolar no cartório ainda hoje. Mando também o memorial que saiu antes do erro.",
    { anexos: [{ path: "e1/ch1/b2c3d4e5-memorial-lagoa-grande.pdf", nome: "memorial-lagoa-grande.pdf", tipo: "application/pdf", tamanho: 253_952 }] }),

  m("ch2", "cliente", hor(27), "O vizinho da Fazenda Boa Vista já é certificado no SIGEF. Como faço para o sistema usar os vértices dele na confrontação, em vez dos meus?"),
  m("ch2", "sistema", min(26 * 60 + 5), "O suporte começou o atendimento."),
  m("ch2", "suporte", hor(26), "Oi, Daniel! Na etapa do TXT o sistema pergunta se o imóvel confronta com área certificada. Responda \"sim\", envie o CSV do vizinho baixado do SIGEF e escolha os vértices dele na planta. Os códigos do vizinho entram como estão."),
  m("ch2", "suporte", min(26 * 60 - 2), "Se ele não achar o CSV: SIGEF › Parcelas › Exportar. Vale gravar um tutorial disso.", { interna: true }),
  m("ch2", "cliente", min(50), "Fiz isso, mas a planta mostrou dois vértices do vizinho como se fossem nossos (M-0811 e M-0812). Mandei o print.",
    { anexos: [{ path: "e0/ch2/c3d4e5f6-planta-confrontacao.png", nome: "planta-confrontacao.png", tipo: "image/png", tamanho: 312_320 }] }),

  m("ch3", "cliente", hor(3), "Os créditos de CAR zeraram e ainda tenho 6 propriedades para cadastrar esta semana. Dá para liberar um pacote extra? Pago por PIX.",
    { anexos: [{ path: "e4/ch3/d4e5f6a7-creditos-outubro.png", nome: "creditos-outubro.png", tipo: "image/png", tamanho: 141_312 }] }),

  m("ch4", "cliente", hor(6), "O Lucas (campo@toponorte.eng.br) diz que a senha não funciona e não aparece a opção de trocar."),
  m("ch4", "sistema", min(5 * 60 + 10), "O suporte começou o atendimento."),
  m("ch4", "suporte", hor(5), "Paulo, redefini a senha do Lucas para a senha padrão. No primeiro acesso o sistema pede para ele criar a própria. Pode pedir para ele tentar de novo e me avisar?"),

  m("ch5", "cliente", dia(2), "Seria ótimo exportar o memorial descritivo em .docx. Alguns cartórios pedem ajustes no texto antes de registrar."),
  m("ch5", "suporte", hor(44), "Ótima ideia, Rita! Anotei para a próxima versão. Por enquanto dá para copiar o texto do memorial direto da tela de documentos. Aviso aqui quando sair."),
  m("ch5", "suporte", min(44 * 60 - 1), "Já são 3 empresas pedindo .docx. Priorizar no roadmap.", { interna: true }),

  m("ch6", "cliente", dia(4), "A área calculada deu 48,7215 ha e a matrícula diz 48,72 ha. Está certo?"),
  m("ch6", "suporte", min(4 * 1440 - 25), "Está certo, Marta. O sistema calcula pela geometria no SGL (o mesmo do SIGEF), com 4 casas decimais; a matrícula arredonda. A diferença está dentro da tolerância."),
  m("ch6", "sistema", min(4 * 1440 - 24), "O suporte marcou o chamado como resolvido."),
  m("ch6", "sistema", dia(3), "Chamado encerrado pela empresa."),

  m("ch7", "cliente", dia(9), "O TXT do receptor não importa: aparece \"coluna de altitude ausente\".",
    { anexos: [{ path: "e0/ch7/e5f6a7b8-levantamento-gnss.txt", nome: "levantamento-gnss.txt", tipo: "text/plain", tamanho: 18_432 }] }),
  m("ch7", "suporte", min(9 * 1440 - 70), "Daniel, o arquivo veio com separador ponto e vírgula e cabeçalho em inglês. Ajustei o leitor para aceitar esse formato; pode reenviar."),
  m("ch7", "cliente", min(9 * 1440 - 200), "Funcionou, obrigado!"),
  m("ch7", "sistema", min(9 * 1440 - 205), "Chamado encerrado pela empresa."),
];

const esperando = (c: ChamadoLab) => (c.status === "aberto" || c.status === "em_atendimento") && c.ultima_mensagem_de === "cliente";
const doChamado = (id: string) => MENSAGENS.filter((x) => x.chamado_id === id).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));

function saChamados() {
  return [...CHAMADOS].sort((a, b) => b.ultima_mensagem_em.localeCompare(a.ultima_mensagem_em)).map(({ lido_suporte_em, ...c }) => {
    const ms = doChamado(c.id);
    const util = ms.filter((x) => x.autor_tipo !== "sistema");
    return {
      ...c,
      nao_lidas: ms.filter((x) => x.autor_tipo === "cliente" && (!lido_suporte_em || String(x.created_at) > lido_suporte_em)).length,
      mensagens: util.length,
      previa: util.length ? String(util[util.length - 1].texto).slice(0, 160) : null,
    };
  });
}

const STATUS_TXT: Record<string, string> = {
  em_atendimento: "O suporte começou o atendimento.", aguardando_cliente: "O suporte aguarda a resposta da empresa.",
  resolvido: "O suporte marcou o chamado como resolvido.", aberto: "Chamado reaberto.",
};

export const RPC_SUPORTE: Record<string, (a: Record<string, unknown>) => unknown> = {
  sa_chamados: saChamados,
  sa_contagem_suporte: () => ({
    esperando: CHAMADOS.filter(esperando).length,
    abertos: CHAMADOS.filter((c) => c.status !== "resolvido").length,
    nao_lidas: saChamados().reduce((s, c) => s + c.nao_lidas, 0),
  }),
  marcar_chamado_lido: (a) => {
    const c = CHAMADOS.find((x) => x.id === a.p_chamado);
    if (c) c.lido_suporte_em = agora();
    return null;
  },
  sa_responder_chamado: (a) => {
    const c = CHAMADOS.find((x) => x.id === a.p_chamado);
    if (!c) return null;
    const interna = !!a.p_interna;
    MENSAGENS.push(m(c.id, "suporte", agora(), String(a.p_texto ?? ""), { interna, anexos: (a.p_anexos as never[]) ?? [] }));
    c.lido_suporte_em = agora();
    if (interna) return null;
    const status = typeof a.p_status === "string" ? a.p_status : "aguardando_cliente";
    Object.assign(c, {
      status, resolvido_em: status === "resolvido" ? c.resolvido_em ?? agora() : null,
      primeira_resposta_em: c.primeira_resposta_em ?? agora(), ultima_mensagem_em: agora(), ultima_mensagem_de: "suporte",
    });
    return null;
  },
  sa_atualizar_chamado: (a) => {
    const c = CHAMADOS.find((x) => x.id === a.p_chamado);
    if (!c) return null;
    if (typeof a.p_prioridade === "string") c.prioridade = a.p_prioridade;
    if (typeof a.p_status === "string" && a.p_status !== c.status) {
      c.status = a.p_status;
      c.resolvido_em = a.p_status === "resolvido" ? c.resolvido_em ?? agora() : null;
      MENSAGENS.push(m(c.id, "sistema", agora(), STATUS_TXT[a.p_status] ?? "Chamado atualizado."));
    }
    return null;
  },
  sa_acessos: () => ACESSOS,
};

// ------------------------------------------------------------------ tutoriais
export const TUTORIAIS: Linha[] = [
  ["inicio", "Primeiro acesso e visão geral do sistema", "Onde fica cada coisa: serviços, clientes, equipe e créditos.", "https://youtu.be/Vt1rtkA0001", "3:40", 1, true],
  ["inicio", "Cadastrar a empresa, a logo e o responsável técnico", "Dados que saem no carimbo da planta e no memorial.", "https://youtu.be/Vt1rtkA0002", "2:15", 2, true],
  ["servicos", "Do TXT do GNSS à conferência dos vértices", "Enviar o levantamento, revisar códigos e fechar o perímetro.", "https://youtu.be/Vt1rtkA0003", "6:05", 1, true],
  ["servicos", "Confrontar com área certificada do vizinho", "CSV do SIGEF, escolha na planta e códigos do vizinho preservados.", "https://www.loom.com/share/4f1c2e9a7b6d4e0f9a1b2c3d4e5f6a7b", "4:30", 2, false],
  ["documentos", "Gerar a planta do SIGEF e o memorial", "Planta A1/A3, memorial descritivo e planilha ODS em um clique.", "https://vimeo.com/912345678", "5:20", 1, true],
  ["documentos", "Editar a planta: textos, legenda e carimbo", null, null, null, 2, false],
  ["loteamento", "Desenhar quadras e lotes em minutos", "Ruas, quadras, lotes com frente mínima e a maquete 3D.", "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUv/view", "7:45", 1, true],
  ["equipe", "Convidar a equipe e definir permissões", "Quem vê o quê, e o histórico de cada pessoa.", "https://youtu.be/Vt1rtkA0008", "2:50", 1, false],
].map(([modulo, titulo, descricao, video_url, duracao, ordem, publicado], i) => ({
  id: `t${i + 1}`, modulo, titulo, descricao, video_url, duracao, ordem, publicado, created_at: dia(20 - i), atualizado_em: dia(10 - i),
}));

// ------------------------------------------------------------------ acessos (sessões)
const ACESSOS = [
  ["Marta Ribeiro", min(41), min(9), "177.37.142.18", "Chrome 130", "Windows", "computador", 23, "servico/8f2c41/documentos"],
  ["Lucas Campos", hor(3), min(150), "179.104.12.230", "Safari 17", "iOS", "celular", 4, "servicos"],
  ["Marta Ribeiro", min(26 * 60), min(26 * 60 - 95), "177.37.142.18", "Chrome 130", "Windows", "computador", 41, "servico/5c90b3/conferencia"],
  ["Ana Souza", min(28 * 60), min(28 * 60 - 48), "177.37.140.2", "Edge 129", "Windows", "computador", 17, "clientes"],
  ["Marta Ribeiro", dia(2), min(2 * 1440 - 130), "177.37.142.18", "Chrome 130", "Windows", "computador", 56, "servico/77d1aa/planta"],
  ["Lucas Campos", dia(3), min(3 * 1440 - 12), "179.104.12.230", "Safari 17", "iOS", "celular", 3, "inicio"],
  ["Ana Souza", dia(4), min(4 * 1440 - 64), "177.37.140.2", "Edge 129", "Windows", "computador", 22, "servicos"],
].map(([quem, em, ultimo_em, ip, navegador, sistema, dispositivo, telas, ultima_tela], i) => ({
  id: 900 - i, user_id: `u-${String(quem).split(" ")[0].toLowerCase()}`, quem, em, ultimo_em, ip, navegador, sistema, dispositivo, telas, ultima_tela,
}));

// ------------------------------------------------------------------ storage
const enviados = new Map<string, string>();
export const STORAGE_SUPORTE = {
  from: () => ({
    upload: async (path: string, f: File) => {
      enviados.set(path, URL.createObjectURL(f));
      return { data: { path }, error: null };
    },
    createSignedUrl: async (path: string) => ({
      data: { signedUrl: enviados.get(path) ?? ARQUIVOS[path] ?? TEXTO(`Arquivo de exemplo: ${path}`) }, error: null,
    }),
  }),
};
