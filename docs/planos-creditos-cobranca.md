# Planos, créditos em carteiras e cobrança pelo Asaas (0034)

Pedido do Wilker (2026-10-30): créditos gerais e créditos de CAR, quatro planos (em 11/11/2026 viraram dois: ver a seção 0050 no fim),
preço do crédito extra por plano (com faixas no Só CAR), tudo ajustável por plano
e por empresa; compra de crédito automática pelo Asaas; empresa nova recebe o link
de pagamento no WhatsApp e só entra depois de pagar.

## Como funciona

**Carteiras** (`tipos_credito`): `geral` paga qualquer serviço; `car` paga só o CAR.
Um serviço gasta primeiro a carteira própria (o CAR gasta CAR), depois a geral.
Crédito geral no CAR só com o aceite do cliente (tela "Seus créditos de CAR
acabaram → Usar 1 crédito geral"; o banco recusa sem `servicos.usar_credito_geral`).
Dentro de cada carteira: primeiro o crédito do mês, depois o extra (que não vence).
Carteira nova = uma linha em `tipos_credito`; as telas percorrem a lista.

**Planos** (semeados pela migração):

| Plano | Mensalidade | Gerais/mês | CAR/mês | Crédito geral extra | Crédito de CAR extra |
|---|---|---|---|---|---|
| Autônomo | R$ 299,90 | 6 | 12 | R$ 70,00 (mín. 2) | R$ 9,90 (mín. 2) |
| Profissional | R$ 599,90 | 12 | 25 | R$ 60,00 (mín. 2) | R$ 9,90 (mín. 2) |
| Empresarial | R$ 999,90 | 25 | 50 | R$ 50,00 (mín. 2) | R$ 9,90 (mín. 2) |
| Só CAR | R$ 49,90 | 0 | 5 | não vende | 2–9: R$ 19,90 · 10–50: R$ 15,00 · 51+: R$ 10,00 |

O Só CAR libera só o CAR (mais Equipe e GPROL) e não libera recurso que entrar
depois (`planos.libera_recursos_novos = false`). Os planos de antes (Essencial,
Completo…) saem do cadastro de empresa nova, mas quem está neles continua sem limite.

**Ajuste por empresa** (Painel → empresa → Plano e créditos): mensalidade, créditos
por mês de cada carteira e tabela de preço do extra. O da empresa vence o do plano.

**Período do crédito**: renova no `escritorios.dia_renovacao` (1 = mês do
calendário). A empresa que nasce pagando renova no dia do vencimento da mensalidade.

**Cobrança** (edge function `cobranca`, lógica em `fluxos.ts`):
- Empresa nova com "Link de pagamento pelo Asaas": nasce `aguardando_pagamento`,
  a função cria cliente + assinatura mensal (vence hoje, Pix/boleto/cartão) e manda
  no WhatsApp o link e os dados de acesso. Pagou, o webhook ativa a empresa e manda
  "acesso liberado". Antes de pagar, quem entra vê "Falta o pagamento" com o link.
- Compra de crédito: o dono escolhe a carteira e a quantidade, o preço sai da
  tabela, a gaveta mostra o Pix (QR + copia e cola) e confere o pagamento a cada 6 s;
  pago, os créditos entram sozinhos e o WhatsApp avisa.
- Webhook do Asaas: `…/functions/v1/cobranca?origem=asaas`, token próprio (criado
  pelo painel ao salvar a chave). Evento repetido é ignorado; erro interno responde
  200 (o Asaas desliga a fila depois de falhas) e fica em `asaas_eventos`.
- Rede de segurança: "Conferir no Asaas" (painel) e a conferência automática da
  gaveta e da tela "Falta o pagamento".
- Sem a chave do Asaas, a compra vira pedido que o superadmin aprova (como antes).
- Segredos (chave do Asaas, token do webhook, chave da Evolution) ficam em
  `cobranca_config`, que só a função lê.

## Publicar (cada passo pede o aval do Wilker)

1. Backup do banco e migração `0034` na VPS (`psql -1 -v ON_ERROR_STOP=1`), depois
   `docker service update --force sb_rtkconverte_rest`.
2. Função nova `cobranca` (`index.ts`, `fluxos.ts`, `deno.json` e os `_shared`
   `asaas.ts`, `whatsapp.ts`, `mensagens_cobranca.ts`, `precos.ts`) e registro em
   `FUNCTIONS_IMPORT_MAPS` e `FUNCTIONS_VERIFY_JWT_MAP` **com false** (como a `gprol`).
   Função `superadmin` atualizada (`aguardando_pagamento`). Reiniciar
   `sb_rtkconverte_functions`.
3. Merge da branch `planos-creditos-asaas` na `main` (push = Vercel).
4. No painel: Configurações → Pagamentos → colar a chave do Asaas (sandbox
   primeiro) e, se for usar, WhatsApp (URL, instância e chave da Evolution).

O front sem a 0034 não quebra o envio de arquivo (`meus_creditos` antigo → nada
bloqueia), mas as telas de plano/crédito do painel precisam dela: por isso o push
vem depois da migração.

## Decisões tomadas sem perguntar (fáceis de trocar)

- "Acima de 50" no Só CAR = a partir de 51 créditos.
- Compra máxima de 1000 créditos por vez; até 5 compras esperando pagamento.
- Mensalidade vencida (aviso PAYMENT_OVERDUE do Asaas, no dia seguinte ao vencimento,
  ou a conferência): **suspende o acesso** (pedido do Wilker) — a empresa volta a
  `aguardando_pagamento`, vê a fatura vencida e recebe o aviso no WhatsApp; pagou,
  volta sozinha. Suspensão feita à mão no painel não é desfeita por pagamento.
- Mensalidade nova da empresa com assinatura viva vai para o Asaas ao salvar
  (inclusive as cobranças em aberto).
- Trocar a conta ou o ambiente do Asaas esquece os clientes da conta antiga.

## Testes

`npm run test:rls` (tests/rls/planos_cobranca.sql) e `npm test`
(tests/cobranca.test.mjs: fluxos inteiros com Asaas, Evolution e banco falsos).
Telas: `#/lab/casca/{inicio,aceite,creditos,socar,pagamento}[?semasaas]`,
`#/lab/sistema/config`, `#/lab/admin/{planos,empresas/e1,empresas/e5,config}`.

## Cartão de crédito e compra automática (0037, 04/11/2026)

**O que o cliente vê**
- Dono de empresa que paga algo (mensalidade > 0 ou crédito à venda), com o Asaas
  ligado e sem cartão: ao entrar (inclusive no 1º acesso, logo depois de trocar a
  senha) aparece a tela **"Cadastre o cartão para cobrança automática e compra de
  crédito"**, com "Agora não" (vale até sair). No Início fica a faixa com o mesmo texto.
- "Falta o pagamento" (empresa nova ou suspensa): **Pagar com cartão** — paga a fatura
  em aberto na hora e libera; Pix/boleto continuam como alternativa.
- Configurações → Plano e uso → **Cartão e compra automática**: cartão salvo
  (bandeira, final, validade), trocar, remover e, por carteira, ligar a compra
  automática (quantos comprar e limite por mês, em R$).
- Comprar créditos: com cartão salvo que compra créditos, **Pagar no cartão •••• 1234**
  (entra na hora) e Pix/boleto como segunda opção.
- Créditos acabaram e a compra automática está ligada: a tela "créditos acabaram"
  mostra que está repondo; o WhatsApp avisa a compra (ou a recusa).

**Como funciona**
- Os dados do cartão vão da tela à função `cobranca` e dela ao Asaas, só naquela
  chamada; o banco guarda bandeira, final, validade e o token (`cobranca_cartoes`,
  que ninguém lê pelo navegador).
- `cartao_salvar`: tokeniza; paga com o cartão o que venceu ou vence hoje; troca a
  assinatura de boleto/Pix por uma no cartão (próximo vencimento) e remove a antiga.
  Empresa nova sem cobrança: assinatura no cartão vencendo amanhã e a 1ª paga na
  hora (assim o Asaas não cobra duas vezes). Recusado: nada fica salvo.
- `cartao_remover`: a mensalidade volta a boleto/Pix no mesmo vencimento.
- Compra automática: a tela vê uma carteira zerada com a recarga ligada e chama
  `recarga_automatica`; o banco decide (`reservar_recarga_automatica`, empresa
  travada): carteira zerada, cartão com token, nenhuma compra em curso (10 min),
  teto do período, nenhuma recusa nas últimas 6 h. Recusado: cancela, marca a
  recusa e avisa no WhatsApp.
- Painel → empresa: 3 formas de criar — **liberar depois do pagamento** (link da 1ª,
  vence hoje), **liberar agora e cobrar** (entra já; link vence em 3 dias; sem pagar,
  suspende) e **liberar sem cobrança**.

**Depende do Asaas:** reusar o cartão (compra na hora e automática) precisa da
**tokenização liberada** na conta — em 04/11 a conta GRUPO D'PROL respondia
"Você não possui permissão… Entre em contato com seu gerente de contas". Sem ela o
cartão é enviado direto na assinatura (paga a mensalidade) e os créditos continuam
por Pix; o painel (Configurações → Pagamentos) mostra "Cartão salvo (tokenização):
não liberada". Liberada, quem cadastrar o cartão de novo ganha a compra automática.

**Testes:** `tests/rls/cartao_recarga.sql` (no `npm run test:rls`) e os cenários de
cartão em `tests/cobranca.test.mjs`. Telas: `#/lab/cartao/{tela,aviso,painel,
painel-mensal,pagamento,comprar,semcredito}` e `#/lab/admin/config` (QR do WhatsApp).
Publicação: `bash scripts/publicar-cartao.sh [--executar]` e depois o push.

## Mensalidade a partir do 1º crédito + convite (0049, 10/11/2026)

**Pedido:** para clientes escolhidos pela equipe, o acesso é liberado já e a
mensalidade só começa a contar no dia em que a empresa gasta o **primeiro**
crédito. Vale uma vez; depois é a cobrança de sempre.

**Duas portas (as duas da equipe; o cliente nunca escolhe sozinho):**
- Painel → Empresas → Nova empresa → **"Liberar agora; cobrar a partir do 1º
  crédito usado"** (precisa do Asaas e da mensalidade).
- Painel → Configurações → **Convites**: plano, para quem e validade (1–90 dias,
  padrão 30) → link `/cadastro/?convite=<token>` para copiar ou mandar no
  WhatsApp. Uso único; vale mesmo com o cadastro pelo site fechado; não cobra
  adesão; a pessoa escolhe só o período. O link público `?plano=` continua
  cobrando no cadastro: a condição só sai do token gravado no banco.

**Como funciona:**
- `cobranca_empresas.inicio_no_primeiro_credito` marca a condição; a empresa
  nasce `ativo` (origem `convite` quando veio pelo link).
- Gatilho `consumos_zz_primeiro_credito` (no 1º `consumos_credito`): grava
  `primeiro_credito_em` e muda `escritorios.dia_renovacao` para o dia (créditos e
  mensalidade andam juntos).
- A função `cobranca`, ação `iniciar_mensalidade`, cria a assinatura no Asaas
  (Pix/boleto/cartão na fatura) **vencendo um mês depois do 1º crédito** (pedido de 10/11: o 1º mês é usado e pago no fim; ou hoje, se
  sair depois), grava `mensalidade_iniciada_em` e manda o link no WhatsApp da
  empresa (+ aviso ao superadmin). Quem chama: o app (quando `minha_cobranca()`
  diz `mensalidade_a_iniciar`), o cadastro do cartão e "Conferir" do superadmin
  (que pega todas as pendentes). Trava de 30 s contra duas assinaturas.
- Antes do 1º crédito: não aparece "Cadastre o cartão" e o cartão é recusado
  (criaria a assinatura antes da hora). O Início mostra "Nada a pagar por
  enquanto…".
- "Cobrar já" na aba Cobrança da empresa encerra a condição (a mensalidade começa
  no dia).
- Daí em diante: vencida suspende, paga reativa (como qualquer empresa).

**Painel:** a lista de empresas mostra "Cobra no 1º crédito" / "1º crédito gasto
· gerar cobrança"; a aba Cobrança explica o estado e tem "Gerar a mensalidade
agora".

**Testes:** `tests/rls/cobranca_primeiro_credito.sql` (no `npm run test:rls`) e
os cenários "1º crédito" e "convite" em `tests/cobranca.test.mjs`. Telas:
`#/lab/assinar/convite[-plano|-vencido]`, `#/lab/admin/config` (Convites),
`#/lab/admin/empresas/e6` e `/e7`, `#/lab/casca/inicio?primeirocredito`.
Publicação: `bash scripts/publicar-primeiro-credito.sh [--executar]` e logo
depois o push da main.

## Dois planos + escritórios adicionais (0050, 11/11/2026)

**Pedido do Wilker:** só dois planos e a modalidade escritório.

| Plano | Mensalidade | Projetos/mês | CAR/mês | Crédito adicional | Escritórios adicionais |
|---|---|---|---|---|---|
| Profissional | R$ 299,90 | 8 | 16 | projetos: 2–5 = R$ 50,00 · 6+ = R$ 40,00 (cada); CAR: R$ 9,90 (mín. 2) | não tem |
| Empresarial | R$ 1.000,00 | ilimitado | ilimitado | não vende (não precisa) | até 2, R$ 99,90/mês cada (ativo) |

"Créditos para projetos" = a carteira `geral` (paga qualquer serviço). Autônomo e
Só CAR saem do cadastro (`ativo = false`, `vende_no_site = false`); quem está
neles continua igual. Convite antigo para esses planos deixa de abrir (`plano`).

**Quem já era cliente não muda sozinho:** a migração grava na própria empresa a
condição de antes para quem estava no Profissional ou no Empresarial
(`escritorios.mensalidade`, `escritorio_creditos`, `precos_credito` da empresa).
Para passar alguém para a regra nova: Painel → empresa → Plano e créditos →
"Como no plano" em cada linha (e "Atualizar valor no Asaas" na Cobrança).

**Escritório adicional** = empresa filha (`escritorios.matriz_id`), um nível só:
- espaço próprio (serviços, clientes, cadastros, configurações, modelos, equipe);
- plano, recursos e créditos são os da matriz — **um saldo só para o grupo**
  (`franquia_credito`, `uso_credito`, `saldo_extra`, `tabela_precos`,
  `recurso_liberado` e o período usam `empresa_pagante()`); compra de crédito,
  cartão e recarga ficam sempre na matriz;
- mensalidade: `mensalidade_de(matriz)` = plano (ou a combinada) + escritórios
  **ativos** × preço; escritório = 0. Empresa sem cobrança (0) continua sem;
- matriz suspensa/esperando pagamento = escritórios parados (`escritorio_atual`,
  `tem_permissao`); `meu_escritorio` devolve o status da matriz;
- o dono da matriz cria/renomeia/desativa/reativa em **Configurações →
  Escritórios** (`meus_escritorios`, `criar_escritorio`, `definir_escritorio`) e
  entra pelo **seletor no alto do menu** (`usar_escritorio` grava
  `membros_escritorio.escritorio_em_uso`; o sistema recarrega no Início). Uma
  faixa no alto mostra "Escritório X · matriz" com "Voltar à matriz";
- o escritório nasce com as configurações da matriz (menos chaves de
  integração/senhas: `gprol|token|segredo|secret|senha|chave|api`); logo e
  modelos sobem de novo nas Configurações dele;
- equipe própria: o dono adiciona pessoas estando no escritório (função `equipe`
  usa o escritório em uso; `definir_membro`/`pode_adicionar_membro` tratam o dono
  da matriz como dono); quem é da equipe de um escritório entra só nele;
- desativar tira da mensalidade e guarda tudo; reativar respeita o limite;
- plano da matriz muda → escritórios seguem o plano e o dia; limite menor →
  os mais novos além dele são desativados (`ajustar_escritorios`);
- depois de mudar a lista, a tela chama a função `cobranca`
  (`escritorios_sincronizar`): o valor novo vai para a assinatura no Asaas (e as
  faturas em aberto), com a descrição "plano X + N escritórios adicionais".

**Painel:** Planos → "Escritórios adicionais" e "Preço por escritório"; lista de
empresas mostra o escritório logo abaixo da matriz ("paga na matriz"); página da
matriz → Plano e créditos → "Escritórios adicionais" (lista + ajuste só da
empresa: limite e preço, vazio = do plano). A página do escritório aponta para a
matriz (sem abas de plano, créditos e cobrança).

**Testes:** `tests/rls/planos_escritorios.sql` (no `npm run test:rls`; inclui
reaplicar a migração e o cliente antigo preservado) e os cenários
"escritórios" em `tests/cobranca.test.mjs`. Telas: `#/lab/casca/escritorios`,
`/escritorios-oferta`, `/filial?trilho`, `#/lab/assinar/plano`,
`#/lab/admin/{planos,empresas,empresas/e4,empresas/e8}`.
Publicação: `bash scripts/publicar-planos-escritorios.sh [--executar]` (0050 +
funções cobranca e equipe) e logo depois o push da main.
