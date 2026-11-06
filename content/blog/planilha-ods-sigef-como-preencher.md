---
{
  "titulo": "Planilha ODS do SIGEF: como preencher sem rejeição",
  "seoTitulo": "Planilha ODS do SIGEF: como preencher sem rejeição | Vertces",
  "descricao": "Planilha ODS do SIGEF: como ela é organizada, que dados reunir antes, como preencher vértices, precisões e limites e os erros que travam a submissão.",
  "slug": "planilha-ods-sigef-como-preencher",
  "data": "2026-11-06",
  "atualizado": "2026-11-06",
  "categoria": "guias-tecnicos",
  "palavraChave": "planilha ods sigef",
  "palavrasRelacionadas": ["como preencher planilha sigef", "erro planilha sigef", "planilha eletrônica sigef", "aba de perímetro sigef", "submissão sigef", "planilha ods incra"],
  "resumo": "A planilha ODS do SIGEF é a planilha eletrônica de dados georreferenciados que o credenciado envia ao INCRA para certificar o imóvel rural. Ela reúne a identificação do imóvel, do detentor e do registro e, em abas de perímetro, os vértices com coordenadas, precisões e método de posicionamento, os tipos de limite e as confrontações. O SIGEF valida a consistência, confere a sobreposição e, se não houver erro, gera a planta e o memorial certificados.",
  "faq": [
    { "p": "Posso usar uma planilha ODS antiga que já tenho no computador?", "r": "Não é recomendável. O modelo é do INCRA e pode mudar; baixe sempre a versão atual no portal do SIGEF antes de preencher, para não ser barrado na validação." },
    { "p": "Um imóvel com mais de uma parcela vai em uma planilha só?", "r": "Pode ir. O Manual para Gestão da Certificação trata de planilha multiabas, com mais de um perímetro na mesma submissão, como no desmembramento com as parcelas desmembradas e o remanescente." },
    { "p": "A precisão do vértice entra em metros ou em segundos?", "r": "Em metros. O Manual Técnico do INCRA (item 1.4.5) manda converter as precisões da latitude e da longitude para valores lineares." },
    { "p": "O que acontece se o SIGEF achar sobreposição na planilha?", "r": "O sistema aponta a inconsistência e a parcela não é certificada. Você corrige os dados e reenvia. Se a sobreposição for com polígono que não entrou pelo SIGEF, como uma certificação do SNCI, existe o requerimento de análise de sobreposição." },
    { "p": "A planilha ODS também é exigida no cancelamento de certificação?", "r": "Na maioria dos casos, sim. Desde a atualização divulgada pelo INCRA em 06/07/2026, o pedido de cancelamento exige a planilha vinculada ao campo nova certificação, e o sistema impede o protocolo sem ela quando é obrigatória." }
  ],
  "fontes": [
    { "titulo": "INCRA: Manual para Gestão da Certificação, 2ª edição", "url": "https://www.gov.br/incra/pt-br/assuntos/governanca-fundiaria/manualgestaocertificacao2edicao2023.pdf/@@display-file/file" },
    { "titulo": "INCRA: Manual Técnico para Georreferenciamento de Imóveis Rurais, 2ª edição", "url": "https://www.gov.br/incra/pt-br/assuntos/governanca-fundiaria/Manual_Tecnico_de_Georreferenciamento_2_Edicao.pdf/@@display-file/file" },
    { "titulo": "INCRA: Certificação de Imóvel Rural", "url": "https://www.gov.br/incra/pt-br/assuntos/governanca-fundiaria/certificacao-imoveis" },
    { "titulo": "INCRA: Atualização do Sigef automatiza cancelamento de certificações (06/07/2026)", "url": "https://www.gov.br/incra/pt-br/assuntos/noticias/atualizacao-do-sigef-automatiza-cancelamento-de-certificacoes-e-altera-fluxo-de-requerimentos" }
  ]
}
---

A planilha ODS do SIGEF é a planilha eletrônica de dados georreferenciados que o credenciado envia ao INCRA para certificar um imóvel rural. Ela traz a identificação do imóvel, do detentor e do registro e, em uma ou mais abas de perímetro, os vértices com coordenadas, precisões e método de posicionamento, os tipos de limite e as confrontações. Preencher sem rejeição é questão de reunir os dados certos antes e não transcrever nada à mão.

## O que é a planilha ODS do SIGEF?

É o arquivo que alimenta a certificação. O ODS é o formato de planilha aberto (OpenDocument), e o modelo é fornecido pelo INCRA no portal do SIGEF. Segundo o Manual para Gestão da Certificação (2ª edição), as peças técnicas certificadas, planta e memorial descritivo, são geradas automaticamente com base nesse arquivo digital, que contém as informações dos vértices, dos limites, das confrontações, a identificação do imóvel no registro de imóveis, o código do imóvel no SNCR e a identificação do proprietário.

Isso tem uma consequência direta: o que você escreve na planilha é o que sai na planta e no memorial certificados. Um erro de digitação ali vira erro em documento oficial.

Antes de começar, baixe o modelo atual no portal do SIGEF. Planilha guardada de um serviço antigo pode estar desatualizada.

## Como a planilha é organizada?

A planilha separa a parte descritiva da parte geoespacial. Há a identificação, com os atributos textuais do serviço, do detentor e do imóvel, e as abas de perímetro, com os vértices e os limites.

Quando o serviço tem mais de uma parcela, cada perímetro ganha a sua aba. O Manual para Gestão da Certificação chama esse caso de planilha multiabas: no desmembramento, por exemplo, a planilha pode conter todos os polígonos desmembrados e o remanescente. As parcelas enviadas na mesma submissão e na mesma planilha ficam vinculadas, e uma retificação de atributo comum pode ser aplicada a todas de uma vez.

O número de abas também pesa em outros fluxos. Na automação do cancelamento de certificação divulgada pelo INCRA em julho de 2026, um dos critérios de deferimento automático é a planilha associada ao pedido ter apenas uma aba de perímetro. Detalhes em [o que mudou no cancelamento automático do SIGEF](/blog/atualizacao-sigef-2026-cancelamento-automatico/).

## Quais dados você precisa ter antes de abrir a planilha?

Você precisa de tudo o que a planilha pede, já conferido. O Manual para Gestão da Certificação lista os atributos que podem ser retificados numa parcela, e essa lista é um bom roteiro do que a planilha guarda:

| Grupo | O que reunir | Onde conferir |
|---|---|---|
| Área georreferenciada | Denominação, código do imóvel no SNCR, documento de responsabilidade técnica, município, situação | CCIR, ART, contrato |
| Detentor | Nome ou razão social e CPF ou CNPJ | Documento do proprietário, certidão |
| Registro | Código do cartório (CNS) e matrícula ou transcrição | Certidão da matrícula |
| Vértices | Código, coordenadas, sigmas e método de posicionamento | Relatório de processamento do levantamento |
| Limites | Tipo de limite e confrontações (CNS, matrícula e descrição do confrontante) | Campo, matrículas vizinhas, SIGEF |
| Título | Órgão emissor e número do título, quando houver | Título de domínio |

Os nomes exatos de cada campo estão no modelo e no manual do SIGEF. Siga o modelo que você baixou, célula por célula.

## Como preencher os vértices e os limites sem erro?

Preencha com os valores do processamento, sem arredondar e sem redigitar. A parte de perímetro é onde a planilha mais volta. Quatro regras do Manual Técnico (2ª edição) ajudam:

1. **Código do vértice.** Quatro caracteres do código do credenciado, a letra do tipo e a sequência numérica (item 1.3.3). AAAA-M-1 e AAAA-M-0001 são vértices diferentes. Não repita número no mesmo tipo e no mesmo credenciado. Veja [tipos de vértice M, P e V](/blog/tipos-de-vertice-m-p-v-sigef/).
2. **Precisões em metros.** As precisões da latitude e da longitude são convertidas em valores lineares (item 1.4.5). A precisão posicional é a resultante planimétrica dos dois desvios.
3. **Padrão por tipo de limite.** O item 1.4.4 exige precisão melhor ou igual a 0,50 m em limites artificiais, 3,00 m em limites naturais e 7,50 m em limites inacessíveis. Um vértice de cerca com σ acima de 0,50 m fica fora do padrão. Mais em [precisão posicional no georreferenciamento](/blog/precisao-posicional-georreferenciamento/).
4. **Vértice do vizinho certificado.** Na divisa com imóvel certificado, o manual manda adotar as mesmas coordenadas e a mesma codificação do lindeiro quando há concordância. Inventar vértice novo nesse limite gera sobreposição ou fresta.

Nas confrontações, o confrontante de cada trecho precisa estar no limite certo. Se o nome do vizinho muda num marco, o limite seguinte começa nele.

## O que o SIGEF faz quando recebe a planilha?

Ele valida a consistência dos dados, confere a sobreposição e, se estiver tudo certo, certifica. A página de certificação do INCRA resume: se houver inconsistências ou sobreposições, o sistema avisa o interessado, que corrige os dados e reenvia; se não houver, a planta e o memorial são gerados automaticamente.

Há um caso especial. Se a sobreposição for com polígono que está na base do INCRA mas não entrou pelo SIGEF, como uma certificação antiga do SNCI, e a planilha não tiver nenhum outro erro, aparece na página de submissão a opção de requerer análise de sobreposição (capítulo 8 do Manual para Gestão da Certificação). Esse requerimento só fica disponível depois do envio e da validação de uma planilha ODS.

## Quais erros mais travam a planilha?

Os erros que mais travam são de transcrição, não de levantamento:

1. Precisão acima do padrão do tipo de limite, como um vértice de cerca (limite artificial) com σ maior que 0,50 m.
2. Código de vértice repetido ou com número de dígitos diferente do que já foi usado.
3. Coordenada colada com vírgula e ponto trocados, ou em formato diferente do que o modelo pede.
4. Ordem dos vértices invertida, com o confrontante descolado do trecho.
5. Vértice da divisa com o vizinho certificado medido de novo em vez de adotado, criando sobreposição. Veja [como evitar sobreposição no SIGEF](/blog/sobreposicao-sigef-como-evitar/).
6. Matrícula, CNS ou SNCR diferentes dos documentos do imóvel.

O roteiro manual mais comum, coordenada do relatório para o Excel, do Excel para o modelo, ajuste de formato e envio, é onde esses erros nascem. Cada cópia é uma chance de trocar uma linha.

## Onde um sistema ajuda?

Ajuda a eliminar a cópia. No Vertces, a planilha SIGEF (ODS) sai das mesmas coordenadas que geram o memorial e a planta, a partir do TXT do receptor GNSS:

1. Envie o arquivo do levantamento e confira a leitura (colunas, versão dos pontos, σ). Veja [como converter o TXT do GNSS para o SIGEF](/blog/txt-receptor-gnss-para-sigef/).
2. Confira no mapa a sequência dos vértices e o confrontante de cada trecho, com as parcelas certificadas em volta.
3. Gere a planilha. Antes de baixar, o sistema mostra uma prévia e avisos de consistência pelas regras da NTGIR 3ª edição, como a precisão de 0,50 m em limite artificial.
4. Baixe o ODS e envie ao SIGEF pelo seu acesso de credenciado.

O envio ao SIGEF continua sendo seu: o Vertces não protocola no sistema do INCRA. Ele confere e avisa antes. Quem valida e certifica é o INCRA.
