# Serviço de CAR

O CAR transforma a área total do imóvel nas camadas que o SICAR recebe: área do imóvel, reserva legal, vegetação nativa, área produtiva e APP. Cada camada sai como shapefile (SHP, SHX, DBF e PRJ) em SIRGAS 2000, em grau.

Tudo roda no navegador (`src/lib/car`, `src/components/car`). O projeto fica gravado em `car_projetos.projeto` (jsonb).

## Entrada

Aceita **KML, KMZ ou GPX** da área total.

- **KML/KMZ.**
  - O perímetro pode vir como polígono ou como linha fechada, o jeito que o CAD grava.
  - Uma linha aberta no mesmo arquivo entra como rio.
  - KML só de pontos também serve: é o GPX aberto no Google Earth e salvo.
- **GPX (GPS de mão, como eTrex, GPSMAP ou celular).** Há três casos:
  1. **Pontos de passagem marcados na divisa.** O perímetro liga os pontos e fecha no primeiro.
     - O sistema testa três ordens: o horário da coleta, o número do ponto e a ordem do arquivo. Fica com a primeira que fecha sem cruzar; se nenhuma fechar, liga os pontos em volta do centro e avisa.
     - O ponto marcado duas vezes no mesmo lugar (a menos de 1 m) sai, porque o SICAR recusa vértice colado.
     - Na tela de entrada, clicar num ponto o tira do perímetro (a sede, um ponto de outro dia) ou o põe de volta.
  2. **Trilha que volta perto do começo.** A trilha vira o perímetro, simplificada por Douglas-Peucker com tolerância de 0,5 m.
  3. **Só trilha aberta.** O sistema fecha a trilha e avisa.

O nome de cada ponto do GPS aparece nos vértices da prancheta.

Exemplo real: `tests/fixtures/car/PONTOS.gpx`. São 9 pontos do eTrex 10 (218 a 226), que formam 0,6017 ha.

### Área com glebas (várias poligonais no mesmo arquivo)

Desde 27/11/2026 o arquivo com mais de um polígono é lido como **as glebas da área total**, não mais só o maior.

- Na tela de entrada aparece a lista "Poligonais do arquivo": cada uma com o número, o nome e a área. Clicar na lista ou no desenho marca e desmarca.
- Entram todas, menos o polígono que está **dentro** de outro (a reserva desenhada no CAD, uma divisão interna, uma cópia). Esse vem desmarcado, com o motivo.
- No GPX com várias trilhas fechadas entra só a maior (em geral é a mesma divisa andada de novo); as outras ficam na lista para marcar.
- A área total é a **união** das glebas:
  - as que se encostam viram um polígono só, e a divisa comum some;
  - vértice de uma gleba a menos de 5 cm da outra é encaixado nela, para que levantamentos diferentes não deixem fresta;
  - as glebas separadas viram partes do **mesmo registro** no `AREA_IMOVEL.shp`: um shapefile só, um registro só.
- Avisos: glebas que se sobrepõem (a área conta uma vez), vão entre glebas, e partes a menos de 1 m sem se encostar.
- A reserva legal é a porcentagem da área **total**. "Encostar" faz a faixa na gleba do lado clicado; se aquela parte for pequena demais, o sistema avisa. "Desenhar" pode pôr a reserva em mais de uma gleba, e "Ajustar" leva o conjunto à porcentagem.
- A sobreposição com vizinhos corta cada gleba à parte. A certificação no SIGEF (ou o CAR) de **uma** gleba conta como o próprio imóvel e não corta a gleba vizinha.
- A área levada da Consulta ou de outro serviço ("Usar a área em outro serviço") chega com todas as partes, já como glebas.
- No projeto, a 1ª gleba fica em `perimetro`, e as outras em `glebas`. O serviço de uma poligonal não muda nada.

## Camadas

- **Reserva legal.** Encostada num lado, com a porcentagem exata e um giro, ou desenhada à mão. O botão "Ajustar" leva a área à porcentagem.
- **Vegetação nativa (cedida).** É o excedente de mata deste imóvel que vai servir de reserva legal de **outro** imóvel (compensação, Código Florestal art. 66, §5º, IV, no mesmo bioma).
  - Nunca entra na reserva do próprio imóvel: o que for desenhado por cima dela é cortado.
  - A área a ceder (ha) vem do que o imóvel beneficiado precisa.
  - Encostar e Ajustar funcionam como na reserva, mas só no que sobra fora da reserva.
  - Os dados do imóvel beneficiado (nome e número do CAR) vão no KML.
  - Saídas:
    - shapefile próprio, `VEGETACAO_NATIVA`;
    - **KML da vegetação**, com área (ha e m²), imóvel cedente, município, proprietário, imóvel beneficiado, CAR dele, finalidade e o contorno do imóvel como referência.
- **APP.** Faixa dos dois lados do rio, só dentro do imóvel.
- **Área produtiva.** Imóvel − reserva − vegetação nativa. A APP também sai se o operador marcar a opção.

## Testes

- `tests/car.test.mjs` cobre a reserva, a APP e o shapefile do escritório.
- `tests/car_glebas.test.mjs` cobre a área com glebas (`tests/fixtures/car/TRES_GLEBAS.kml`): duas glebas encostadas com divisa desencontrada em centímetros, uma separada, e a reserva desenhada no CAD dentro da primeira. Laboratório: `#/lab/car/glebas`.
- `tests/car_gpx_vegetacao.test.mjs` cobre:
  - o GPX real;
  - a ordem dos pontos;
  - o ponto repetido;
  - a trilha;
  - o KML de pontos;
  - a vegetação fora da reserva;
  - encostar e ajustar a vegetação;
  - o KML e o shapefile da vegetação;
  - nenhuma aresta cruzada em grau (o erro 3001 do SICAR);
  - o projeto antigo sem vegetação.
