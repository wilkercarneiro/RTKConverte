# Concorrência: MapMetria (mapmetrica.com) × Vertces

Análise de 05/11/2026, a pedido do Wilker ("verifique o que ele tem que não temos e como podemos aplicar na nossa realidade"), feita navegando a conta do grupo no Edge (plano vencido, sem projetos salvos), em ritmo de uso normal, sem gastar crédito.

> **Termos de uso deles:** a cláusula 10 proíbe "reprodução, cópia ou engenharia reversa sem autorização prévia" e diz que funcionalidades e design são deles. Por isso este documento registra só **ideias de função**. Telas, textos, nomes e código do Vertces continuam próprios.

## O produto

Os módulos são: imóvel rural (memorial SIGEF), imóvel urbano (com edificação e recuos), CAR, análise de terreno, loteamento, dossiê do imóvel e terraplanagem, além de uma ferramenta solta de divisão de área, um GPS de campo no celular e a academia de vídeos.

- **Cobrança:** edita tudo de graça e paga só ao finalizar (1 crédito por projeto sem plano).
- **Preços:** mensal a R$ 149; anual em 12× de R$ 72,29 no cartão ou R$ 699 à vista; empresarial sob consulta.
- **Fluxo rural:** 5 etapas, cerca de 8 cliques até finalizar.
- **Divisão:** 5 cliques, com memorial e KML por parte.

## Onde o Vertces já está na frente

- Leitura de qualquer arquivo de pontos, com IA.
- Conferência do TXT com ajuste de pontos.
- Confrontantes certificados pelo Geoportal do INCRA. Eles perderam o acesso ao SIGEF e usam declarações do CAR.
- Planta A1.
- Sete peças técnicas e declaração de faixa de domínio.
- GEO completo por parte da divisão.
- Loteamento com gerador, prancheta, 3D, redes, memoriais, DXF e locação.
- CAR com reserva legal e APP calculadas. No deles, tudo é desenhado à mão.
- Equipe com permissões e multiempresa.
- Integração com o GPROL.
- **Motor de área único.** Lá, o mesmo KML deu 22,5 ha na divisão e 5,47 ha no CAR.

## O que eles têm e como ficou no Vertces

| Ideia | No Vertces (05/11/2026) |
|---|---|
| Arquivos da área em CAD/SIG no serviço (DXF em camadas, .prj, KML) | **Feito:** "Exportar" em todos os serviços. KML, KMZ, DXF em camadas, pacote CAD (.zip com DXF, .prj e LEIAME), GPX, SHP, GeoJSON, CSV e TXT para a coletora. |
| Divisão por área definida + remanescente, destacar por um lado, linha de corte | **Feito:** desmembramento na etapa Divisão. Remanescente e desmembradas, área digitada, lado escolhido, divisa desenhada à mão e documentos de cada área (memorial, tabular, planta, planilha). |
| Recuo de rodovia (eles têm só a largura do desenho) | **Feito, à frente deles:** faixa de domínio (BR pelo DNIT, BA pela SEINFRA), não edificável pela Lei 6.766 e alerta de invasão da faixa (DNIT). Ver `docs/recuo-rodovias.md`. |
| Mapa: no editor rural ocupa ~42% da tela e não tem tela cheia | **Feito:** telas de trabalho sem mapa achatado e botão de tela cheia em todos os mapas de trabalho (loteamento, divisão, CAR, SIGEF, glebas, leitura do arquivo, seleção na planta); a maquete 3D já abre na tela toda. |
| Plano anual parcelado em 12× | **Feito:** autocadastro com plano e período (mensal, semestral, anual), Pix ou cartão. Até 6× sem juros, até 12× no máximo. |
| Monografia do marco (PDF/DOCX) | Próximo: nova peça técnica, em lote para os marcos M. |
| Prévia da planilha SIGEF + avisos de consistência antes de baixar | Próximo: modal com a tabela e alertas (todos M, σ igual, método ausente). |
| Curvas de nível e 3D do terreno no serviço GEO | Próximo: reaproveitar o relevo e a maquete do loteamento. |
| Análise de restrições (IBAMA, TI, UC, assentamentos) e dossiê com prévia grátis | Próximo (maior): camadas públicas no mapa interativo e uma prévia como isca comercial. |
| Assinatura do RT nos documentos; QR de autenticidade na planta | Próximo (pequeno). |
| Renomear vértices em lote; inserir ponto entre vértices | Próximo (pequeno). |
| Academia com progresso; perguntas sugeridas no chat | Próximo (pequeno). |
| Ortomosaico de drone como fundo | Avaliar depois (arquivos grandes). |

## O que não copiar

- Mapa pequeno que rouba a rolagem da página.
- Barra de desenho genérica em inglês.
- Etapa de passagem que só gasta um clique.
- Avançar etapa sem os dados obrigatórios.
- Recuos só declarativos.
- Chamar DXF de "DWG".
- Dossiê que dispara sozinho (para o que custa crédito, confirmar antes).
- Sobreposição checada contra declarações do CAR.
- Motores de área diferentes por módulo.
- IA só no plano caro: no Vertces ela é parte da leitura do arquivo.
