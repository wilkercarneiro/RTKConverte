# Integração Vertces ↔ GPROL

Plano de arquitetura e implementação, escrito em 2026-10-29 depois da leitura dos dois repositórios. Antes de fechar, um revisor independente comparou o plano com o código e as falhas que ele achou foram corrigidas aqui (seção 11).

**Implementado em 2026-10-29/30.** O que mudou durante a construção, onde está cada peça e como operar estão na **seção 12**; ela vale sobre o texto do plano quando os dois divergem. O repositório do GPROL em uso é `C:\prolum\dprol-61e44d52` (o `D:\gprol` está desatualizado).

## 1. O pedido

- Quem tem conta no GPROL vê um botão **"Conectar GPROL"** dentro do Vertces e entra com o login do GPROL.
- Depois de conectado:
  - os clientes do GPROL aparecem no Vertces;
  - o serviço feito no Vertces aparece no GPROL;
  - os documentos gerados no Vertces abrem no GPROL;
  - o serviço criado no GPROL aparece no Vertces como **pendente de execução**;
  - executar no Vertces faz andar as **etapas que o GPROL já tem**.
- A integração é opcional. Quem não tem GPROL não vê nada de diferente.

## 2. Como cada sistema está hoje

| | GPROL | Vertces |
|---|---|---|
| Banco | Supabase self-host na VPS, stack `egdlthvoeqjtrkgkmmhu` | Supabase self-host na mesma VPS, stack `utxqkbgfgpbczqjtieyu` |
| Empresa | `companies`, `get_my_company_id()`, admin com `['*']` | `escritorios`, `escritorio_atual()`, dono/membro + `permissoes[]` |
| Cliente | `clients` (full_name, cpf_cnpj, email **único por empresa**, phone, address, updated_at, deleted_at) | `clientes` (nome, cpf_cnpj, telefone, email, endereco + gênero, espólio, inventariante, RG) |
| Serviço | `services`: **um por bloco da venda** ("Georreferenciamento + CAR" = 1 serviço). O `service_type_id` guarda só o primeiro tipo; os tipos todos estão em `opportunity_services` | `servicos`: um por modalidade (completo, conferência, peças, CAR, loteamento, divisão). Status rascunho/gerado |
| Etapas | **Card do serviço** num funil `pipeline_type='services'` (na D'Prol, "Status de Serviço"). Mover o card grava histórico e dispara automações (WhatsApp, cobrança). `services.status` é à parte e grosso | **Não ficam guardadas**: são deduzidas dos documentos gerados (`src/lib/progresso.ts`) |
| Documentos | `documents` (o que o cliente entrega) e anexos do card | `documentos_gerados` (tipo, versão, path) no bucket privado `gerados`, aberto por URL assinada |
| Integração | Nenhuma API pública. Webhooks de terceiros com `verify_jwt=false` e checagem dentro da função | Nenhuma. Sem pg_cron, pg_net, fila ou webhook |

Fatos que moldam o desenho (todos conferidos no código):

1. **O crédito do Vertces sai quando nasce o registro em `servicos`** (`servicos_zz_consumir_credito`, 0027). Pedido do GPROL não pode virar `servicos` antes de alguém executá-lo.
2. **Há cinco caminhos que criam serviço no Vertces:**
   - `parse-txt`;
   - CAR (`src/lib/car/persistencia.ts:37`), que **apaga o serviço se o projeto não salvar** (`:49`);
   - peças a partir do PDF (`PecasServico.tsx:163`);
   - glebas separadas (`Conferencia.tsx:660`);
   - partes da divisão (`Conferencia.tsx:744`).
3. **Um serviço do GPROL pode virar vários no Vertces.** "Georreferenciamento + CAR + CCIR + ITR" é um serviço lá e dois aqui (completo + CAR).
4. **Nas etapas do GPROL quem anda é o card.** Mover o card não mexe em `services.status`.
5. **O financeiro do GPROL lista em "Pendentes" todo serviço sem lançamento**, mesmo sem valor (`v_finance_pending_services`).
6. **No GPROL, o cliente do serviço às vezes é o intermediário** (despachante, contador). O dono real da terra só aparece no título do card.
7. **A auditoria do Vertces** (`atividades`) junta edições seguidas e ignora escritas sem usuário (`0026:107,153,182`). Ela não serve de fila e não registra o sincronismo sem ajuste.
8. **Loteamento e CAR geram os arquivos no navegador.** Esses arquivos não ficam em `documentos_gerados`.
9. **A D'Prol usa os dois sistemas.** É o piloto natural.

## 3. Arquitetura

### 3.1 Conexão por empresa, com cara de "entrar com GPROL"

**O fluxo:**
1. O botão leva ao GPROL.
2. O admin da empresa entra com o login de sempre e autoriza.
3. O GPROL devolve um código de uso único.
4. O servidor do Vertces troca esse código por uma **chave da integração**.

**A ligação é entre um escritório do Vertces e uma empresa do GPROL**, não entre pessoas. Se um funcionário sai, a integração continua. O Vertces não guarda senha nem sessão de ninguém.

**Segurança da conexão:**
- O endereço de volta é fixo (`https://vertces.com.br/app/`). O GPROL não aceita outro.
- O `state` fica gravado no Vertces (`integracao_estados`), preso ao usuário e ao escritório, e vence em 10 min.
- No GPROL, a autorização confere que quem autoriza é admin da empresa e que a empresa tem a feature.
- A chave fica guardada só como hash no GPROL. No Vertces, fica numa tabela **sem nenhuma policy** (só o service_role lê), nunca em `config_empresa`, que todo membro lê.
- Quem pode conectar:
  - no Vertces, o dono ou quem tem `empresa.configurar`;
  - no GPROL, o admin da empresa.

### 3.2 Um motor só, no Vertces

- **O GPROL expõe uma API** (edge function `vertces`, rotas `/v1`).
- **O Vertces faz todo o sincronismo**: empurra o que aconteceu nele e puxa o que mudou no GPROL.
- **A única chamada no sentido contrário é a de documentos**: o GPROL pede ao Vertces a lista dos documentos e o link do arquivo (3.7).

Com webhooks nos dois sentidos seriam dois motores, duas filas e dois jeitos de falhar calado.

### 3.3 Filas com confirmação, nunca chamada direta no meio da ação

**Vertces → GPROL**
- Os triggers gravam em `integracao_saida`.
- O worker só envia eventos com **30 s ou mais**. Antes de enviar `servico.*`, confere se o serviço ainda existe: o CAR que falhou e foi apagado (fato 2) não chega ao GPROL.
- Cada envio leva `Idempotency-Key` = id da fila. Repetir não duplica.
- Se falhar, tenta de novo com espera crescente (1, 5, 30 min, 2 h). Depois de 5 falhas, o item fica marcado "com erro" na tela.

**GPROL → Vertces**
- Os triggers gravam em `integration_outbox`.
- O Vertces lê os itens **ainda não confirmados**, processa e confirma (`POST /v1/changes/ack` com os ids).
- **Não existe cursor "id maior que o último".** Duas transações podem confirmar fora da ordem do id e o cursor pularia evento para sempre.
- Itens confirmados há mais de 30 dias são apagados.

**Os triggers de fila são mínimos e nunca derrubam a operação de origem.** Eles só fazem um INSERT, protegido por `EXCEPTION WHEN OTHERS → RAISE WARNING`. O de `services` roda dentro da venda ganha (`handle_opportunity_won_create_service`): um erro ali faria a venda sumir, o mesmo padrão do bug já documentado no CLAUDE.md do GPROL.

**Loop:** toda escrita feita pelo sincronismo marca a origem (`set_config('app.origem', …)`), e todos os triggers de fila ignoram essa origem, nos dois sistemas. Para isso a escrita do sincronismo é **sempre por RPC**, com `set_config` e a escrita na mesma transação. Pelo `.from().update()` do PostgREST o marcador se perderia.

**Quando o sincronismo roda (v1, sem pg_cron):**
- O front chama `gprol/sincronizar` logo depois de cada ação que gera evento (criar serviço, gerar documento, editar cliente).
- Também chama ao abrir Início, Serviços ou a página de um cliente.
- No uso normal o GPROL é atualizado em segundos. Se o GPROL estiver fora, o envio sai na próxima ação ou abertura.
- O pg_cron só entra se o piloto mostrar atraso real (fase 6).

**Trava por escritório:** é uma linha com prazo (`UPDATE integracoes SET travado_ate = now()+'2 min' WHERE travado_ate < now()`). Advisory lock não serve, porque pela conexão em pool do PostgREST ele prende o escritório para sempre.

### 3.4 Pedido do GPROL: só vira serviço quando alguém executa, e pode virar vários

No Vertces, o pedido mora numa tabela própria, `pedidos_externos`.

**O pedido guarda:**
- o título do card;
- a fazenda, o local, a área e as observações;
- **a lista de modalidades** (`modalidades text[]`).

A lista vem de **todos** os tipos do bloco, via `opportunity_services`, e não só do primeiro. Cada tipo de serviço do GPROL tem o campo novo `vertces_modalidade`. "Georreferenciamento + CAR + CCIR + ITR" vira `{completo, car}`, e CCIR/ITR ficam de fora.

**Ligação pedido → serviços (1 para N):**
- `servicos` ganha a coluna `pedido_externo_id`, gravada nos cinco caminhos de criação:
  - `parse-txt` recebe `pedido_id`;
  - CAR e peças passam o valor no insert;
  - glebas e partes da divisão herdam o valor do serviço pai.
- O crédito sai como hoje, no nascimento de cada serviço. Glebas e partes derivadas continuam grátis.
- Um trigger AFTER INSERT liga o pedido: `pendente → em_execucao`.

**Onde o pedido aparece:**
- em **Início** ("A executar · GPROL");
- na página do cliente, com o título do card ao lado ("Jamille — Fazenda Boa Vista" mesmo quando o cliente no GPROL é o despachante).

**Executar** abre o novo serviço já com o cliente e a modalidade. Quando o pedido tem duas modalidades, mostra as duas, cada uma com o seu selo "feito / a fazer".

**Status do pedido:**
- `pendente`
- `em_execucao`
- `entregue`
- `cancelado`
- `descartado` (o técnico pode descartar, por exemplo um pedido que não é trabalho de campo)

O pedido fica aberto até "Entregar" ou até todas as modalidades terem serviço.

**Se o serviço do Vertces for excluído**, o pedido volta a `pendente` com o aviso "o serviço feito aqui foi excluído". O crédito não volta (regra atual da 0027).

### 3.5 Etapas: o Vertces avisa marcos e o GPROL decide a etapa

O Vertces não conhece o funil do GPROL. Ele avisa marcos:

| Marco | Quando |
|---|---|
| `servico.iniciado` | primeiro serviço do pedido nasce |
| `documentos.gerados` | primeiro `memorial_docx`/`planilha_ods`/`planta_pdf_sistema` de um serviço do pedido; no CAR e no loteamento, o `status` virar `gerado` (filtrado pela modalidade, porque `gerar-documentos` e `gerar-pecas` também gravam `gerado`) |
| `planta_sigef.gerada` | primeiro `planta_pdf` |
| `pecas.geradas` | primeira peça técnica |
| `servico.entregue` | botão **"Entregar ao GPROL"** no pedido ou no serviço |

**O mapa marco → etapa fica no GPROL**, na tela Integrações → Vertces. Ela vem pré-preenchida pelos nomes das etapas do funil escolhido, e todo marco pode ficar em "não mover".

**Regras de movimento:**
- Move **o card do serviço que está no funil configurado**. Se o serviço não tem card nesse funil, nada se move e o evento fica no log com o motivo.
- **Só para frente**, pela `display_order`. Se a equipe já passou o card adiante à mão, ele fica onde está.
- Nunca tira o card de etapa `won` ou `lost`, nem o leva para etapa arquivada.
- O histórico do card recebe uma nota: "Vertces · Maria gerou memorial, planilha e planta (v2)".
- `servico.iniciado` também muda `services.status` de `pending_documents` para `in_progress`.
- Nenhum marco marca `completed`. Concluir mexe no financeiro (`finance_conclude_service`) e isso fica com a equipe.
- A tela de configuração **mostra as automações das etapas escolhidas** (WhatsApp ao cliente, iniciar cobrança). Quem configura vê o efeito antes.

**Autor no GPROL:** a escrita é feita pelo service_role, com `company_id` explícito.
- O histórico do card é gravado com `moved_by` = o admin que conectou, mais a nota com o nome de quem fez a ação no Vertces.
- As automações do GPROL já sabem rodar sem usuário (`run_stage_automations` usa `assigned_to`/`created_by`). A criação de card também (`create_pipeline_card_from_service`).
- **Não há impersonação.**

Antes de escrever a RPC é preciso ler `trg_pipeline_card_stage_change`, que só existe no banco [?]. Se ele já grava o histórico no UPDATE, a RPC não grava de novo. Se ele exige `auth.uid()`, a RPC passa o autor por `set_config('app.moved_by', …)` e o trigger é ajustado para ler esse valor.

### 3.6 Serviço criado direto no Vertces

- **Antes de criar,** se o cliente está ligado e tem pedido aberto (pendente **ou** em execução com modalidade ainda sem serviço), o Vertces pergunta: "É deste pedido do GPROL?". Essa pergunta é a defesa principal contra duplicado.
- **Se não for,** o serviço vai ao GPROL como serviço novo do cliente:
  - nome "Modalidade · denominação";
  - `farm_name` = denominação;
  - `property_location` = município/UF;
  - `status in_progress`;
  - sem valor.

  O card nasce na etapa mapeada para `servico.iniciado`. **Isso entra nos Pendentes do financeiro de propósito:** serviço executado sem cobrança é dinheiro perdido. Há uma opção por empresa para desligar.
- **Serviço derivado** (glebas e partes, com `origem_id`) não vira serviço novo no GPROL: pertence ao do pai.
- **Serviço que já existia antes da conexão:** o botão **"Vincular a serviço do GPROL"** escolhe um serviço aberto daquele cliente lá. É assim que os trabalhos em andamento da D'Prol entram.

### 3.7 Documentos: o GPROL pergunta na hora, nada é copiado nem sincronizado

- O card e a página do serviço no GPROL ganham a seção **"Documentos do Vertces"**. Ela só aparece se o serviço está vinculado.
- Ao abrir a seção, o front do GPROL chama a função do GPROL **com o login do usuário**, e a RLS do GPROL decide se ele vê aquele serviço.
- A função chama o Vertces com a chave da integração: `gprol-api/documentos?servico_gprol=<id>`.
- O Vertces confere o vínculo e devolve a **última versão de cada documento** de todos os serviços ligados, inclusive glebas e partes, agrupada por serviço ("Georreferenciamento", "Gleba 2", "CAR"…).
- Clicar num documento pede `gprol-api/documento?id=…`, que devolve uma **URL assinada de 5 min**.
- Sem link permanente circulando: memorial e planilha têm CPF e matrícula (LGPD).
- Desconectou, a seção some.

Assim não existe tabela de documentos no GPROL para manter em dia. Excluir, regenerar, `planta_pdf_editada`, peças de 1 a 7 e várias plantas de gleba já aparecem certos, porque a lista é lida na hora.

Loteamento e CAR não têm arquivo no servidor hoje (fato 8). A seção mostra "gerado no Vertces em 29/10" com o link "Abrir no Vertces".

### 3.8 Clientes

**Na conexão,** o Vertces importa os clientes do GPROL **que têm CPF/CNPJ**:
- paginado, 200 por vez, com `order by id`, por causa do corte silencioso de 1.000 linhas do PostgREST;
- casa pelo documento só com dígitos;
- se houver dois clientes no Vertces com o mesmo CPF, liga ao que tem mais serviços e avisa no resumo;
- os clientes sem documento (contatos do WhatsApp, intermediários) só vêm quando chega um pedido para eles.

**Os clientes do Vertces** sobem ao GPROL quando ganham um serviço enviado para lá, ou pelo botão "Enviar ao GPROL". Os antigos não sobem em massa.

**Campos em comum:**

| GPROL | Vertces |
|---|---|
| full_name | nome |
| cpf_cnpj | cpf_cnpj |
| email | email |
| phone | telefone |
| address | endereco |

Gênero, espólio, inventariante, RG e observações ficam só no Vertces.

**Edições:** vão nos dois sentidos, **só com os campos que mudaram**. Telefone editado de um lado e e-mail do outro, ao mesmo tempo, não se anulam.

**E-mail:** é único por empresa no GPROL. E-mail vazio vira NULL. Se o e-mail já existe lá em outro cliente, o cliente sobe sem e-mail e fica um aviso, em vez de travar a fila.

**Excluir não propaga:** só desfaz o vínculo. `pedidos_externos.cliente_id` usa `ON DELETE SET NULL`.

**Auditoria:**
- No Vertces, `carimbar_autoria`, `atividade_cliente` e `atividade_servico` passam a reconhecer `app.origem = 'gprol'` e registram **"GPROL (sincronização)"**. Hoje, escrita sem usuário fica invisível e sem carimbo.
- No GPROL, a nota vai no histórico do card.

### 3.9 Pedidos que já existiam antes da conexão

Na conexão, além dos clientes, o Vertces importa como pedidos os **serviços abertos do GPROL** (não concluídos, não cancelados) dos tipos com `vertces_modalidade`. O resumo diz quantos vieram. Sem isso, o trabalho em andamento da D'Prol ficaria de fora.

### 3.10 Planos

- **Vertces:** recurso `integracao.gprol` em `src/lib/recursos.ts`. Entra sozinho no painel do superadmin com o selo "decidir".
- **GPROL:** feature `integration_vertces`.

## 4. O que criar no GPROL

**Migração `2026MMDDhhmmss_integracao_vertces.sql`**, seguindo o CLAUDE.md do GPROL: `CREATE OR REPLACE`, `DROP POLICY IF EXISTS`, prova por `to_regclass`/`to_regproc` e `src/types/supabase.ts` regenerado no mesmo commit.

**Tabelas:**

| Tabela | Colunas | Observação |
|---|---|---|
| `integrations` | id, company_id, provider (`'vertces'`), status (`ativa`, `precisa_reconectar`, `revogada`), external_account_id, external_account_name, secret_hash, connected_by, connected_at, revoked_at, settings jsonb (pipeline_id, marco→etapa, receber_servicos_do_vertces), last_seen_at, last_error | Uma ativa por (company_id, provider) |
| `integration_auth_codes` | code_hash, company_id, user_id, state, expires_at (5 min), used_at | |
| `integration_links` | company_id, provider, entity (`client`, `service`), local_id, external_id | Para serviço, um serviço do GPROL tem um pedido no Vertces. Tabela nova, para não criar segunda FK entre `services`/`clients` e outra tabela já ligada |
| `integration_outbox` | id, company_id, provider, kind (`pedido.criado`, `pedido.cancelado`, `cliente.alterado`), entity_id, changed_fields jsonb, created_at, acked_at | O payload completo é montado na leitura (título do card incluído, que ainda não existe no momento do insert do serviço) |

**Coluna:** `service_types.vertces_modalidade text null`.

**Triggers de fila** (mínimos, protegidos, ignoram `app.origem = 'vertces'`, só agem com integração ativa):
- `services`: insert de bloco com algum tipo mapeado; status `canceled` ou `deleted_at` preenchido;
- `clients`: insert e update dos campos em comum.

**RPCs `security definer` com `company_id` explícito.**
- São elas:
  - `vertces_upsert_client`;
  - `vertces_upsert_service`, que usa `create_pipeline_card_from_service`;
  - `vertces_apply_milestone`;
  - `vertces_pending_changes`;
  - `vertces_ack`.
- **`REVOKE ALL … FROM public, anon, authenticated` e `GRANT EXECUTE` só para `service_role`.** É uma exceção deliberada à regra do CLAUDE.md, explicada em comentário na migração. Com `authenticated`, qualquer usuário logado gravaria em outra empresa.
- A única RPC chamada pela tela é `enviar_servico_ao_vertces(service_id)`. Ela confere `get_my_company_id()` e a permissão.

**Edge function `vertces`** (`verify_jwt=false`, checagem dentro, boot local com Deno antes do deploy):

| Rota | Quem chama |
|---|---|
| `POST /v1/connect/authorize` | front do GPROL (JWT de admin + feature) |
| `POST /v1/connect/token` | servidor do Vertces |
| `GET /v1/me` | Vertces (empresa, funil, etapas) |
| `GET /v1/clients?after=` | Vertces (importação) |
| `GET /v1/services/open?after=` | Vertces (importação de pedidos abertos) |
| `GET /v1/changes` · `POST /v1/changes/ack` | Vertces |
| `POST /v1/clients` · `/v1/services` · `/v1/milestones` | Vertces, com `Idempotency-Key` |
| `GET /v1/services/:id/documents` · `POST /v1/documents/open` | front do GPROL (JWT); a função repassa ao Vertces |
| `POST /v1/disconnect` | os dois lados |

**Front do GPROL:**
- **Configurações → Integrações → Vertces**: status, funil, mapa marco→etapa com as automações de cada etapa, a opção "receber serviços criados no Vertces", último contato, último erro e desconectar.
- **`/integracoes/vertces/autorizar`**: o destino do botão do Vertces. Pede login se preciso e mostra o que será compartilhado.
- **Tipo de serviço**: o campo "Executar no Vertces como…".
- **Serviço e card**: o selo "No Vertces", o botão "Enviar ao Vertces" e a seção "Documentos do Vertces".

## 5. O que criar no Vertces

**Migração `0028_integracao_gprol.sql`:**

| Tabela/coluna | Conteúdo | Acesso |
|---|---|---|
| `integracoes` | escritorio_id, provedor, status, empresa_externa_id/nome, conectado_por, conectado_em, travado_ate, ultima_sincronizacao, ultimo_erro, configuracoes | Leitura do escritório |
| `integracoes_segredos` | escritorio_id, provedor, segredo | **Sem policy** (só service_role) |
| `integracao_estados` | state, escritorio_id, user_id, expira_em | Só service_role |
| `vinculos_externos` | escritorio_id, provedor, entidade (`cliente`, `pedido`), local_id, externo_id | Único por (escritório, entidade, externo_id) |
| `pedidos_externos` | id, escritorio_id, externo_id, cliente_id (`ON DELETE SET NULL`), titulo, modalidades[], dados jsonb, status, recebido_em, atualizado_em | RLS do escritório |
| `servicos.pedido_externo_id` | FK para `pedidos_externos`, `ON DELETE SET NULL` | |
| `integracao_saida` | id, escritorio_id, tipo, ref_id, payload, tentativas, proxima_tentativa, enviado_em, erro | Só service_role escreve; o escritório lê o resumo |

**Triggers de fila** (ignoram `app.origem = 'gprol'`):
- `clientes`: update dos campos em comum de cliente vinculado;
- `servicos`: insert com pedido ou de cliente vinculado; delete;
- `documentos_gerados`: insert, que vira marco quando for o primeiro do tipo;
- `servicos.status → gerado`: só para CAR e loteamento.

**RPCs do sincronismo** (`security definer`, só service_role): `gprol_aplicar_cliente` e `gprol_aplicar_pedido`. Elas fazem `set_config('app.origem','gprol')` e a escrita na mesma transação.

**Auditoria:** ajustar `carimbar_autoria`, `atividade_cliente` e `atividade_servico` para registrar "GPROL (sincronização)".

**Edge functions** (as duas entram em `FUNCTIONS_IMPORT_MAPS` e `FUNCTIONS_VERIFY_JWT_MAP` do `sb_rtkconverte_functions`):

| Função | Rotas | Quem chama | O que faz |
|---|---|---|---|
| `gprol` (JWT) | `/conectar/iniciar` | dono ou quem tem `empresa.configurar` | começa a conexão |
| | `/conectar/concluir` | dono ou quem tem `empresa.configurar` | troca o código, importa clientes e pedidos abertos |
| | `/sincronizar` | qualquer membro | envia a fila e puxa e confirma as mudanças |
| | `/vincular` | qualquer membro | liga um serviço antigo a um serviço do GPROL |
| | `/entregar` | qualquer membro | marca o pedido como entregue |
| | `/desconectar` | dono ou quem tem `empresa.configurar` | desliga a integração |
| `gprol-api` (`verify_jwt=false`, chave da integração) | `/documentos` | GPROL | lista os documentos do serviço |
| | `/documento` | GPROL | devolve uma URL assinada de 300 s |

**Os cinco caminhos de criação** passam a gravar `pedido_externo_id`:
- `parse-txt` (recebe `pedido_id`);
- `persistencia.ts` do CAR;
- `PecasServico.tsx`;
- `Conferencia.tsx` nas glebas e nas partes, herdando do pai.

**Front:**
- **Configurações**, aba **Integrações**: o botão "Conectar GPROL", o resumo da importação, a última sincronização, os itens com erro com "tentar de novo", e desconectar.
- **Início**: o bloco "A executar · GPROL".
- **Página do cliente**: os pedidos do cliente e o selo GPROL.
- **Novo serviço**: a pergunta "É deste pedido?".
- **Página do serviço**:
  - o selo "GPROL · etapa X";
  - os botões "Entregar ao GPROL" e "Vincular a serviço do GPROL";
  - a faixa "Cancelado no GPROL".

## 6. Fluxos de ponta a ponta

1. **Conectar.**
   1. Vertces → Configurações → Integrações → Conectar GPROL.
   2. O GPROL abre (com login, se for preciso). Lá a pessoa escolhe o funil e confere o mapa de etapas, que vem pré-preenchido, e clica em Autorizar.
   3. A pessoa volta ao Vertces. O Vertces troca o código e importa os clientes com documento e os serviços abertos.
   4. Aparece o resumo: N clientes ligados, M criados e K pedidos.
2. **Venda ganha no GPROL.** O trigger atual cria o serviço e o card. Se o bloco tem tipo mapeado, um item cai na fila. Na próxima abertura do Vertces, ele vira pedido em Início.
3. **Executar.**
   1. O técnico clica em Executar → completo e sobe o TXT.
   2. O `parse-txt` cria o serviço com `pedido_externo_id`, e 1 crédito é consumido.
   3. O marco `servico.iniciado` chega ao GPROL: o card anda e o status vira `in_progress`.
   4. Depois o técnico executa o CAR do mesmo pedido, que vira o segundo serviço ligado e consome mais 1 crédito.
4. **Gerar.** Cada primeira geração de um tipo vira marco, e o card anda conforme o mapa.
5. **Abrir no GPROL.** A equipe abre o card e vê "Documentos do Vertces" com a lista atual. Clica, e o arquivo abre por uma URL de 5 min.
6. **Entregar.** O botão no Vertces manda o marco `servico.entregue`. O card vai para a etapa mapeada, e as automações da etapa (aviso ao cliente, cobrança) rodam como se fosse na tela.
7. **Cancelar no GPROL.**
   - Se o pedido ainda está pendente, ele some.
   - Se já está em execução, os serviços do Vertces ganham a faixa "Cancelado no GPROL" e nada é apagado.
8. **Desconectar,** de qualquer lado:
   - os dois lados mostram "desconectado";
   - os dados ficam onde estão;
   - os vínculos ficam guardados para reconectar à mesma empresa.

## 7. Fases

| Fase | Entrega | Pronto quando | Estimativa (grosseira) |
|---|---|---|---|
| **0. Prova** | Na VPS, ler o corpo de `trg_pipeline_card_stage_change`, `get_my_company_id` e `check_permission`, que só existem no banco. Listar as etapas do funil "Status de Serviço" da D'Prol, para sugerir o mapa. Conferir se os crons do GPROL ainda chamam `*.supabase.co`, que é o que as migrações mostram (achado lateral). Testar uma chamada entre as duas stacks pelo endereço público | Cada [?] respondido com SELECT ou chamada real | 0,5 dia |
| **1. Conexão** | Tabelas dos dois lados, autorização, telas de Integrações, desconectar, recurso e feature | A D'Prol conecta e desconecta; um membro comum não lê a chave (testado logado como membro) | 2–3 dias |
| **2. Clientes** | Importação com documento, envio junto com o serviço, edição por campo nos dois sentidos, auditoria | Editar o telefone num lado aparece no outro na próxima sincronização, sem voltar; o resumo bate com as contagens no banco | 2 dias |
| **3. Pedidos** | `vertces_modalidade`, fila com confirmação, pedidos abertos na conexão, Executar nos cinco caminhos, 1:N, cancelar, excluir | Bloco "Geo + CAR" ganho no GPROL vira um pedido com duas modalidades; cada execução consome 1 crédito só no upload; CAR que falha não chega ao GPROL | 3 dias |
| **4. Etapas** | Marcos, mapa no GPROL, só para frente, card do funil certo, serviço direto do Vertces no GPROL, pergunta anti-duplicado, Vincular, Entregar | O card anda sozinho no funil da D'Prol, com nota no histórico, sem histórico em dobro | 3 dias |
| **5. Documentos** | Seção no GPROL, `gprol-api` com lista e URL de 5 min | O memorial e a planta de gleba abrem no GPROL; usuário sem acesso ao serviço recebe 403 | 1,5 dia |
| **6. Piloto** | Uma semana na D'Prol; painel de erros; pg_cron só se houver atraso real | Uma semana sem item preso e sem serviço duplicado; depois liberar aos outros clientes | 1 dia + piloto |

Total: cerca de 13–15 dias de trabalho, mais a semana de piloto. Cada fase é publicável sozinha, com o recurso `integracao.gprol` desligado para quem não é piloto.

Cada lado é publicado do seu jeito de sempre e cada publicação pede o aval do Wilker:
- **Vertces:** migração na VPS, REST reiniciado, funções copiadas e push.
- **GPROL:** migração, deploy da função depois do boot local e push.

## 8. Testes

- **Vertces:** testes unitários do mapeamento: campos do cliente, marco por tipo de documento e modalidade, "só para frente" e modalidades de um bloco. O teste do catálogo de recursos já existe e cobra a chave nova.
- **GPROL:**
  - boot local da função;
  - RPCs testadas em `begin; … rollback;` com admin sem `user_type_id` e com funcionário;
  - prova de que `authenticated` **não** executa as RPCs `vertces_*`;
  - `typecheck`.
- **Ponta a ponta,** com uma empresa de teste em cada sistema:
  - conectar;
  - ganhar uma venda "Geo + CAR";
  - executar os dois;
  - gerar;
  - abrir no GPROL;
  - editar o cliente dos dois lados ao mesmo tempo;
  - cancelar;
  - excluir um serviço;
  - desconectar.

  Teste de falha: derrubar a função do GPROL no meio de uma geração. A fila tem de segurar o envio e reenviar sem duplicar.

## 9. Decisões do Wilker (com o padrão adotado)

1. **Serviço criado direto no Vertces vai ao GPROL?** Padrão: sim, e aparece nos Pendentes do financeiro. Há uma opção por empresa para desligar.
2. **Preço da integração.** Padrão: liberada em todos os planos do GPROL. No Vertces, a escolha é entre deixar só no plano Completo ou liberar em todos como argumento de venda cruzada. Fica para o Wilker decidir no painel ("decidir").
3. **Quem conecta no Vertces.** Padrão: o dono e quem tem `empresa.configurar`.

## 10. Fora desta versão

- Arquivos de loteamento e CAR dentro do GPROL (hoje não ficam no servidor).
- Confrontantes virando contatos no GPROL.
- Login único entre os sistemas. A ligação é entre empresas, e cada pessoa mantém o próprio login.
- Webhook do GPROL para o Vertces e pg_cron. A sincronização ao agir e ao abrir cobre o pedido; os dois entram só se o piloto mostrar falta.

## 11. O que a crítica mudou

| Rascunho | Problema achado no código | Agora |
|---|---|---|
| Só o `parse-txt` liga o pedido | Há mais 4 caminhos de criação, e o CAR apaga o serviço se falhar | `servicos.pedido_externo_id` nos cinco caminhos; envio com 30 s e conferência de que o serviço existe |
| Um pedido = um serviço; modalidade pelo tipo do serviço | O GPROL junta o bloco num serviço só e guarda só o primeiro tipo | Pedido 1:N com lista de modalidades de todo o bloco |
| RPCs com `GRANT … authenticated` | Qualquer usuário gravaria em outra empresa | Só `service_role` |
| Cursor "id maior que o último" | Commits fora de ordem pulam eventos | Confirmação explícita (ack) |
| Trigger em `services` sem guarda | Loop e risco de derrubar a venda ganha | Guarda de origem e EXCEPTION em todos os triggers de fila |
| Advisory lock | Fica preso na conexão do pool | Linha com prazo |
| `app.origem` em escrita comum | Se perde entre requisições; a auditoria do Vertces ignora escrita sem usuário | Escrita por RPC; auditoria ajustada |
| Impersonar o admin | Desnecessário: os fallbacks de autor já existem | Service_role + nota no histórico |
| Tabela de documentos no GPROL | Colide em glebas e versões e fica órfã ao excluir | O GPROL pergunta a lista na hora |
| Importar todo cliente | Traz contatos do WhatsApp e intermediários | Só clientes com CPF/CNPJ; o resto vem com o pedido |
| Última edição vence, registro inteiro | Perde edição simultânea em campos diferentes | Só os campos alterados |
| Nada sobre o que já existia | O trabalho em andamento da D'Prol ficaria de fora | Importar pedidos abertos + "Vincular a serviço do GPROL" |
| pg_cron, log, painel do superadmin na v1 | Mais coisa do que o pedido precisa | Sincronizar ao agir e ao abrir; pg_cron só se o piloto pedir |

## 12. Como ficou implementado (vale sobre o plano)

### Mudanças descobertas na construção

| Plano | O que o banco/código mostrou | Como ficou |
|---|---|---|
| Ler `trg_pipeline_card_stage_change` | Esse trigger **não existe**; quem grava o histórico do card é o front do GPROL | `vertces_apply_milestones` grava o histórico (`moved_by` = quem conectou + nota "Vertces · Fulano · documentos gerados") |
| Nunca tirar card de etapa `won` | No funil da D'Prol a primeira etapa ("PROPOSTAS FECHADAS") é `won` | Regra única: só para frente pela `display_order`, nunca para etapa arquivada |
| `service_types.vertces_modalidade` (uma) | Tipos como "USUCAPIÃO + CAR" são duas coisas | O mapa tipo → **lista** de modalidades fica em `integrations.settings.types` (sem coluna nova em `service_types`) |
| Serviço direto do Vertces vai ao GPROL ao nascer | O `servicos` nasce no upload, antes de ter detentor/denominação, e pode ser abandonado | Vai ao GPROL **ao gerar os primeiros documentos** |
| Pedidos abertos importados na conexão | A D'Prol tem ~138 serviços abertos, muitos já entregues | Na tela de autorização há a opção (marcada) "enviar também os serviços abertos destes tipos"; no Vertces dá para descartar os já feitos. No GPROL, Integrações também tem "Enviar os serviços abertos" |
| Documentos: o GPROL guarda a lista | — | O GPROL pede a lista na hora (proxy autenticado) e cada arquivo abre por URL de 5 min. A chamada GPROL → Vertces usa uma **segunda chave** (`callback_secret`; o Vertces guarda só o hash) |
| — | O pedido já traz fazenda e município | Ao executar, denominação e município/UF vêm do pedido (sem sobrescrever) |

### Onde está cada peça

**GPROL** (`C:\prolum\dprol-61e44d52`):
- Migração `supabase/migrations/20261029230000_integracao_vertces.sql`, aplicada na VPS em 2026-10-29 e provada por objeto: 5 tabelas, 16 funções e 6 triggers.
- Edge function `supabase/functions/vertces/index.ts`, publicada em `/opt/supabase/dprol/volumes/functions/vertces/`. Não precisa de mapa de env: o JWT é checado dentro da função.
- Telas em `src/features/integrations/vertces/`:
  - autorização: `/integracoes/vertces/autorizar`;
  - Integrações → Vertces;
  - seção "Vertces" no serviço e no card.

**Vertces** (`D:\RTKConverte`):
- Migração `supabase/migrations/0028_integracao_gprol.sql`, aplicada em 2026-10-29. O backup anterior está em `/opt/supabase/rtkconverte/backup-banco-20261030-integracao/`.
- Edge function `supabase/functions/gprol/index.ts` + `_shared/gprol.ts`, publicada. Entrou em `FUNCTIONS_IMPORT_MAPS`, com `verify_jwt=false` no mapa.
- Front:
  - `src/lib/gprol.ts`: conexão, sincronismo e pedidos;
  - `src/lib/pedidoGprol.ts`: regra pura;
  - `src/components/gprol/*`: Integrações, pedidos no Início e no cliente, faixa no serviço, pergunta "é deste pedido?";
  - gancho em `chamarFuncao`;
  - rota `#/novo/<chave>/<cliente|->/<pedido>`;
  - recurso `integracao.gprol`.

### Quando sincroniza
- **Ao abrir as telas:** Início, Serviços, cliente e serviço.
- **Depois de cada ação:** `parse-txt`, `gerar-documentos`, `gerar-pecas` e `gerar-planta`.
- **Com o app aberto:** a cada 3 minutos.
- **Ao entregar, vincular, conectar ou clicar em "Sincronizar agora".**

Não há pg_cron. Se ninguém abrir o Vertces, os pedidos novos esperam até a próxima abertura.

### QA feito
- **SQL em transação desfeita, nos dois bancos:** 14 testes no GPROL e 19 no Vertces, com controles negativos (`authenticated` não executa as funções de escrita nem lê chaves).
- **Ponta a ponta pela API**, nos servidores reais, com usuários de QA: 100 de 100 cenários.
  - conexão e permissões;
  - clientes (casamento por CPF, edição simultânea por campo, e-mail repetido, exclusão);
  - venda "Geo + CAR" → um pedido com duas modalidades;
  - `parse-txt` e `gerar-documentos` reais, consumo de 1 crédito;
  - card andando e histórico;
  - documento aberto pelo GPROL e URL adulterada recusada;
  - cancelar/reabrir, descartar, excluir;
  - serviço direto e glebas;
  - trava, idempotência;
  - desconectar e reconectar pelos dois lados.
- **Telas do Vertces no navegador:** 22 de 22, com prints.
- **Testes de unidade:** 9 em `tests/gprol.test.mjs`. A suíte inteira tem 405 testes.

### Operar
- **Conectar:** Vertces → Configurações → Integrações → Conectar GPROL. O admin do GPROL autoriza.
- **Mudar etapas e tipos depois (2026-10-30):** Vertces → Integrações → **Configurar sincronização** abre no GPROL a mesma tela da conexão (`/integracoes/vertces/configurar`), já com a configuração em uso. O admin de lá salva (`salvar_config`), pode mandar na hora os abertos dos tipos novos (`enviar_abertos`) e volta ao Vertces com `?gprol_config=ok`, que sincroniza e avisa. Não troca a chave nem refaz a conexão. Continua valendo também no GPROL, em Integrações → Vertces.
- **Atrelar serviços que já existiam (2026-10-30):** na página do cliente ligado ao GPROL, **Atrelar serviços** abre uma gaveta com o que o GPROL tem do cliente: pedidos "A executar" (por modalidade ainda não feita) e serviços abertos lá que ainda não vieram. Cada um recebe um serviço daqui: pedido → `servicos.pedido_externo_id` (os gatilhos da 0028 recalculam o pedido e enfileiram a etapa); aberto → ação `vincular`. Serviço derivado (gleba, parte) herda do principal e não aparece. "Desatrelar" só para pedido vindo do GPROL; pedido sem serviço feito aqui oferece "Executar agora".
- **Diagnóstico:**
  - Vertces → Integrações mostra o último erro e o que está esperando, com "Tentar de novo";
  - no banco: `integracao_saida` (Vertces) e `integration_outbox` (GPROL).
- **Publicar mudança numa função:** é como as outras de cada stack. No GPROL, rode antes o boot local (CLAUDE.md de lá); no Vertces, compare o md5 com o repo.
