# Política de Privacidade do Vértice

> **MINUTA — PENDENTE DE REVISÃO JURÍDICA.** Este texto foi redigido a partir do que o sistema faz hoje (código e infraestrutura) e ainda não foi revisado por advogado. Os trechos entre colchetes são dados que só o titular do negócio pode informar e não devem ser publicados em branco. Versão da minuta: 2026-10-08.

## 1. Quem somos

O Vértice é um sistema on-line para escritórios de topografia e georreferenciamento: transforma o arquivo do levantamento (TXT do receptor RTK) em memorial descritivo, planilha SIGEF, planta e peças técnicas.

O Vértice é oferecido por **[RAZÃO SOCIAL]**, inscrita no CNPJ sob o nº **[CNPJ]**, com sede em **[ENDEREÇO COMPLETO]** ("nós").

Encarregado pelo tratamento de dados pessoais (art. 41 da LGPD): **[NOME DO ENCARREGADO]**, pelo e-mail **[E-MAIL DO ENCARREGADO]**.

## 2. Papéis: quem decide sobre os dados

- **O escritório que assina o Vértice é o controlador** dos dados dos clientes dele, dos proprietários e dos confrontantes dos imóveis que ele cadastra. É o escritório que decide por que e para que esses dados são coletados (o serviço de georreferenciamento contratado pelo cliente dele).
- **Nós somos operador** desses dados: tratamos em nome do escritório, só para prestar o serviço do sistema, conforme o contrato e as instruções do escritório.
- **Nós somos controlador** apenas dos dados da conta de acesso (nome, e-mail e senha de quem usa o sistema) e dos registros técnicos de uso.

## 3. Que dados o sistema guarda

**Da conta de acesso:** e-mail, senha (guardada cifrada pelo provedor de autenticação, nunca em texto), nome do escritório, data de aceite destes termos e registros de acesso.

**Cadastrados pelo escritório, para gerar os documentos do imóvel:**

- detentor/proprietário e eventual segundo requerente: nome, CPF ou CNPJ, RG, gênero (para a concordância do texto), endereço, telefone e e-mail;
- em caso de espólio: nome, CPF e RG do inventariante;
- confrontantes: nome e identificação do imóvel vizinho (matrícula, CNS, código SIGEF), como constam nas cartas de anuência;
- responsáveis técnicos: nome, CPF, formação, registro no conselho (CREA/CFT), TRT/ART;
- dados do imóvel: denominação, matrícula, município, coordenadas do levantamento e documentos gerados (memorial, planilha, planta, peças).

O sistema não pede dados sensíveis (art. 5º, II, da LGPD) e não deve ser usado para guardá-los.

## 4. Para que usamos e com qual base legal

| Finalidade | Dados | Base legal (LGPD) |
|---|---|---|
| Criar e manter a conta, autenticar o acesso | e-mail, senha, nome do escritório | execução de contrato (art. 7º, V) |
| Gerar os documentos do georreferenciamento pedido pelo escritório | dados do detentor, inventariante, confrontantes, RT e do imóvel | do escritório controlador: execução do contrato com o cliente dele (art. 7º, V) e cumprimento de obrigação legal/regulatória ligada à certificação do imóvel — Lei 10.267/2001 e normas do INCRA (art. 7º, II) **[CONFIRMAR COM O JURÍDICO]** |
| Segurança, prevenção a fraude e diagnóstico de erros | registros técnicos de acesso | legítimo interesse (art. 7º, IX) |
| Cobrança da assinatura | dados de faturamento do escritório | execução de contrato (art. 7º, V) |

Não vendemos dados, não usamos os dados cadastrados pelo escritório para publicidade e não os cruzamos entre escritórios.

## 5. Com quem os dados são compartilhados

Só com os fornecedores necessários para o sistema funcionar, cada um recebendo apenas o que precisa:

| Fornecedor | O que faz | Que dados recebe | Onde |
|---|---|---|---|
| Supabase Inc. | banco de dados, autenticação, armazenamento dos arquivos e execução das funções do servidor | todos os dados acima | servidores na região de São Paulo (AWS sa-east-1) |
| Vercel Inc. | hospedagem das páginas do sistema | endereço IP e dados técnicos de navegação; não guarda os cadastros | Estados Unidos e rede global |
| Mapbox Inc. | imagem de satélite da planta | apenas as coordenadas do perímetro do imóvel (sem nome, CPF ou qualquer dado pessoal) | Estados Unidos |
| INCRA — Acervo Fundiário (serviço público) | consulta das parcelas certificadas vizinhas, para checar sobreposição | apenas a área de busca em coordenadas | Brasil |
| **[GATEWAY DE PAGAMENTO — quando contratado]** | cobrança da assinatura | dados de faturamento do escritório | **[A DEFINIR]** |
| **[PROVEDOR DE E-MAIL — quando contratado]** | e-mails do sistema (confirmação de cadastro, troca de senha) | e-mail do usuário | **[A DEFINIR]** |

Na versão atual o Vértice **não envia dados a serviços de inteligência artificial** (como OpenAI). Se isso mudar, esta política será atualizada antes.

Transferência internacional (art. 33 da LGPD): os envios a Vercel e Mapbox se apoiam nas cláusulas contratuais desses fornecedores **[CONFIRMAR O MECANISMO COM O JURÍDICO]**.

Também podemos fornecer dados quando houver ordem judicial ou requisição de autoridade competente.

## 6. Isolamento entre escritórios

Cada escritório só enxerga os próprios clientes, serviços, cadastros e documentos. O isolamento é aplicado no próprio banco de dados (regras de acesso por escritório), e não apenas na tela.

## 7. Por quanto tempo guardamos e como excluímos

- **Enquanto a assinatura estiver ativa**, os dados ficam guardados para que o escritório possa regerar e consultar documentos. O escritório pode excluir clientes e serviços a qualquer momento.
- **Após o cancelamento**, o escritório tem **[30] dias** para exportar seus documentos. Depois disso, os dados do escritório são excluídos em até **[60] dias**, salvo o que a lei obrigue a guardar (por exemplo, dados fiscais da cobrança, pelo prazo legal).
- **Cópias de segurança** são sobrescritas em até **[30] dias**; dado excluído pode permanecer nelas até lá, sem uso.
- Registros técnicos de acesso: **[6 meses]** (Marco Civil da Internet, art. 15).

> Prazos entre colchetes são proposta e precisam ser confirmados pelo titular do negócio e pelo jurídico antes de publicar.

## 8. Direitos do titular

O titular pode pedir confirmação de tratamento, acesso, correção, anonimização, portabilidade, eliminação, informação sobre compartilhamento e revogação de consentimento (art. 18 da LGPD).

- **Se o seu dado foi cadastrado por um escritório** (você é cliente, proprietário ou confrontante de um imóvel), o pedido deve ser feito **ao escritório**, que é o controlador. Se você nos procurar, encaminhamos ao escritório e o apoiamos na resposta.
- **Dados da sua conta de acesso**: peça pelo e-mail **[E-MAIL DO ENCARREGADO]**. Respondemos em até **[15] dias**.

## 9. Segurança

Conexão sempre cifrada (HTTPS), arquivos em armazenamento privado (acesso apenas por link temporário), senhas cifradas pelo provedor de autenticação e regras de acesso por escritório no banco. Em caso de incidente de segurança com risco relevante, comunicamos os escritórios afetados e a ANPD nos termos da lei.

## 10. Cookies

O sistema usa apenas o armazenamento local do navegador necessário para manter a sessão de login. Não usamos cookies de publicidade nem de rastreamento.

## 11. Mudanças nesta política

Avisaremos os escritórios por e-mail e no sistema antes de mudanças relevantes. A versão em vigor fica sempre publicada nesta página.

Atualizada em: **[DATA DA PUBLICAÇÃO]**.
