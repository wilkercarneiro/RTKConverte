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
