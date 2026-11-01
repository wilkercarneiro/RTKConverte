# Leitura universal do arquivo de pontos

Estado em 2026-11-01: **implementado e testado; ainda não publicado** (falta o aval para a VPS, o push e a chave da OpenAI).
Plano original: [plano-leitura-universal.md](plano-leitura-universal.md).

## O que mudou para o operador

Antes, o sistema aceitava um único layout (`ID[rótulo];E;N;h;σ;σ`), recusava qualquer outro formato e às vezes lia errado sem avisar. Agora:

1. **Envio do arquivo.** O operador manda o arquivo do levantamento em qualquer formato: TXT/CSV de qualquer aparelho, planilha `.xlsx`/`.ods`, Leica GSI, KML/KMZ, GPX, LandXML, Trimble JobXML, GeoJSON, DXF, RTKLIB `.pos`, relatório IBGE-PPP, memorial em PDF com texto ou texto corrido.
2. **Etapa nova "Leitura do arquivo".** Ela mostra:
   - como o arquivo foi lido (formato da equipe, formato já conhecido, regras, IA ou ajuste do operador);
   - o desenho do perímetro;
   - a tabela do arquivo, com o papel de cada coluna e as linhas que ficaram de fora com o motivo;
   - os avisos.
3. **Ajustes na tela.** O operador pode trocar o papel de uma coluna, o separador, o decimal, a unidade do σ e a ordem dos pontos; pode excluir um ponto clicando nele e declarar o σ quando o arquivo não traz. Cada mudança relê o arquivo na hora.
4. **Confirmações.** Avisos importantes pedem um clique em "conferi": ordem trocada, desenho que cruza, receita da IA, base fora do perímetro, σ a 95% e semelhantes.
5. **Criação do serviço.** O `parse-txt` **reexecuta** a leitura confirmada sobre o arquivo antes de criar o serviço e recusa se faltar alguma confirmação.
6. **Aprendizado.** Formato novo vira **perfil da empresa**. O próximo arquivo do mesmo aparelho entra sozinho, sem IA.

## Arquitetura (`supabase/functions/_shared/leitor/`)

| Módulo | Papel |
|---|---|
| `receita.ts` | A **receita**: JSON que descreve como ler um arquivo (separador, decimal, papel das colunas, unidades, regex, etc.). Valida receitas de origem não confiável e recusa regex com repetição aninhada. Também gera o esquema estrito para a IA. |
| `abertura.ts` | Bytes → texto: BOM, UTF-8 estrito, UTF-16 com ou sem BOM, Windows-1252, CR sozinho. Binário de aparelho vira **orientação de exportação** (Leica DBX, Trimble .job, RINEX, DWG…). |
| `arquivo.ts` | Formatos empacotados: `.xlsx`, `.ods`, KMZ, ZIP com TXT dentro e PDF com texto. PDF escaneado é recusado com orientação. |
| `numeros.ts` | Números (vírgula ou ponto, milhar, científico, `X:` ou `N=` colados) e ângulos (decimal, GMS com símbolos, espaços ou dois-pontos, letras S/N/W/O/E/L). |
| `detector.ts` | **Regras**: testa separadores e decimais, reconhece o cabeçalho (PT/EN/ES/ZH, X/Y chinês) e deduz o papel de cada coluna pelos valores. Devolve a confiança (alta/média/baixa). |
| `formatos.ts` | Extratores de GSI, chave→valor (PPP), XML (KML, GPX, LandXML, JobXML), GeoJSON, DXF e texto livre. |
| `executor.ts` | Aplica a receita. **Copia cada número do arquivo** e guarda o trecho bruto e a linha de cada um. |
| `ordem.ts` | Pontos de apoio (base/RTCM) fora do perímetro, repetidos e **ordem pela geometria**: a que não cruza; com duas válidas, a de menor perímetro; partes por centena só com numeração contínua. |
| `validador.ts` | **V1** procedência (cada número é trecho literal do arquivo e relê igual); **V2** cobertura de 100% das linhas; **V3** faixas SIGEF/Brasil, σ absurdo; **V5** UTM × geográfica; lado longo. |
| `assinatura.ts` | Impressão digital da estrutura, sem os valores: é a chave dos perfis aprendidos. |
| `ia.ts` | IA intérprete (OpenAI, API Responses, saída estruturada estrita). Recebe só uma **amostra** e devolve só a **receita**. Cascata `gpt-6-luna` → nova tentativa com o motivo da reprovação → `gpt-6.1-sol`. |
| `index.ts` | Orquestra: perfil → formato especial → formato padrão → detector → texto livre. `executarReceita` é o mesmo código no navegador e no servidor. |

**Regra de ouro:** a IA nunca digita coordenada. Ela diz *onde* estão os números; o executor copia; o validador prova. Uma receita da IA sempre exige o "conferi" do operador na primeira vez.

## Funções e banco

- **`ler-arquivo` (nova)**:
  - abre o arquivo e aplica perfil, regras e IA;
  - devolve a receita e as linhas para a prévia;
  - não cria serviço nem gasta crédito;
  - registra as chamadas de IA (custo) e os arquivos que não deu para ler;
  - tem a ação `regressao` (superadmin), que reaplica os perfis aos arquivos que eles já leram.
- **`parse-txt`**:
  - aceita `arquivo_base64` + `leitura` (receita, ordem, exclusões, σ declarado, confirmações);
  - guarda o original byte a byte e `leitura.json`;
  - grava `nome_txt` e `linha_txt` em cada vértice;
  - registra a leitura e aprende o perfil;
  - o cliente antigo (só `conteudo`) continua funcionando.
- **`reunir-certificados`**: usa `leitura.json` quando existe (o arquivo pode ser de um formato que o parser antigo nem lê).
- **Migração 0035**:
  - `vertices.nome_txt` e `vertices.linha_txt`;
  - tabelas `perfis_leitura`, `leituras_arquivo`, `chamadas_ia` e `arquivos_recusados`;
  - bucket `uploads-recusados`;
  - `escritorios.leitura_ia` (a empresa pode desligar a IA);
  - RPCs do superadmin.
- **Superadmin → Sistema → Formatos de arquivo**:
  - formatos aprendidos (tornar global, excluir);
  - custo e aprovação da IA;
  - arquivos não lidos (baixar, marcar resolvido);
  - "Conferir perfis contra os arquivos já lidos".

### Variáveis de ambiente (funções)

| Variável | Padrão | Para quê |
|---|---|---|
| `OPENAI_API_KEY` | — | Sem ela, a IA fica desligada e os formatos duvidosos vão para o mapeamento na tela. |
| `OPENAI_MODELO_RAPIDO` | `gpt-6-luna` | 1ª e 2ª tentativas (US$ 0,10 / 0,50 por milhão de tokens). |
| `OPENAI_MODELO_FORTE` | `gpt-6.1-sol` | 3ª tentativa (US$ 2 / 10 por milhão). |
| `OPENAI_LIMITE_DIARIO` | `60` | Chamadas por empresa a cada 24 h. |

## Decisões (Wilker, 2026-11-01)

- **Rótulo "V"** (σ 0): continua marco **M**, como sempre, mas o "V" deixa de virar nome de confrontante.
- **Rótulo de uma palavra** ("estrada", "muro", "DIVISÃO"): fica como hoje, ou seja, vira M com a palavra como confrontante.
- **IA**: OpenAI, `gpt-6-luna`, com `gpt-6.1-sol` nos casos difíceis.

## Evidência (testes: `npm test`, 527 passando)

| Teste | O que prova |
|---|---|
| `leitor_corpus` | Os **119 arquivos reais distintos** (220 envios, da VPS, fora do Git) dão exatamente o resultado do parser antigo, ponto a ponto, salvo as correções intencionais. **Ordem:** a escolhida bate com a ordem final que a equipe deixou no banco em **49 de 51** serviços (o parser antigo, 36). Em 13 a equipe tinha corrigido à mão o que agora sai sozinho, e nenhum piorou. **Correções:** o σ de 221 m (era "0221") de dois arquivos, antes gravado calado, agora é barrado; o rótulo lixo do JACO LOTE sai. |
| `leitor_sintetico` | **~2.350 arquivos gerados** a partir dos levantamentos reais, em 29 formatos e variações (PNEZD, Trimble, Emlid, Emlid Studio só lat/lon, cabeçalho chinês X/Y, GMS, σ em mm, base no meio, cabeçalho repetido, cp1252, UTF-16, GSI-16, KML, GPX, LandXML, JobXML, DXF, GeoJSON, memorial, chave=valor, 8 embaralhamentos de colunas): **zero leituras dadas como certas que estejam erradas**. O que o sistema não tem certeza vai para a IA ou para o operador. |
| `leitor_formatos` | xlsx (com o ruído binário do Excel), ods (com as linhas repetidas), KMZ, PDF com texto, PDF escaneado (recusado), RTKLIB `.pos`, relatório IBGE-PPP. |
| `leitor_ia` | A cascata com a API simulada: aprovação, reprovação com motivo e nova tentativa, JSON inválido, regex perigosa, modelo sem esquema estrito, chave inválida. **Ao vivo:** roda sozinho quando houver `OPENAI_API_KEY` no `.env`. |
| `funcoes_ponta_a_ponta` | O código **real** de `ler-arquivo` e `parse-txt` no Node, com o Supabase falso em memória: formato da equipe, perfil aprendido, confirmação obrigatória, σ declarado, IA (custo, aprendizado, 2º arquivo sem IA), binário, cliente antigo e falta de login. |
| `leitor_unidade` | Números, ângulos, codificações, receita não confiável, executor, ordem, validador (V1 adulterado, V2), assinatura e a regra do "V". |

## Como publicar

```
bash scripts/publicar-leitura-universal.sh            # simulação: mostra cada passo
bash scripts/publicar-leitura-universal.sh --executar # publica (com o aval)
git push                                              # front na Vercel (depois das funções)
```

O front tem rede de segurança: se `ler-arquivo` ainda não estiver no ar, o envio cai no caminho antigo.

## Como ensinar um formato novo ao sistema (sem código)

1. O operador envia o arquivo. As regras ou a IA propõem a leitura, e o operador confere ou ajusta as colunas na tela.
2. Ao criar o serviço, a receita vira **perfil da empresa**.
3. No painel, o superadmin pode **tornar o perfil global**: todas as empresas passam a ler aquele aparelho sozinhas.
4. Se um arquivo não for lido, ele aparece em "Arquivos que não foram lidos" para baixar e analisar. Formatos de várias linhas por ponto ainda não cobertos viram um extrator novo em `formatos.ts`, com teste no gerador.

## Limites (honestos)

- **Binário proprietário** (Leica DBX, Trimble .job): nenhum software lê sem o SDK do fabricante. O sistema mostra como exportar em texto.
- **PDF escaneado/foto**: recusado com orientação, porque não dá para garantir os números.
- **Imóvel ao norte do Equador**: o motor geodésico calcula só no hemisfério sul (fusos 18S–25S). A leitura avisa e barra.
- **DXF com pontos muito próximos**: os nomes deduzidos pelo texto vizinho podem trocar. A leitura marca dúvida e pede conferência.
