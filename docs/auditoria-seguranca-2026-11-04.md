# Auditoria de segurança — 04/11/2026

Escopo: banco (RLS, funções, gatilhos), Storage, as 14 edge functions, o site
(Vercel) e a configuração da VPS (gateway Envoy, Traefik, GoTrue, PostgREST).
Método: leitura do código + testes no banco real dentro de `begin … rollback`
(nada gravado) + chamadas à API pública com a chave anônima.

## O que estava aberto e foi corrigido

| # | Gravidade | Falha | Prova | Correção |
|---|---|---|---|---|
| 1 | Crítica | Serviço "derivado de si mesmo" (`origem_id = id`) não gastava crédito; dele saíam serviços de qualquer tipo, de graça e fora do plano | Banco real: empresa Só CAR criou CAR e GEO completo com 0 consumos | 0038 §2: derivado só é gleba separada de verdade (mesmo tipo, origem paga, uma por gleba gravada) + `check origem_id <> id` |
| 2 | Alta | Criar como CAR (crédito barato) e trocar a modalidade para completo depois | Banco real: troca aceita | 0038 §3: gatilho recusa troca que a carteira gasta não cobre; origem não muda; glebas/partilha não mudam depois de separar |
| 3 | Alta | `gerar-pecas` modo `analisar` rodava o leitor de PDF sem login (só a chave pública) | Produção respondeu "Invalid PDF structure" a uma chamada anônima | Exige empresa ativa + permissão + 20/min + teto de 20 MB |
| 4 | Alta | Gestor (sem ser dono) trocava a senha de superadmin ou de outro gestor da equipe e entrava na conta | Código (`equipe` redefinir_senha) | `equipe`: conta com equipe.gerenciar/superadmin só o dono mexe; 0038 §8 no `definir_membro` |
| 5 | Média | GPROL assinava com a service_role um `path` gravado pelo cliente (arquivo de outra empresa) | Código | `gprol` só assina dentro da pasta do serviço; 0038 §5 `check` no `documentos_gerados` |
| 6 | Média | Nome de arquivo com `../` virava caminho no Storage (`parse-txt`) | Código | `nomeSeguro()` no `parse-txt`; teto de 30 CSVs × 5 MB |
| 7 | Média | Estorno/chargeback não tirava os créditos comprados | Código | 0038 §6: gatilho em `pagamentos` marca `estornado` (volta se a disputa for ganha); chargeback de mensalidade suspende |
| 8 | Média | Empresa sem plano = créditos ilimitados | Código | 0038 §7: sem plano = 0 |
| 9 | Média | Membro sem `servicos.criar` criava serviço direto pela API | Código | 0038 §4: política restritiva de INSERT |
| 10 | Média | Popup do mapa montava HTML com nome/código vindos do banco (XSS) | Código | `MapaInterativo`: `textContent` + `setDOMContent` |
| 11 | Média | Corpo das requisições lido sem teto (JSON de centenas de MB derruba o worker de 256 MB) | Local: 45 MB → 413 | `_shared/limite.ts` `lerJson` em todas as funções |
| 12 | Média | Nenhum limite de frequência; APIs pagas (OpenAI, Mapbox) e geração pesada repetíveis sem fim | Código | `limites_uso` + `consumir_limite` (0038 §1): gerar 30/5 min, leitura 40/5 min, IA 10/min, satélite 15/min, SIGEF 12/min, sobreposição 20/5 min, PDF 20/min |
| 13 | Média | `sigef_consultar` com raio sem teto varria a base | Banco real: raio 1e9 agora responde em 0,85 s | 0038 §9: raio ≤ 5 km, pré-filtro pelo índice, ≤ 50 mil vértices |
| 14 | Média | Buckets sem limite de tamanho | Banco real | 0038 §11: 25/20/100 MB |
| 15 | Baixa | `exigirPermissao`/`escritorioDoUsuario` LIBERAVAM quando o banco dava erro | Código | Falha fecha (503) |
| 16 | Baixa | Webhook do Asaas: qualquer um gravava linhas `AUTH_FAILED` sem teto | Código | ≤ 30 rastros/hora; corpo ≤ 256 KB |
| 17 | Baixa | Membro desativado ainda acionava a cobrança/recarga no cartão | Código | `cobranca`: só membro ativo |
| 18 | Baixa | IA sem empresa ficava sem limite; contagem diária com corrida | Código | Sem empresa = sem IA; reserva atômica 10/min |
| 19 | Baixa | `admin-setup` comparava o segredo com `!==` e sem teto | Código | Tempo constante + 60/h |
| 20 | Baixa | `integracao_ativa(uuid)` respondia sobre outra empresa | Banco real | 0038 §10: só service_role/gatilhos |
| 21 | Baixa | Site sem cabeçalhos de segurança | — | `vercel.json`: HSTS, nosniff, X-Frame-Options, CSP de enquadramento, Referrer/Permissions-Policy |

## O que foi conferido e está seguro

- Anônimo: as 45 tabelas devolvem vazio ou negado; RPCs de dinheiro negadas; os 5 buckets são privados e a listagem anônima vem vazia; cadastro aberto desligado (`signup_disabled`).
- Todas as tabelas com RLS; nenhuma função SECURITY DEFINER sem `search_path`; as funções `sa_*` exigem superadmin.
- Dinheiro: o tenant não escreve em consumos, compras, pagamentos, cobrança, cartões, preços nem planos; `consumir_credito` trava a empresa (`FOR UPDATE`) contra corrida; apagar serviço não devolve crédito; webhook com token em tempo constante e idempotente.
- Gateway: `/pg/` (SQL do postgres-meta) recusa a chave pública (RBAC do Envoy: 403); OpenAPI do REST só admin.
- Timeouts do Postgres: anon 3 s, authenticated 8 s; PostgREST no máximo 1000 linhas.
- Segredos: nenhum service_role, chave da OpenAI/Asaas/Mapbox no repositório nem no bundle.

## Pendências (não feitas aqui — decisão ou infraestrutura)

1. **Firewall da VPS desligado** (`ufw inactive`): as portas 2377/7946 do Docker Swarm ficam abertas para a internet. Ligar o ufw liberando só 22, 80, 443 (e 8080 se o IPTV usar) — mexe em todos os sistemas da VPS.
2. **GoTrue:** senha mínima 6 (o site pede 8) → `GOTRUE_PASSWORD_MIN_LENGTH=8`; troca de senha sem reautenticação; login limitado a 150 tentativas/5 min por IP → baixar para ~30.
3. **Gateway sem limite por IP** (Envoy sem `local_ratelimit`): as travas novas são por usuário/empresa; um limite por IP no Traefik/Envoy completa a proteção contra inundação anônima.
4. **Regra de negócio:** 1 crédito permite trocar os vértices e gerar para outro imóvel. Fechar exige "assinatura" da geometria na 1ª geração — decisão de produto.
5. **CAR e loteamento** geram o arquivo final no navegador: o crédito é porta do front, não do servidor.
6. `maplibre-gl` 5.x tem aviso crítico no sanitizador do `setHTML` (o sistema não usa mais `setHTML`); atualizar para a 6.x quando der.
7. Recursos `planta.editor`, `loteamento.maquete3d`, `sigef.*` conferidos só no front.
