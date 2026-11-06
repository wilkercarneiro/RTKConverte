---
{
  "titulo": "Gestão de escritório de topografia e georreferenciamento: equipe, fila e histórico",
  "seoTitulo": "Gestão de escritório de topografia e georreferenciamento | Vertces",
  "descricao": "Gestão de escritório de topografia e georreferenciamento: fila de serviços, permissões da equipe, auditoria, clientes reaproveitados e integração com o CRM.",
  "slug": "gestao-de-escritorio-de-georreferenciamento",
  "data": "2026-11-06",
  "atualizado": "2026-11-06",
  "categoria": "mercado",
  "palavraChave": "gestão de escritório de topografia",
  "palavrasRelacionadas": ["gestão de escritório de georreferenciamento", "controle de serviços de topografia", "sistema para escritório de agrimensura", "permissões da equipe", "auditoria de documentos", "crm para georreferenciamento"],
  "resumo": "Gerir um escritório de georreferenciamento é saber, a qualquer hora, o que falta em cada serviço, quem pode fazer o quê e quem mexeu em cada documento. No Vertces, a fila de serviços mostra o que falta por modalidade, a equipe trabalha com permissões por pessoa, a auditoria registra quem criou e quem alterou, clientes e confrontantes são reaproveitados e cada documento guarda suas versões. Quem usa o CRM GPROL recebe o pedido vendido como serviço a executar.",
  "faq": [
    { "p": "Quantas pessoas podem trabalhar no mesmo escritório no Vertces?", "r": "Vários operadores, cada um com o seu login e as suas permissões. As condições de cada plano (autônomo, escritório e empresa) estão no site e podem ser vistas numa demonstração." },
    { "p": "Um estagiário pode ver os serviços sem gerar documentos?", "r": "Pode. O perfil Consulta só vê e baixa o que já foi gerado. Gerar memorial, planilha, planta e peças é uma permissão separada." },
    { "p": "Os dados de um escritório aparecem para outro?", "r": "Não. Os dados de cada escritório ficam isolados no banco, e cada usuário só enxerga o escritório do qual faz parte." },
    { "p": "Preciso do GPROL para usar o Vertces?", "r": "Não. A integração é opcional. Quem não tem GPROL usa o Vertces normalmente e não vê nada diferente." },
    { "p": "O crédito é cobrado quando o pedido chega do GPROL?", "r": "Não. O pedido do GPROL fica como “a executar” e só vira serviço, consumindo crédito, quando alguém executa no Vertces." },
    { "p": "Dá para recuperar uma versão antiga do memorial?", "r": "Sim. Cada geração de documento é guardada como uma versão, e o histórico do serviço permite baixar qualquer uma delas." }
  ],
  "fontes": [
    { "titulo": "Lei 13.709/2018 (LGPD): segurança dos dados pessoais", "url": "https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm" },
    { "titulo": "INCRA: Certificação de Imóvel Rural", "url": "https://www.gov.br/incra/pt-br/assuntos/governanca-fundiaria/certificacao-imoveis" },
    { "titulo": "Lei 10.267/2001", "url": "https://www.planalto.gov.br/ccivil_03/leis/leis_2001/l10267.htm" }
  ]
}
---

Gestão de escritório de topografia e georreferenciamento é saber, a qualquer momento, o que falta em cada serviço, quem pode fazer o quê e quem mexeu em cada documento. Sem isso, o escritório vive de planilha de controle, pasta compartilhada e pergunta no grupo da equipe. No Vertces, a fila de serviços, as permissões, a auditoria, o cadastro de clientes e o histórico de versões ficam no mesmo sistema em que o trabalho técnico é feito.

Este post mostra como organizar cada uma dessas partes e como o Vertces resolve cada uma.

## Por que a gestão trava no escritório de georreferenciamento?

A gestão trava porque o trabalho técnico e o controle ficam em lugares diferentes. O TXT está numa pasta, o memorial em outra, o controle numa planilha, o contato do cliente no celular de alguém e a venda no CRM. Ninguém sabe qual é a versão final da planta.

Um serviço de georreferenciamento passa por muitas etapas: levantamento, conferência, documentos, envio da planilha ao SIGEF, certificação, peças técnicas, cartório. Cada etapa tem um documento, e cada documento pode ter várias versões. Somam-se a isso vários operadores, vários RTs e credenciados, e clientes que voltam anos depois para desmembrar a mesma fazenda.

| Problema do dia a dia | Onde costuma estar | Como fica no Vertces |
|---|---|---|
| O que falta em cada serviço | planilha de controle | fila de serviços com a coluna “Falta” |
| Quem pode gerar documento | confiança | permissões por pessoa |
| Quem alterou a planta | ninguém sabe | auditoria e autoria no topo do serviço |
| Dados do cliente e do vizinho | celular, documento antigo | cadastro reaproveitado |
| Versão certa do memorial | “memorial_final_v3_agora_vai.docx” | histórico de versões |
| Pedido vendido | CRM, sem ligação com a execução | pedido do GPROL vira serviço |

## Como acompanhar a fila de serviços?

A fila de serviços mostra, para cada trabalho, o que já foi feito e o que falta, de acordo com a modalidade. No Vertces, a lista de **Serviços** tem a coluna “Falta” e os pontos de progresso.

O detalhe que importa: o progresso muda com a modalidade. Uma conferência de área termina na prévia de área e perímetro, então o sistema não diz que “faltam as peças” para ela. Um serviço completo de matrícula só fecha com as peças técnicas. Um CAR tem outro fim. A fila mostra o que falta de verdade, e não um checklist genérico.

O **Início** reúne o que está em andamento e, para quem usa o GPROL, os pedidos que chegaram para executar. Para entender as modalidades, veja [o que é georreferenciamento de imóvel rural](/blog/georreferenciamento-o-que-e/).

## Como dar acesso à equipe sem perder o controle?

Cada pessoa do escritório tem o seu login e um conjunto de permissões. No Vertces, você adiciona a pessoa em **Configurações → Equipe** e escolhe o que ela pode fazer. As permissões são:

1. Criar serviços (enviar TXT, KML ou PDF).
2. Gerar documentos (memorial, planilha, planta e peças).
3. Excluir serviços.
4. Cadastrar e editar clientes.
5. Excluir clientes.
6. Incluir e remover responsáveis técnicos e credenciados.
7. Alterar os dados da empresa (razão social, logo, desenhista, modelos).
8. Gerenciar a equipe (só o dono concede).

Para não marcar uma por uma, há perfis prontos: **Operador** (o dia a dia), **Projetista** (operador que também cuida de RT e credenciados), **Consulta** (só vê e baixa) e **Gerente** (tudo). O dono do escritório tem todas.

A regra prática é simples: excluir e mexer em RT e credenciado fica com poucas pessoas. O cadastro do credenciado define o prefixo e a numeração dos vértices; um contador alterado por engano gera código repetido no SIGEF.

## Como saber quem fez cada alteração?

A auditoria registra quem criou e quem alterou cada coisa no escritório. No Vertces, ela aparece em dois lugares.

- **No topo de cada serviço**, todos veem quem criou e quem mexeu por último. Quem administra a equipe abre o histórico completo daquele serviço numa gaveta.
- **Na aba Auditoria da Equipe**, quem administra vê a linha do tempo do escritório, com filtro por pessoa e por assunto, os acessos e o uso de cada pessoa, e pode exportar em CSV.

Isso resolve a conversa “quem trocou o confrontante do trecho 3?”. Também ajuda a acompanhar o operador novo nas primeiras semanas, sem ficar olhando por cima do ombro.

### Como controlar as versões dos documentos?

Cada vez que você gera um documento, o Vertces guarda aquela geração como uma versão. O histórico do serviço lista todas, e qualquer uma pode ser baixada a qualquer momento.

Na prática, o arquivo “memorial_final_v3” deixa de existir. Se o cartório pediu correção e você gerou de novo, a versão anterior continua lá para comparar. Quando a planta tem o QR de autenticidade, a página de verificação avisa se existe versão mais nova, o que ajuda quando o cliente leva o papel antigo ao cartório. Veja [monografia de marco e QR de autenticidade](/blog/monografia-de-marco-e-qr-de-autenticidade/).

## Como reaproveitar clientes, imóveis e confrontantes?

Cadastre o cliente, o imóvel e os confrontantes uma vez e use de novo nos próximos serviços. Quem trabalha numa região atende a mesma família, o mesmo vizinho e a mesma fazenda várias vezes: o georreferenciamento hoje, o desmembramento daqui a dois anos, a partilha entre herdeiros depois.

No Vertces, o cadastro de clientes guarda os dados que vão para as peças (nome, CPF ou CNPJ, contato, endereço, e informações como espólio e inventariante). O confrontante cadastrado entra nas cartas de anuência sem ser digitado de novo. Isso reduz erro de CPF e de nome em documento que vai para o cartório. As cartas estão explicadas em [carta de anuência dos confrontantes](/blog/carta-de-anuencia-confrontantes/).

## Como ligar a venda (CRM) à execução?

Ligar o CRM à execução evita que o serviço vendido se perca entre o comercial e a equipe técnica. O Vertces tem integração com o **GPROL**, um CRM usado por escritórios de georreferenciamento. Ela é opcional.

Como funciona, depois de conectada:

1. **A conexão é entre empresas.** O dono do escritório (ou quem configura a empresa) clica em **Conectar GPROL**, e o administrador do GPROL autoriza. Se um funcionário sai, a integração continua. O Vertces não guarda senha de ninguém.
2. **A venda vira pedido.** O serviço vendido no GPROL aparece no Vertces como pedido “a executar”, com o título do card, a fazenda e o município. Uma venda de “Georreferenciamento + CAR” vira um pedido com duas modalidades.
3. **Executar consome o crédito.** O pedido só vira serviço quando alguém executa no Vertces. Até lá, nada é cobrado.
4. **O card anda sozinho.** Ao iniciar o serviço e ao gerar documentos, o Vertces avisa o GPROL, que move o card do serviço no funil conforme o mapa de etapas que o escritório configurou. O card só anda para frente e recebe uma nota no histórico com quem fez o quê.
5. **Os documentos abrem no GPROL.** No card, a seção de documentos do Vertces lista a última versão de cada arquivo, com link que vale por poucos minutos. Nada fica copiado, e memorial com CPF não circula por link permanente.
6. **Os clientes se encontram.** Na conexão, os clientes com CPF ou CNPJ são casados pelo documento. Edições de nome, telefone, e-mail e endereço passam de um lado para o outro.

O serviço criado direto no Vertces também pode subir ao GPROL. Antes de criar, se o cliente tem pedido aberto, o Vertces pergunta se o serviço é daquele pedido, para não duplicar. Trabalhos que já existiam antes da conexão podem ser atrelados na página do cliente.

## Como funcionam os créditos por serviço?

Os planos do Vertces trabalham com créditos por serviço: o custo é contado pelo trabalho, e não por arquivo baixado. Na conferência do TXT, o crédito só é consumido quando você prossegue: dá para ajustar pontos e ver o esboço antes.

Isso torna o custo previsível por trabalho, o que facilita o orçamento para o cliente. Há planos para autônomo, escritório e empresa; os valores estão no site e mudam com o tempo. Para a conta do lado do proprietário, veja [quanto custa georreferenciamento](/blog/quanto-custa-georreferenciamento/).

## E a segurança dos dados do escritório?

Os dados de cada escritório ficam isolados no banco: um escritório não vê o que é de outro. Isso importa porque memorial e planilha carregam CPF, matrícula e endereço, dados pessoais protegidos pela LGPD, que exige medidas de segurança técnicas e administrativas contra acesso não autorizado.

Dentro do escritório, as permissões e a auditoria fazem o resto: cada pessoa vê e faz só o que precisa, e fica registrado quem fez.

Se o seu escritório quer ver a fila, a equipe e a integração funcionando com dados de verdade, [agende uma demonstração](/#contato).
