---
{
  "titulo": "Como editar planta de georreferenciamento sem abrir o CAD",
  "seoTitulo": "Editar planta de georreferenciamento sem CAD | Vertces",
  "descricao": "Editar planta de georreferenciamento no PDF: mover rótulo, trocar texto e cor, apagar e acrescentar linha, com o traçado do terreno travado e versões salvas.",
  "slug": "editor-de-planta-georreferenciamento",
  "data": "2026-11-07",
  "atualizado": "2026-11-07",
  "categoria": "funcionalidades",
  "palavraChave": "editar planta de georreferenciamento",
  "palavrasRelacionadas": ["editar planta pdf topografia", "ajustar rótulo planta georreferenciamento", "planta georreferenciamento sem autocad", "corrigir texto planta sigef", "editor de planta online", "histórico de versões planta"],
  "resumo": "Editar planta de georreferenciamento é ajustar o que está na folha, como rótulos, textos, cores, quadros e anotações, sem mexer na geometria medida. No Vertces, o editor abre a planta PDF gerada pelo sistema, permite mover, trocar texto e cor, apagar e acrescentar texto, linha ou caixa, mantém o traçado do terreno travado e guarda a planta editada no histórico do serviço.",
  "faq": [
    { "p": "Consigo editar uma planta PDF feita em outro programa?", "r": "Não. O editor trabalha sobre a planta gerada pelo próprio Vertces, que leva dentro do PDF a descrição de cada objeto da folha. Um PDF de outra origem é só imagem e vetor solto, sem essa estrutura." },
    { "p": "Se eu fechar o navegador no meio da edição, perco o trabalho?", "r": "Não necessariamente. Enquanto a edição não vira PDF, ela fica guardada naquele navegador. Ao abrir a mesma planta, o sistema oferece retomar a edição ou começar da planta original." },
    { "p": "Posso tirar uma camada inteira do PDF, como a malha de coordenadas?", "r": "Pode. No painel de camadas, o ícone de olho esconde a camada do PDF final. O traçado do terreno é a exceção: ele não se esconde nem se seleciona." },
    { "p": "A planta editada substitui a original?", "r": "Não. A planta editada entra no histórico do serviço como mais uma versão, e a original continua lá. No próprio editor, Restaurar original volta ao que o sistema gerou." },
    { "p": "Uma planta antiga, gerada antes do editor, pode ser editada?", "r": "Só depois de gerada de novo. As plantas anteriores ao editor não têm a descrição dos objetos embutida, e o sistema avisa isso ao abrir." }
  ],
  "fontes": [
    { "titulo": "Decreto nº 4.449/2002, art. 9º (memorial assinado por profissional habilitado, com ART)", "url": "https://www.planalto.gov.br/ccivil_03/decreto/2002/d4449.htm" },
    { "titulo": "Lei nº 6.015/1973, art. 213, II (retificação com planta e memorial assinados)", "url": "https://www.planalto.gov.br/ccivil_03/leis/l6015compilada.htm" },
    { "titulo": "INCRA: Certificação de imóveis rurais", "url": "https://www.gov.br/incra/pt-br/assuntos/governanca-fundiaria/certificacao-imoveis" }
  ]
}
---

Para editar planta de georreferenciamento sem CAD, você precisa de um editor que mexa na folha (rótulos, textos, cores, quadros, anotações) e deixe a geometria medida intocada. No Vertces, a planta PDF gerada pelo sistema abre num editor no navegador: dá para mover, trocar texto e cor, apagar e acrescentar texto, linha ou caixa. O traçado do terreno fica travado, e a planta editada vai para o histórico do serviço como nova versão.

Editor de planta, aqui, é a ferramenta que trabalha sobre os objetos da folha pronta, e não sobre o levantamento. A diferença importa: um rótulo que cobre o nome do confrontante é problema de desenho; um vértice fora do lugar é problema de cálculo e se resolve na conferência, não no papel.

## Quando vale editar a planta em vez de gerar de novo?

Vale editar quando o problema é de apresentação e o conteúdo técnico está certo. Os casos mais comuns na véspera da entrega:

- o nome de um confrontante longo cai em cima da metragem de um lado;
- o rótulo da estrada fica sobre o código de um vértice;
- o cliente pede uma observação na folha ("divisa conforme acordo verbal com o vizinho", "ponto de referência: porteira");
- a rosa dos ventos ou o quadro de situação precisa de outro lugar para não cobrir o imóvel;
- uma cor não aparece bem na impressão do cartório.

Gerar de novo resolve quando o dado mudou: confrontante errado, área nova, vértice renomeado. Nesse caso, corrija no serviço e gere a planta outra vez, porque a mesma informação também está no memorial e na planilha. Para entender o que a folha deve conter, veja [o que vai na planta de georreferenciamento A1 e A3](/blog/planta-georreferenciamento-a1-a3/).

## O que pode e o que não pode mudar na planta?

Pode mudar tudo o que é apresentação. Não pode mudar a geometria do imóvel. A tabela resume:

| Na folha | Pode editar? | Observação |
|---|---|---|
| Nomes dos confrontantes, vias e rios | Sim | Mover, trocar texto, cor e tamanho |
| Rosa dos ventos, quadros, carimbo, legenda | Sim | Mover, ampliar, reduzir |
| Molduras, malha de coordenadas, rodapé | Sim | Também dá para esconder a camada |
| Textos e linhas novos | Sim | Ferramentas Texto, Linha e Caixa |
| Códigos dos vértices e metragens | Sim, com cuidado | São textos; trocar o texto não muda o cálculo |
| Traçado do terreno | Não | Aparece, mas não se seleciona, não se move, não se apaga |

O ponto de cuidado é a linha do meio. Códigos de vértice e metragens são textos na folha, então o editor deixa mexer neles, e isso ajuda quando o problema é só a posição. Já trocar o número escrito cria uma planta que discorda do memorial e da planilha. Se o código ou a medida estão errados, o lugar de corrigir é o serviço.

## Por que o traçado do terreno fica travado?

Porque o perímetro é o resultado do levantamento, não do desenho. As coordenadas dos vértices são as mesmas do memorial descritivo, da planilha do SIGEF e, depois da certificação, da planta e do memorial que o próprio SIGEF gera. Mover uma linha na folha faria a planta mostrar um imóvel diferente do que está descrito nos outros documentos.

A lei trata planta e memorial como peças de um mesmo trabalho técnico. O Decreto 4.449/2002, art. 9º, diz que a identificação do imóvel rural sai de memorial descritivo assinado por profissional habilitado, com ART, com as coordenadas dos vértices georreferenciadas ao Sistema Geodésico Brasileiro. Na retificação de área, a Lei 6.015/73, art. 213, II, pede planta e memorial assinados pelo profissional e pelos confrontantes. Uma planta com o contorno ajustado à mão quebra essa coerência e é o tipo de diferença que o cartório devolve.

Por isso o editor deixa o terreno visível, como referência para posicionar os rótulos, e trava qualquer seleção sobre ele. Ao passar o mouse, aparece o aviso "Traçado do terreno, não pode ser alterado".

## Como o editor organiza a folha?

O editor enxerga a planta em camadas e objetos, como um programa de desenho. Cada camada tem nome: molduras, malha de coordenadas, estradas, rios, divisões das confrontações, tiques e códigos dos vértices, metragem dos lados, nomes e números dos confrontantes, nomes das vias e rios, identificação do imóvel, identificação das glebas, rosa dos ventos, quadro analítico, planta de situação, carimbo, planimétrico, legenda, quadro de confrontantes e rodapé.

O manuseio segue o padrão dos editores de desenho:

- **clique** seleciona o objeto inteiro (o bloco do confrontante, a rosa, o quadro);
- **duplo clique** pega só a peça (uma linha de texto dentro do bloco);
- **arrastar** move; a alça do canto amplia ou reduz; a ponta da linha estica;
- **arrastar no vazio** seleciona por janela; **Shift + clique** soma à seleção;
- **setas** empurram 1 pt (com Shift, 10 pt);
- **Ctrl+D** duplica, **Ctrl+C / Ctrl+V** copia e cola, **Delete** apaga, **Ctrl+Z / Ctrl+Y** desfaz e refaz;
- **roda do mouse** aproxima; **espaço** ou botão do meio movem a vista.

Clicar no nome de uma camada seleciona a camada inteira. Útil, por exemplo, para trocar a cor de todos os nomes de confrontantes de uma vez.

## Como fazer no Vertces

O editor está em qualquer planta gerada pelo sistema: a do serviço completo, a da conferência de área, a das glebas e as do histórico.

1. **Abra a planta.** Ao gerar, ou pelo Histórico de documentos do serviço, a planta abre no visualizador, dentro do sistema.
2. **Clique em Editar planta.** A folha aparece com o painel de camadas à direita.
3. **Escolha a ferramenta:** Selecionar (V), Mão (H), Texto (T), Linha (L) ou Caixa (R). Para textos e traços novos, escolha antes a cor no painel.
4. **Ajuste.** Selecione o objeto, arraste, troque o texto e a cor no painel, use Para frente e Para trás quando um objeto cobre outro, Duplicar ou Apagar.
5. **Esconda o que não deve sair.** O olho ao lado de cada camada tira a camada do PDF final.
6. **Conclua.** Concluir e gerar PDF refaz o PDF no navegador. Se algo saiu errado, Restaurar original volta ao que o sistema gerou, e dá para desfazer.
7. **Salve no histórico.** No visualizador, Salvar no histórico guarda a planta editada como nova versão do serviço. Baixar PDF entrega o arquivo para impressão.

O desenho é feito com as mesmas fontes do PDF, então a largura do texto na tela é a que vai sair impressa. Um nome que cabe no editor cabe no papel.

## Como fica o controle de versões?

Cada planta, editada ou não, fica no Histórico de documentos do serviço, com número de versão. A editada aparece marcada como editada. Isso responde à pergunta que sempre volta depois da entrega: qual planta foi para o cartório, e o que mudou nela.

O histórico também protege contra o ajuste esquecido. Se você editar uma planta, gerar os documentos de novo depois de corrigir um confrontante e perceber que perdeu o reposicionamento dos rótulos, a versão editada anterior continua lá para comparar.

Dois cuidados práticos:

- **Edite por último.** Ajuste de folha é a etapa final. Qualquer correção de dado depois dela pede gerar de novo e, se preciso, editar outra vez.
- **Revise antes de assinar.** O Vertces gera e confere, mas quem assina é o responsável técnico. Uma última leitura da folha impressa contra o [memorial descritivo](/blog/memorial-descritivo-georreferenciamento/) evita a devolução por divergência.

Se a planta é de imóvel já certificado, a base é outra: o sistema monta a planta a partir do PDF do SIGEF, como explicado em [peças a partir do PDF do SIGEF](/blog/pecas-a-partir-do-pdf-sigef/). A edição funciona do mesmo jeito sobre o resultado.
