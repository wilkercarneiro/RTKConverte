---
{
  "titulo": "Programa de georreferenciamento gratuito: o que existe e onde ele para",
  "seoTitulo": "Programa de georreferenciamento gratuito: o que existe | Vertces",
  "descricao": "Programa de georreferenciamento gratuito: o que QGIS, plugins e IBGE-PPP fazem, o que não fazem (ODS, memorial, peças, planta) e quando o pago compensa.",
  "slug": "programa-de-georreferenciamento-gratuito",
  "data": "2026-11-07",
  "atualizado": "2026-11-07",
  "categoria": "mercado",
  "palavraChave": "programa de georreferenciamento gratuito",
  "palavrasRelacionadas": ["software de georreferenciamento grátis", "qgis georreferenciamento sigef", "plugin qgis memorial descritivo", "ibge ppp gratuito", "programa grátis para gerar planilha sigef", "georreferenciamento sem software pago"],
  "resumo": "Existem ferramentas gratuitas que cobrem partes do georreferenciamento: o QGIS com plugins para desenho, análise e alguns memoriais, e o IBGE-PPP para pós-processar os dados GNSS em SIRGAS 2000. Não há, porém, um programa gratuito confirmado que vá do TXT do receptor à planilha ODS do SIGEF, às peças do cartório e à planta padronizada de ponta a ponta. O que falta vira trabalho manual, e é esse tempo que decide se o gratuito compensa.",
  "faq": [
    { "p": "O INCRA disponibiliza um programa para fazer o georreferenciamento?", "r": "O INCRA disponibiliza o SIGEF, onde a planilha é enviada e a certificação acontece, mas não um programa para processar o levantamento e montar as peças. A norma exige o resultado no padrão, não uma ferramenta específica." },
    { "p": "Dá para gerar a planilha ODS do SIGEF no LibreOffice?", "r": "Dá para editar uma planilha ODS no LibreOffice, que é gratuito. O trabalho de preencher vértice por vértice, com códigos, precisões, métodos e confrontantes, e de conferir a consistência fica por sua conta." },
    { "p": "O IBGE-PPP serve para todos os vértices do imóvel?", "r": "O IBGE-PPP pós-processa arquivos de observação GNSS em RINEX e devolve coordenadas em SIRGAS 2000. Se o método PPP atende a precisão exigida para cada tipo de limite depende do tempo de rastreio e do equipamento; confira no Manual Técnico do INCRA." },
    { "p": "Usar programa gratuito pode atrapalhar a certificação?", "r": "Não pela ferramenta em si. O SIGEF avalia os dados enviados. O risco está em erros de digitação e de consistência que uma montagem manual deixa passar, e que só aparecem depois do envio." },
    { "p": "Existe teste grátis do Vertces?", "r": "O Vertces é um sistema pago. O caminho é agendar uma demonstração, em que mostramos o sistema com um levantamento seu; o acesso é liberado depois dela, pelo link que a equipe envia." }
  ],
  "fontes": [
    { "titulo": "IBGE: Serviço online para pós-processamento de dados GNSS (IBGE-PPP)", "url": "https://www.ibge.gov.br/geociencias/informacoes-sobre-posicionamento-geodesico/servicos-para-posicionamento-geodesico/16334-servico-online-para-pos-processamento-de-dados-gnss-ibge-ppp.html" },
    { "titulo": "QGIS: software livre de SIG", "url": "https://qgis.org/" },
    { "titulo": "INCRA: Manual Técnico para Georreferenciamento de Imóveis Rurais, 2ª edição", "url": "https://www.gov.br/incra/pt-br/assuntos/governanca-fundiaria/Manual_Tecnico_de_Georreferenciamento_2_Edicao.pdf/@@display-file/file" },
    { "titulo": "INCRA: Certificação de Imóvel Rural", "url": "https://www.gov.br/incra/pt-br/assuntos/governanca-fundiaria/certificacao-imoveis" }
  ]
}
---

Existe programa de georreferenciamento gratuito para partes do trabalho, mas não para o processo inteiro. O QGIS, com plugins, resolve desenho, análise espacial e alguns memoriais; o IBGE-PPP pós-processa os dados GNSS de graça e devolve coordenadas em SIRGAS 2000. O que nenhuma ferramenta gratuita confirmada faz de ponta a ponta é ir do TXT do receptor à planilha ODS do SIGEF, às peças do cartório e à planta padronizada, e esse trecho vira trabalho manual.

Este guia mostra o que cada opção gratuita faz, onde ela para e como calcular se o gratuito sai barato no seu escritório.

## O que um programa de georreferenciamento precisa fazer?

Programa de georreferenciamento é a ferramenta que transforma o levantamento de campo nos arquivos e documentos que o INCRA e o cartório recebem. O INCRA não exige um programa específico: exige o resultado no padrão da NTGIR 3ª edição e do Manual Técnico (2ª ed., 2022).

O caminho de um serviço completo:

1. Processar os dados GNSS e obter as coordenadas de cada vértice com a precisão exigida.
2. Ler o arquivo do receptor e escolher a versão certa de cada ponto.
3. Conferir vértices, área, perímetro e confrontantes.
4. Montar a planilha ODS e enviar ao SIGEF.
5. Gerar memorial descritivo, memorial tabular e planta.
6. Depois da certificação, preparar as peças técnicas do cartório.

A pergunta útil não é “qual programa é grátis”, é “quantos desses passos ficam fora dele”.

## Quais opções gratuitas existem hoje?

As opções gratuitas que os escritórios usam se dividem em quatro grupos:

- **QGIS.** Software livre de SIG, distribuído sob a licença GNU GPL. Importa coordenadas, desenha polígonos, sobrepõe camadas, calcula áreas e monta layouts de planta.
- **Plugins do QGIS.** O repositório oficial de plugins tem ferramentas voltadas a topografia e georreferenciamento, como geradores de memorial descritivo. A cobertura, a manutenção e o formato de saída variam de plugin para plugin.
- **IBGE-PPP.** Serviço online gratuito do IBGE para pós-processamento de dados GNSS. Você envia o arquivo de observação em RINEX (ou Hatanaka), informa o modo (estático ou cinemático), a antena e a altura, e recebe as coordenadas em SIRGAS 2000.
- **RTK em rede do IBGE.** O Manual Técnico registra que o IBGE fornece gratuitamente correções via NTRIP, com uso restrito a locais próximos às estações da RBMC e dependente de sinal de celular no campo.

Somam-se ferramentas de uso geral, como o LibreOffice para editar planilhas ODS e os programas que acompanham o receptor GNSS.

## O que as ferramentas gratuitas não fazem?

As ferramentas gratuitas param onde o trabalho deixa de ser geometria e passa a ser documento no padrão do INCRA e do cartório. Os pontos que costumam ficar de fora:

- **Planilha ODS do SIGEF de ponta a ponta.** Não encontramos ferramenta gratuita confirmada que gere a planilha completa a partir do levantamento, com códigos de vértice, métodos, precisões e confrontantes, e que avise antes do envio o que o SIGEF vai recusar.
- **Leitura do TXT “como sai do campo”.** Cada receptor exporta de um jeito. No QGIS, você ajusta delimitador, colunas e versões de ponto à mão.
- **Peças do cartório.** Cartas de anuência por confrontante, declarações e requerimento ficam em modelos de editor de texto.
- **Planta padronizada.** O layout do QGIS faz planta, mas malha UTM, quadro analítico, carimbo e planta de situação precisam ser montados e mantidos pelo escritório.
- **Sobreposição com parcelas certificadas.** Dá para carregar a base do INCRA no QGIS, mas baixar, atualizar e conferir é manual.
- **Equipe e histórico.** Pasta compartilhada não registra quem alterou o quê nem guarda versões de cada documento.

## Quanto custa o gratuito, em tempo?

O custo do gratuito é o tempo do técnico. Uma forma honesta de medir é cronometrar um serviço típico e preencher a conta abaixo com os seus números:

| Etapa | Com ferramentas gratuitas | Com sistema que cobre a etapa |
|---|---|---|
| Ajustar o TXT do receptor | manual, formato a formato | leitura automática, com escolha das versões |
| Conferir área, perímetro e confrontantes | no QGIS, com cálculo à parte | na tela de conferência |
| Montar a planilha ODS | digitação e conferência manual | gerada, com avisos antes do download |
| Conferir sobreposição | baixar e sobrepor camadas | parcelas certificadas no mapa |
| Memorial, tabular e planta | plugin, layout e modelo de texto | gerados com o modelo do escritório |
| Peças do cartório | modelos em editor de texto | geradas a partir dos dados do serviço |
| Refazer após exigência | repetir os passos à mão | ajustar e gerar de novo |

Multiplique as horas pelo valor da sua hora e pelo número de serviços do mês. Uma ferramenta gratuita que exige horas de montagem por serviço pode sair mais cara que um plano pago. E o retrabalho pesa: um erro de digitação na planilha descoberto depois do envio custa uma volta inteira. O guia da [planilha ODS do SIGEF](/blog/planilha-ods-sigef-como-preencher/) mostra o que conferir em qualquer ferramenta.

## Quando o gratuito basta e quando um sistema pago compensa?

O gratuito basta quando o volume é baixo e o técnico domina o processo. Um sistema pago compensa quando o tempo de montagem e o retrabalho passam a custar mais que a assinatura.

O gratuito costuma bastar se:

- você faz poucos serviços por mês e trabalha sozinho;
- já tem modelos de memorial, peças e planta prontos e revisados;
- domina QGIS e sabe conferir a planilha linha a linha.

Um sistema pago costuma compensar se:

- o escritório tem equipe e precisa saber quem fez cada documento;
- o volume cresceu e a montagem manual virou gargalo;
- as exigências de cartório e as recusas no SIGEF estão consumindo dias;
- você também faz loteamento, CAR, desmembramento ou divisão entre herdeiros.

Para comparar as categorias pagas entre si, veja [como escolher o melhor software de georreferenciamento](/blog/melhor-software-de-georreferenciamento/).

## Como fazer no Vertces?

O Vertces é um sistema pago, web, com planos para autônomo, escritório e empresa. Ele não substitui o processamento GNSS: você continua usando o receptor e, se for o caso, o IBGE-PPP. O sistema entra a partir do arquivo exportado:

1. **Envie o arquivo do levantamento.** O Vertces lê o TXT ou CSV do receptor do jeito que sai do campo, com apoio de IA para formatos diferentes, e separa as versões do mesmo ponto (por exemplo, levantamento e pós-processado) para você escolher. Veja [como converter o TXT do GNSS para o SIGEF](/blog/txt-receptor-gnss-para-sigef/).
2. **Confira no mapa.** Vértices, área e perímetro no padrão do SIGEF, o confrontante de cada trecho e as parcelas já certificadas em volta, para ver a [sobreposição antes de protocolar](/blog/sobreposicao-sigef-como-evitar/). O crédito só é consumido quando você prossegue.
3. **Baixe os documentos.** Planilha ODS com prévia e avisos de consistência, memorial descritivo, memorial tabular, planta A1 ou A3 em PDF e, na matrícula, as 7 peças técnicas, com o logo e os modelos do escritório.

O protocolo no SIGEF continua sendo feito por você, e a certificação é do INCRA. Para ver o sistema com um levantamento seu, [agende uma demonstração](/#contato): o acesso é liberado depois dela, pelo link de cadastro que a equipe envia.
