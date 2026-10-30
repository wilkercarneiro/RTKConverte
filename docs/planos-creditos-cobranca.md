# Planos, créditos em carteiras e cobrança pelo Asaas (0034)

Pedido do Wilker (2026-10-30): créditos gerais e créditos de CAR, quatro planos,
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
