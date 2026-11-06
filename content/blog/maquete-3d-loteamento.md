---
{
  "titulo": "Maquete 3D de loteamento no navegador: relevo real, sol, drone e vídeo",
  "seoTitulo": "Maquete 3D de loteamento no navegador | Vertces",
  "descricao": "Maquete 3D de loteamento gerada do projeto: relevo real, ruas, casas, sol por hora, declividade, corte e aterro, voo de drone, vídeo MP4 e modelo GLB.",
  "slug": "maquete-3d-loteamento",
  "data": "2026-11-06",
  "atualizado": "2026-11-06",
  "categoria": "funcionalidades",
  "palavraChave": "maquete 3d de loteamento",
  "palavrasRelacionadas": ["maquete virtual loteamento", "apresentação 3d de loteamento", "vídeo de drone loteamento", "declividade dos lotes", "corte e aterro de ruas", "modelo glb loteamento"],
  "resumo": "Maquete 3D de loteamento é a representação tridimensional do projeto sobre o relevo do terreno, com ruas, lotes, casas e áreas verdes. No Vertces ela sai do próprio projeto, no navegador, em segundos: mostra a declividade de cada lote, o corte e aterro das ruas, o sol por hora, e exporta foto, vídeo e modelo GLB.",
  "faq": [
    { "p": "Preciso de placa de vídeo dedicada para abrir a maquete?", "r": "Não necessariamente. A maquete roda no navegador com WebGL e reduz a resolução sozinha durante o movimento quando o computador não dá conta. Em celular e tablet ela carrega texturas mais leves." },
    { "p": "A maquete serve como projeto de terraplenagem?", "r": "Não. O corte e aterro mostrado é uma estimativa de estudo, feita sobre um modelo digital de elevação calibrado pelas cotas do levantamento. Não substitui o projeto geométrico das vias nem a terraplenagem executiva." },
    { "p": "Dá para abrir a maquete no SketchUp ou no Lumion?", "r": "Sim. O modelo GLB exportado vem em escala real, com terreno, casas, meio-fio e árvores, e abre em SketchUp, Blender, Twinmotion ou Lumion." },
    { "p": "Se eu mudar um lote, preciso refazer a maquete?", "r": "Não. A maquete é montada a partir do projeto atual. Mudou a rua ou o lote na prancheta, ao abrir o 3D de novo ela já mostra o desenho novo." },
    { "p": "O vídeo de apresentação tem narração?", "r": "Não. O vídeo tem cerca de 70 segundos, com trilha sonora gerada no navegador, legendas com os números reais do projeto e cartelas. A narração, se quiser, você acrescenta depois." }
  ],
  "fontes": [
    { "titulo": "Lei nº 6.766/1979, art. 3º (vedação de parcelamento com declividade de 30% ou mais)", "url": "https://www.planalto.gov.br/ccivil_03/leis/l6766.htm" },
    { "titulo": "Lei nº 12.651/2012 (Código Florestal), art. 4º (áreas de preservação permanente)", "url": "https://www.planalto.gov.br/ccivil_03/_ato2011-2014/2012/lei/l12651.htm" }
  ]
}
---

Maquete 3D de loteamento é a representação tridimensional do projeto sobre o relevo real do terreno: ruas, lotes, casas, áreas verdes e o entorno. Ela serve para duas coisas diferentes, e as duas importam. Para o projetista, mostra declividade, corte e aterro e onde a rua briga com o terreno. Para o loteador e o comprador, mostra o empreendimento como ele vai ficar, antes da primeira máquina entrar.

No Vertces a maquete sai do próprio projeto de loteamento, no navegador, sem exportar para outro programa. O que leva dias numa cadeia de CAD, modelagem e renderização fica a um clique na prancheta.

## Para que serve uma maquete 3D de loteamento?

Ela serve para decidir e para vender. Na fase de projeto, o 3D revela o que a planta esconde: o lote que cai num grotão, a rua que exige corte alto, a área verde que ficou no ponto mais seco. Na fase comercial, substitui a maquete física e o render terceirizado por imagens e vídeo feitos com os números reais do projeto.

Os usos mais comuns:

- conferir declividade dos lotes antes de protocolar na prefeitura;
- estimar volumes de corte e aterro das ruas para comparar traçados;
- apresentar ao investidor ou ao proprietário da gleba;
- gerar material para o lançamento (foto, vídeo, modelo para o render final).

## O que aparece na maquete do Vertces?

Aparece o projeto inteiro assentado no relevo. O terreno é um bloco com as camadas do solo na lateral, como numa maquete física, com a imagem de satélite em volta. Por cima:

- pista com faixa, calçada e meio-fio;
- lotes numerados e rótulos das quadras;
- casas de uma simulação de ocupação, com recuo de 4 m, telhado de duas ou quatro águas e um ou dois pavimentos, assentadas no ponto alto do lote;
- prédio na área institucional;
- árvores nas áreas verdes, mata na APP (a área de preservação permanente da Lei 12.651/2012, que fica fora dos lotes), árvores de calçada e de quintal;
- muros, gradis, portões, carros, postes e fiação.

A abertura faz a transição: o terreno de hoje, no satélite, vira o projeto. As ruas são escavadas, as casas sobem a partir do centro e as árvores crescem. O botão Hoje / Projeto repete a cena.

Quando o loteamento tem os projetos de infraestrutura gerados, a maquete mostra postes do projeto elétrico, fios de média e baixa tensão, hidrantes, tampas de poço de visita, bocas de lobo, o reservatório e a estação de tratamento ou elevatória. O modo Infraestrutura pinta as redes enterradas no chão, como raio-x.

## Como ler declividade, corte e aterro no 3D?

A maquete tem quatro modos de leitura técnica, além do modo Projeto.

| Modo | O que mostra | Para que usar |
|---|---|---|
| Declividade | Faixas de 0 a 8%, 8 a 15%, 15 a 30% e 30% ou mais, com o percentual da área dos lotes em cada faixa | Ver se há lote acima do limite de 30% do art. 3º da Lei 6.766 |
| Corte e aterro | Volumes das ruas em m³, com talude de 1:1,5 até o terreno natural | Comparar traçados de ruas |
| Curvas de nível | Curvas com intervalo pelo desnível da gleba, mestras a cada 5 | Ler o relevo sem a imagem |
| Infraestrutura | Redes de água, esgoto, drenagem e energia no chão | Conferir o traçado das redes |

A faixa de 30% não é escolha estética. O art. 3º, parágrafo único, III, da Lei 6.766/1979 proíbe parcelar terreno com declividade igual ou superior a 30%, salvo se atendidas exigências específicas das autoridades competentes. Ver isso no 3D, lote a lote, antes de protocolar, evita refazer o projeto depois. As regras do projeto em si estão em [software para projeto de loteamento e a Lei 6.766](/blog/software-loteamento-lei-6766/).

Um clique no lote abre a ficha: área, frente, fundo, cotas, desnível, declividade média com a faixa, confrontações e valor estimado, se houver preço por m² no projeto.

O relevo vem de um modelo digital de elevação público, calibrado pelas cotas do levantamento e guardado no projeto. O greide das ruas é uma suavização do terreno ao longo da via. Por isso os volumes são estimativa de estudo, não terraplenagem executiva.

## Como fazer no Vertces

1. **Abra o loteamento** e vá à prancheta. O projeto pode ter vindo do gerador de três propostas ou de um DXF, KML ou GeoJSON importado.
2. **Clique em 3D** na barra da prancheta, ou no cartão do topo das Entregas. A parte 3D só é baixada quando você abre a maquete.
3. **Navegue.** Arrastar gira; botão direito, do meio ou Shift + arrastar agarra o chão; a roda aproxima no ponto do cursor. Vista geral, de cima (norte para cima) e bússola ficam no painel.
4. **Ajuste a cena.** Exagero vertical até 3x (as cores e as medidas continuam na cota real), hora do sol com posição real pela latitude e data, e camadas de casas, árvores, meio-fio e sombras.
5. **Troque o modo** para Declividade, Corte e aterro, Curvas de nível ou Infraestrutura.
6. **Rode o voo de drone.** O roteiro é montado do projeto: vista alta, descida pela rua de entrada, órbita na maior área verde, passagem pela área institucional e subida final, com legendas com os números reais (lotes, ruas, áreas).
7. **Use o Apresentar.** Tela limpa, o terreno de hoje vira o projeto, o sol anda da manhã ao anoitecer e as janelas e postes acendem no fim. Esc sai.
8. **Exporte** o que precisar (próxima seção).

## O que dá para entregar ao cliente?

São três saídas, todas geradas no navegador:

- **Foto em alta**, em PNG, com o dobro da resolução da tela.
- **Vídeo de apresentação** de cerca de 70 segundos, com trilha sonora, faixas de cinema, legendas e cartelas. Sai em MP4 no Chrome e no Edge; nos outros navegadores, em WebM.
- **Modelo GLB** em escala real, sem o exagero vertical da tela, com terreno, casas, meio-fio e árvores, para SketchUp, Blender, Twinmotion ou Lumion. Quem quiser um render final com materiais próprios parte desse modelo.

As casas são uma simulação de ocupação, não o projeto arquitetônico de cada lote. Vale dizer isso no material de venda.

## Onde a maquete não substitui outro estudo?

A maquete é uma ferramenta de estudo e apresentação. Ela não substitui:

- o projeto geométrico das vias com greide definido;
- a terraplenagem executiva;
- levantamento planialtimétrico cadastral de detalhe, quando a prefeitura pedir;
- os projetos de redes aprovados pelas concessionárias.

O relevo de base tem a resolução do modelo de elevação público, ajustado às cotas do seu TXT. Para decisão de obra, use o levantamento de campo. Se o loteamento ainda está no começo, comece pelo perímetro georreferenciado; veja [o que é georreferenciamento](/blog/georreferenciamento-o-que-e/) e, para levar a área a outros programas, [exportar em KML, DXF e shapefile](/blog/exportar-kml-dxf-shapefile-gpx/).

## Quanto tempo leva para ter a maquete?

Segundos, depois que o projeto existe. A maquete é calculada a partir do projeto atual, por isso não há etapa de modelagem: mudou uma rua ou um lote na prancheta, ao abrir o 3D de novo o desenho já é o novo. O tempo de verdade está no projeto do loteamento, não na maquete. Para ver com um projeto seu, [agende uma demonstração](/#contato) ou veja a seção de [loteamento](/#loteamento).
