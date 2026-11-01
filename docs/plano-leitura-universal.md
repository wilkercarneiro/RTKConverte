# Plano — leitura universal do arquivo de pontos (com IA)

> **Estado (2026-11-01): IMPLEMENTADO** — ver [leitura-universal.md](leitura-universal.md). Mudanças em relação a este plano: a IA é a **OpenAI** (`gpt-6-luna` → `gpt-6.1-sol`), não a Anthropic; a IA roda dentro de `ler-arquivo` (não numa função separada); a IA nunca extrai números, nem do texto livre (que tem extrator determinístico); o "V" continua M e o rótulo de uma palavra fica como hoje (decisões do Wilker).

Versão 2, de 2026-11-01. Substitui a versão 1 do mesmo dia.
Escopo: toda a entrada de pontos do serviço. Hoje ela é feita por `parse-txt` → `parseTxt`, em `supabase/functions/_shared/geo.ts`.

> **Promessa.** Qualquer arquivo de pontos em texto, de qualquer aparelho existente ou futuro, termina em uma de duas situações. (a) Ele é lido certo e validado. (b) O operador confirma a leitura em poucos cliques. Em nenhum caso um número errado entra no serviço sem aviso. Um aparelho novo é ensinado ao sistema uma única vez, e a partir daí todos os escritórios passam a lê-lo sozinhos.

---

## 1. Ponto de partida (diagnóstico de 2026-11-01)

- **O leitor de hoje aceita um único layout**: `ID[rótulo];E;N;h;σpos;σh`, com `;` e decimal vírgula, ou `,` e decimal ponto. Qualquer outra organização é recusada.
- **Há erros que passam calados.** Análise dos 81 TXT reais da VPS, do banco e do log das funções:
  - **Ordem do perímetro.** Em 5 arquivos, ordenar os pontos pelo ID cruzou o polígono. Em 4 desses, o operador reordenou à mão. Em outros 4 arquivos é o inverso: a ordem do arquivo é que cruza.
  - **Vértice virtual.** Pontos "V"/"virtual" (σ = 0) foram gravados como M: são 78 no banco.
  - **Polígono cruzado aceito.** 5 arquivos se cruzam mesmo na ordem, por causa de pontos internos, e entraram sem aviso.
  - **Linha mal lida.** Uma linha com E/N duplicados gravou um rótulo lixo.
  - **Recusa real.** Um arquivo com pontos `postp_RTCM-Ref 1` e `postp_1` foi recusado. Os arquivos recusados não ficam guardados.
- **O mercado.** Cada fabricante exporta do seu jeito:
  - Trimble: `Nome,Código,N,E,Z`.
  - Carlson e Stonex: PNEZD.
  - Emlid: CSV com cabeçalho, RMS e às vezes só lat/lon.
  - Topcon: `Name,N,E,Z,Code`.
  - Leica: GSI, em largura fixa.
  - RTKLIB: `.pos`.
  - IBGE-PPP: chave → valor, com σ a 95%.
  - CHC, South e Hi-Target: sem manual público; o layout é configurável pelo usuário.
  - O formato que recebemos hoje é um layout personalizado, não um padrão de mercado.

**Consequência para o desenho.** Não dá para prever todos os formatos, então o sistema não pode depender de conhecer o formato. Ele precisa saber **descrever** qualquer formato (seção 3), **entender** um formato novo (seção 4), **provar** que leu certo (seção 5) e **lembrar** o que aprendeu (seção 6).

---

## 2. Visão geral: a esteira de leitura

```
 arquivo
   │
   ▼
 [0] Abertura ─ bytes → texto (codificação, BOM, quebras de linha);
   │            xlsx/ods/kml/gpx/xml/pdf-texto → linhas; binário → guia de exportação
   ▼
 [1] Perfil conhecido? ─ impressão digital da estrutura bate com um perfil salvo
   │ não                  └─ sim → aplica a receita salva ───────────────┐
   ▼                                                                     │
 [2] Detector por regras ─ separador, decimal, colunas pelos valores     │
   │ confiança baixa      └─ alta → receita proposta ───────────────────┤
   ▼                                                                     │
 [3] IA intérprete ─ lê cabeçalho + amostra e devolve só uma RECEITA     │
   │   (modelo leve; se a validação reprovar, tenta de novo com o erro   │
   │    e depois um modelo maior: até 3 tentativas)                      │
   ▼                                                                     │
 [4] Executor determinístico ─ aplica a receita ao arquivo INTEIRO ◀─────┘
   │   (os números saem do texto original, nunca da IA)
   ▼
 [5] Validador ─ procedência dos números, cobertura de 100% das linhas,
   │   faixas SIGEF, geometria, coerência UTM × lat/lon, σ, duplicados
   │   reprovou → volta ao [3] com o motivo; esgotou → [7]
   ▼
 [6] Prévia "Como lemos o seu arquivo" ─ mapa, tabela, avisos, tipos
   │   operador confirma (1 clique se tudo verde) → perfil salvo
   ▼
 parse-txt cria o serviço com arquivo + receita confirmada

 [7] Mapeamento assistido (rede de segurança): o operador escolhe o papel
     de cada coluna na tela, com a sugestão da IA pré-preenchida
 [8] Texto livre: memorial, e-mail ou relatório; extração com prova de
     procedência
```

O caminho de hoje fica igual: um TXT no formato atual é reconhecido no passo [1] ou [2], não chama a IA, não tem custo e passa com um clique.

---

## 3. A receita: uma linguagem que descreve qualquer arquivo de pontos

O que torna o sistema preparado para o futuro é isto: **um formato novo é um dado (uma receita), não código novo.** Nem a IA, nem o operador, nem nós precisamos programar para ler um aparelho novo. Basta escrever ou gerar a receita dele. A receita é JSON com esquema validado (`_shared/leitor/receita.ts`):

```jsonc
{
  "versao": 1,
  "codificacao": "utf-8 | windows-1252 | utf-16le | utf-16be",
  "linhas": {
    "pular_ate": 3,                       // cabeçalho/metadados no topo
    "ignorar_se": ["^%", "^#", "^Total"], // regex de metadados/rodapé
    "registro": "linha | bloco_chave_valor | palavras_gsi"
  },
  "tokenizacao": {
    "modo": "delimitado | espacos | largura_fixa | regex",
    "delimitador": ";",                   // modo delimitado (com aspas)
    "colunas_fixas": [[0,8],[8,22]],      // modo largura_fixa
    "regex": "^(?<nome>\\d+)(?<rotulo>\\D*);(?<e>[^;]+);…" // modo regex: qualquer linha
  },
  "campos": {
    "nome":   { "col": 0 },
    "rotulo": { "col": 0, "extrair": "apos_numero" },
    "codigo": { "col": 5 },
    "e":      { "col": 1, "decimal": ",", "milhar": "." },
    "n":      { "col": 2, "decimal": "," },
    "lat":    { "col": 7, "formato": "gms_espacos | gd | gms_simbolos | dd.mmssss", "hemisferio": "sinal | sufixo" },
    "lon":    { "col": 8, "formato": "gd" },
    "h":      { "col": 3, "tipo": "elipsoidal | ortometrica" },
    "sigma_pos": { "col": 4, "unidade": "m | cm | mm", "confianca": "1sigma | 95" },
    "sigma_n": { "col": 9 }, "sigma_e": { "col": 10 },   // combinados: √(σN²+σE²)
    "sigma_h":  { "col": 5 }
  },
  "sistema": { "tipo": "utm | geografica", "fuso": 24, "hemisferio": "S", "datum": "SIRGAS2000" },
  "codigos": {                            // semântica dos rótulos/códigos
    "V|virtual|VRGHRT": "virtual",
    "^.+/.+$": "inicio_trecho",
    "base|ref|rtcm|estacao": "apoio_fora",
    "muro|cerca|estrada": "observacao"
  },
  "ordem": "id | arquivo | blocos_centena | manual",
  "origem": "regras | ia:<modelo> | operador | perfil:<id>"
}
```

A receita cobre todos os formatos levantados:

| Formato | Como a receita o descreve |
|---|---|
| O nosso de hoje (ID+rótulo colado, 5 números) | `delimitado` + `rotulo.extrair = apos_numero` |
| Trimble, Carlson, Stonex, Topcon, PNEZD/PENZD | `delimitado` + papéis das colunas |
| Emlid com cabeçalho, RMS e lat/lon | `pular_ate` + papéis pelo cabeçalho + `sigma_n/sigma_e` |
| Emlid Studio só com lat/lon | `sistema.tipo = geografica` |
| RTKLIB `.pos` | `espacos` + `ignorar_se ^%` |
| Leica GSI-8/16 | `registro = palavras_gsi` (leitor de palavras por índice WI) |
| IBGE-PPP `.txt` | `registro = bloco_chave_valor` |
| **Qualquer layout de linha ainda desconhecido** | `tokenizacao.modo = regex` com grupos nomeados |

O modo `regex` com grupos nomeados é o "coringa": qualquer arquivo em que **cada ponto ocupa uma linha** cabe nele, por mais estranho que seja. Os modos `bloco_chave_valor` e `palavras_gsi` cobrem os formatos em que um ponto ocupa várias linhas ou palavras. Se surgir um formato multilinha diferente, ele vira um novo `registro`, uma extensão pequena do executor; os outros perfis não mudam.

---

## 4. A IA intérprete

### O que ela recebe
- As primeiras 40 linhas.
- 20 linhas sorteadas do meio e as 10 últimas.
- Estatísticas por coluna calculadas pelo código: faixa, quantidade de dígitos, se a coluna é numérica, valores repetidos.
- O nome do arquivo.
- A lista de perfis conhecidos mais parecidos.

**Nunca recebe o arquivo inteiro.** Isso deixa a chamada barata e rápida e manda pouco dado do cliente para fora.

### O que ela devolve
- **Somente a receita** (seção 3), via saída estruturada com o esquema JSON.
- Uma explicação curta em português, que aparece na prévia. Exemplo: "Arquivo da Emlid: Norte antes do Este, precisão em RMS separados; o ponto 'Base' é a estação de referência e ficou fora do perímetro".
- A confiança dela em cada decisão.

### O que ela faz bem e as regras fazem mal
- Entender um cabeçalho em qualquer idioma, inclusive chinês, abreviado ou com erro de digitação.
- Entender o significado dos códigos e rótulos:
  - `postp_RTCM-Ref 1` → base;
  - `V` com σ 0 → vértice virtual;
  - `escritura faz. lameiro` → observação;
  - `ramon/faz` → mudança de confrontante.
- Identificar o formato de lat/lon e o hemisfério.
- Reconhecer metadados e rodapés que nenhuma regex previu.

### Cascata de modelos
1. **Claude Haiku 5.5** (`claude-haiku-5-5`): primeira tentativa.
2. Se a validação (seção 5) reprovar, uma **nova tentativa com o motivo da reprovação** no prompt. Exemplo: "a coluna 2 deu N fora do Brasil; 12 linhas não casaram com a regex: …".
3. Se reprovar de novo, **Claude Sonnet 5.5** (`claude-sonnet-5-5`) com todo o histórico.
4. Se ainda reprovar, vai para o mapeamento assistido [7], com a melhor receita parcial pré-preenchida.

Os preços da API são conferidos na implementação. O custo por arquivo é baixo porque vai só a amostra e porque a IA só é chamada para arquivos que o perfil e as regras não resolveram.

### Infraestrutura
- Função nova `interpretar-arquivo` na VPS. A chave `ANTHROPIC_API_KEY` fica no servidor, como as do Asaas e do Mapbox, nunca no navegador.
- Limite de chamadas por escritório e por dia.
- Registro de cada chamada: modelo, tokens, resultado da validação e custo, para um painel no superadmin.
- **Com a API fora do ar**, o sistema segue pelas regras e pelo mapeamento assistido. A leitura nunca depende só da IA.
- **LGPD**: a amostra contém coordenadas de imóveis de clientes. Pelos termos comerciais, a API da Anthropic não usa esses dados para treinar modelos. Isso entra nos termos de uso do Vertces, e existe uma chave por escritório para desligar a IA.

---

## 5. O validador: como provamos que a leitura está certa

O validador é código puro, independente da IA. Toda receita passa por ele, venha das regras, da IA, do operador ou de um perfil salvo. Ele é a garantia de que **nenhum número errado entra calado**.

| # | Verificação | O que pega |
|---|---|---|
| V1 | **Procedência**: cada número gravado é um trecho literal do arquivo original (posição de linha e coluna registrada) | Número inventado, redigitado ou trocado. Por construção, o executor só copia; isso garante que continue assim |
| V2 | **Cobertura de 100% das linhas**: cada linha não vazia é *ponto lido* ou *ignorada com motivo* (cabeçalho, metadado, rodapé, base, duplicada) | Linha perdida em silêncio |
| V3 | **Faixas**: E, N, lat, lon e h dentro dos limites SIGEF/Brasil; σ ≥ 0 e plausível | Coluna trocada, unidade errada (mm lido como m), N lido como E |
| V4 | **Tipos homogêneos por coluna**: a mesma coluna é numérica em todas as linhas de dado | Linha deslocada, separador dentro do rótulo (caso JACO) |
| V5 | **Coerência UTM × geográfica**, quando o arquivo traz as duas: diferença < 0,5 m | Fuso, hemisfério ou datum errados |
| V6 | **Geometria**: anel fechado sem auto-interseção, área > 0, sem lado de comprimento absurdo em relação à mediana | Ordem errada, ponto interno, ponto de outra obra |
| V7 | **Duplicados**: nomes e coordenadas repetidas (< 2 cm) | Ponto medido duas vezes |
| V8 | **Consistência dos códigos**: virtual com σ > 0, M sem "/", base dentro do perímetro | Semântica errada |
| V9 | **Regressão do perfil**: a receita aplicada aos arquivos antigos do mesmo perfil continua dando o mesmo resultado | Perfil "melhorado" que quebra arquivos antigos |

V1, V2 e V3 bloqueiam a criação do serviço. As outras viram aviso na prévia, com a correção sugerida.

### A ordem do perímetro é decidida pela geometria
- O sistema gera candidatos: ordem do ID, ordem do arquivo, blocos por centena e cada um deles sem os pontos de apoio.
- Fica com o candidato que não se cruza. Se ID e arquivo estiverem ambos limpos, fica o ID, como hoje.
- Se nenhum fechar sem cruzar, abre o editor de ligações que já existe (`src/lib/contorno.ts` / `ContornoEditor`) dentro da prévia.
- Com isso, os 5 casos reais teriam saído certos sem retrabalho.

---

## 6. Como o sistema aprende: um aparelho novo é ensinado uma vez

1. **Impressão digital da estrutura.** É calculada sem os valores, só com a forma do arquivo: número de campos, padrão de tipo por coluna (`nome|num6|num7|num|num|num`), cabeçalho normalizado, separador, decimal e codificação. Dois arquivos do mesmo aparelho com a mesma configuração têm a mesma impressão digital, mesmo com pontos diferentes.
2. **Perfil.** Leitura confirmada na prévia = (impressão digital → receita) gravada em `perfis_leitura`. Fica com nome ("CHC LandStar — config. D'Prol"), contagem de uso e taxa de confirmação sem edição.
3. **Perfis compartilhados.** A receita guarda só a estrutura, nenhuma coordenada. Por isso um perfil confirmado por um escritório pode ser **promovido a perfil global** pelo superadmin. O primeiro cliente que sobe um aparelho novo ensina o sistema para todos os escritórios.
4. **Correção vira aprendizado.** Quando o operador altera algo na prévia (a coluna, o tipo de um código, a ordem), a receita é atualizada. Na próxima vez o mesmo arquivo passa sem ajuste.
5. **Corpus vivo.** Todo arquivo recebido fica no storage: os lidos já ficam, e os recusados passam a ficar no bucket `uploads-recusados`. Toda noite, um job reaplica todos os perfis ao corpus e alerta se algum resultado mudou (V9).
6. **Painel "Formatos vistos"** no superadmin, com:
   - perfis;
   - quantos arquivos cada um leu;
   - quanto a IA precisou entrar e quanto custou;
   - arquivos que foram para o mapeamento manual (os próximos a virar perfil).

---

## 7. O que está fora do texto

| Entrada | Tratamento |
|---|---|
| `.xlsx`, `.ods`, `.csv` | Viram linhas e seguem a esteira normal |
| `.kml`, `.kmz`, `.gpx` | Leitores que já existem no CAR (`src/lib/car/gpx.ts` e KML), com a prévia e a validação iguais às dos outros arquivos |
| `.xml`/`.json` (Trimble JobXML, LandXML, GeoJSON) | Leitor estrutural genérico; a receita aponta o caminho dos campos |
| `.dxf` | Pontos e polilinha (fase 5) |
| PDF com texto (relatório PPP, memorial) | Texto extraído → modo texto livre [8] |
| PDF escaneado ou foto | Fora da garantia automática. Se for ativado no futuro: duas leituras independentes precisam concordar e o operador confirma cada ponto |
| Binário proprietário (Leica DBX, Trimble .job, Sokkia, RINEX) | **Nenhum software lê com segurança sem o SDK do fabricante.** O sistema reconhece o tipo pela assinatura dos bytes e mostra o **guia de exportação daquele aparelho** ("No LandStar: Projeto → Exportar → CSV…"). O guia cresce junto com os perfis |

### Modo texto livre [8]
- A IA extrai os pontos de texto corrido.
- Cada número devolvido precisa **aparecer literalmente no texto** (V1). O que não bater é descartado.
- A prévia mostra o trecho de origem de cada ponto, para o operador conferir.

---

## 8. A tela: etapa "Leitura do arquivo"

Fica entre o envio do arquivo e a criação do serviço, em `src/components/Upload.tsx`.

- **Faixa de resumo**, por exemplo: "✓ Lido como *CHC LandStar — config. D'Prol* · 68 pontos · fuso 24S · nenhum aviso". Quando tudo está verde, é um clique: **Continuar**.
- **Mapa** com o anel numerado. Os pontos fora do perímetro (base, repetidos) aparecem em outra cor e os cruzamentos em vermelho. Há o botão "Ajustar pontos" (ContornoEditor).
- **Tabela** com as linhas do arquivo como vieram, coloridas pelo papel de cada coluna. O cabeçalho de cada coluna é um seletor; trocar o seletor relê o arquivo na hora. As linhas ignoradas aparecem riscadas com o motivo.
- **"Como entendemos"**: a explicação da IA ou das regras em 2 ou 3 linhas, com a origem da leitura (perfil, regras ou IA).
- **Tipos por código**: V / M / P / fora, com a regra aplicada, editável.
- **Avisos** agrupados, cada um com a linha de origem e o "?" (Dica), seguindo o padrão de design.
- O `accept` passa a ser `.txt,.csv,.dat,.xyz,.pts,.gsi,.pos,.sum,.xml,.json,.kml,.kmz,.gpx,.xlsx,.ods,.pdf`. Arquivos com outra extensão também são aceitos e passam pela abertura [0].

---

## 9. Banco e servidor

### Migração 0035
- `vertices.nome_txt text`, `vertices.codigo_txt text` e `vertices.origem_linha int` (procedência).
- `perfis_leitura`: id, escritório (nulo = global), impressão digital, receita, nome, usos, confirmações sem edição, criado_por.
- `leituras_arquivo`: serviço, perfil, receita final, origem (regras/IA/operador), avisos, linhas ignoradas com motivo, chamadas de IA. Serve de auditoria e de laudo.
- `chamadas_ia`: escritório, modelo, tokens, custo estimado, validação aprovada ou não.
- Bucket `uploads-recusados`, privado ao escritório e ao superadmin.

### Funções
- **`ler-arquivo`**: passos [0]–[5]. Devolve a prévia (receita, pontos, avisos). **Não cria serviço nem gasta crédito.**
- **`interpretar-arquivo`**: a chamada à IA, isolada, com limite e registro.
- **`parse-txt`**: passa a receber `arquivo_base64 + receita confirmada + ordem/exclusões/tipos`. Ele **reexecuta** a receita e o validador no servidor; a fonte da verdade é o arquivo, não a tela. Sem receita, usa o automático, o que mantém compatível o que já existe.

### Código
- O executor e o validador ficam em `supabase/functions/_shared/leitor/` e são puros: o mesmo código roda no navegador (prévia instantânea ao trocar uma coluna) e no servidor.
- `parseTxt` atual vira um adaptador: `receitaPadrao()` + executor.

---

## 10. Como garantimos o "aparelho do futuro": teste de estresse

Além do corpus real, há um **gerador de arquivos sintéticos** (`tests/leitor/gerador.mjs`). Ele pega os 81 levantamentos reais e os reescreve de milhares de formas:
- **colunas**: em todas as ordens (PNEZD, PENZD, nome no fim, código no meio), com extras (data, PDOP, satélites, antena) e com E/N duplicados;
- **separadores e decimal**: `, ; tab | : espaços`, largura fixa, aspas, decimal vírgula ou ponto, milhar;
- **cabeçalho**: ausente ou presente, em PT/EN/ES/ZH, abreviado e com erro de digitação;
- **início e fim do arquivo**: linhas de metadados no topo, rodapé, linha em branco no meio;
- **codificação**: UTF-8, UTF-8 BOM, Windows-1252, UTF-16 LE/BE; CRLF/LF/CR;
- **coordenadas e unidades**: só lat/lon em 5 notações (com sinal ou com S/W), σ em m/cm/mm, σ 95%, σN/σE separados;
- **pontos especiais**: base no meio, pontos repetidos, nomes alfanuméricos, rótulos com o separador dentro.

Critérios:
- **Detector por regras**: mede a taxa de acerto em cada família.
- **IA**: uma amostra fixa e estratificada (~300 variações) roda contra a API num teste de integração, fora do CI diário.
- **Critério de liberação**: em 100% das variações o resultado é (a) os mesmos pontos do original ou (b) mapeamento assistido. **Zero leituras erradas aceitas.** A taxa de "lido sem intervenção" é medida e precisa subir a cada versão.
- **Toda recusa real** que chegar ao bucket vira caso de teste e, depois de confirmada, perfil.

É isso que sustenta a promessa do topo: nenhum caso de formato novo chega a um número errado. Na pior hipótese, o operador confirma o mapeamento uma vez.

---

## 11. Fases

| Fase | Entrega | Aceite |
|---|---|---|
| **1. Fundação (invisível)** | Esquema da receita, executor, validador V1–V9, `receitaPadrao()` = leitor de hoje, corpus de ouro (81 reais) | Os 81 reais dão resultado idêntico ao de hoje, exceto as correções intencionais documentadas |
| **2. Regras + semântica + ordem** | Abertura [0], detector por regras, impressão digital, códigos (V/M/base), ordem pela geometria, nome alfanumérico, migração 0035 | Os 5 casos de ordem saem certos; os V viram V; `postp_*` lido; JACO limpo; gerador sintético: 0 leituras erradas aceitas |
| **3. IA intérprete** | `interpretar-arquivo` com cascata Haiku → nova tentativa → Sonnet, saída estruturada, registro de custo, limite por escritório | Amostra sintética com IA: 0 erros aceitos; taxa de "sem intervenção" medida |
| **4. Etapa "Leitura do arquivo"** | Prévia com mapa, tabela com seletores, avisos, tipos, ContornoEditor, perfis por escritório | Screenshot antes×agora; arquivo de formato desconhecido lido em menos de 1 min e o 2º do mesmo aparelho em 1 clique |
| **5. Formatos além do TXT** | GSI, RTKLIB, PPP, xlsx/ods, KML/GPX/KMZ, XML/JSON, DXF, texto livre, guia de exportação para binários | Um exemplo de cada formato vai até a planilha SIGEF |
| **6. Aprendizado e vigilância** | Perfis globais, bucket de recusados, job noturno de regressão, painel "Formatos vistos" e custo da IA | Recusa nova aparece no painel em menos de 1 min |
| **7. Saneamento** | Relatório dos serviços já gravados com V como M, ordem cruzada e rótulo lixo | Lista entregue para decisão; nada é corrigido sem aval |

As fases 1 e 2 já trazem ganho real sem depender da IA. A partir da fase 3, todo arquivo que não for reconhecido passa pela IA antes de chegar ao operador. Cada fase é publicada na VPS com backup e com o seu aval, como de costume.

---

## 12. Padrões adotados (podem ser revistos)

1. Ponto "V"/"virtual" (ou σ = 0 com rótulo de virtual) → **vértice virtual (V)**, que não abre trecho.
2. Ordem: ID por padrão; troca pela ordem do arquivo só quando o ID cruza e o arquivo não; se ambos cruzam, o editor de ligações.
3. Rótulo de uma palavra (`estrada`, `muro`) → **sugestão** de confrontante, não M automático.
4. σ do IBGE-PPP (95%) → **gravado como veio, com aviso**, até o responsável técnico decidir pela conversão para 1σ.
5. Arquivos recusados → **guardados**, privados ao escritório.
6. Perfis → **por escritório**; o superadmin promove a global.
7. IA → **ligada por padrão**, com chave por escritório para desligar e limite diário.
8. Pedir aos clientes **um arquivo exportado de cada aparelho em uso**: eles viram os primeiros perfis globais e testes reais dos fabricantes chineses.
