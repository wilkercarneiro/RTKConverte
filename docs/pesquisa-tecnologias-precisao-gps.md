# Pesquisa: tecnologias para aumentar a precisão do GPS no Vertces

Data: 08/11/2026. Complementa o [estudo do código](estudo-precisao-gps-campo.md). As fontes estão no fim. Cada item diz **o que é**, **quanto ganha**, **se dá para usar no Vertces (site no navegador)** e o **veredito**.

---

## 1. O achado que muda o plano

**Desde o Chrome 138 (junho de 2025), o Chrome do Android abre portas seriais Bluetooth (RFCOMM/SPP) pela Web Serial API.** Isso inclui o Bluetooth "clássico" que quase todo receptor de topografia usa. O Chrome 148 (beta em abril de 2026) estende o mesmo para a porta serial por USB.

Na prática, o **próprio Vertces, no navegador do celular, pode virar a controladora de campo de um receptor RTK**, sem app instalado:

1. **Receber a posição:** ler as sentenças NMEA do receptor, que trazem o **tipo de fix** (GGA: 4 = RTK fixo, 5 = flutuante), o número de satélites, o HDOP e o desvio em E/N (GST).
2. **Mandar a correção:** a correção NTRIP (RBMC-IP do IBGE, gratuita) vem por um **repasse no nosso servidor**, de WebSocket para TCP, porque o navegador não abre TCP. O Vertces a escreve no receptor pela mesma porta.
3. **Exigir RTK fixo:** o Vertces passa a **recusar vértice que não esteja em RTK fixo**, como uma controladora de verdade. Pela geolocalização do navegador isso é impossível.

Limites:
- **Não funciona no iPhone.** O Safari não tem Web Serial nem Web Bluetooth.
- **Não há eventos de conectar e desconectar no Android.** A queda é detectada pelo erro de leitura.
- O receptor precisa estar **pareado** antes, nas configurações do Android.

Para o iPhone, o caminho é o receptor certificado MFi (ver 3.2).

Isso faz a camada C do estudo deixar de ser "o futuro" e passar a ser **o caminho principal para a precisão de peça técnica**.

---

## 2. Celular sozinho (o que melhora sem equipamento)

| Tecnologia | Ganho realista | Usável no Vertces? | Veredito |
|---|---|---|---|
| **Correções de código do estudo** (duplicadas, aquecimento, ocupação longa, ajuste de retas por lado) | Tira o viés de área (canto cortado) e dá cerca de 1,5 a 3 m em céu aberto | Sim, puro código | **Fazer** |
| **Ocupação longa**: a pesquisa confirma o motivo | O multicaminho leva **centenas de segundos** para mudar; média de 5 s não ganha nada, de 2 a 5 min ganha | Sim | **Fazer** (Marcar ponto de 20 s a 3 min) |
| **Calibração por marco SIGEF** (translação pelo erro medido num ponto conhecido) | Cerca de 0,5 a 1,5 m perto do marco, numa medição curta | Sim (`parcelas_sigef`) | **Fazer.** Não achei nenhum app de mercado que use os vértices SIGEF como base: é um diferencial |
| **Dizer a precisão a 95%** | Honestidade: a documentação do Android confirma que `accuracy` é o raio de **68%** | Sim | **Fazer** |
| **Filtro de Kalman / suavizador RTS no trajeto** | Tira o zigue-zague e os saltos; não tira o viés | Sim, em JS (conta pequena) | Fazer junto com o ajuste de retas |
| **Sensores do celular (passos e bússola, pelo DeviceMotion)** para reforçar o Caminhar | Suaviza o trecho sob árvore; deriva rápido | Sim no Chrome; no iPhone pede permissão | Depois, se a régua mostrar buracos sob a copa |
| **Dados brutos do GNSS do Android** (`GnssMeasurement`) + RTKLIB/PPP | No Google Smartphone Decimeter Challenge: 1,6 m (2021), 1,2 m (2022), submétrico com sensor inercial (2023–24), em carro. RTK de 1 a 2 cm só em céu aberto, parado, num Xiaomi Mi 8, em pesquisa. Convergência estática de cerca de 100 min para 1 m | **Não pelo navegador**: exige app nativo | **Não.** Custo alto para ganho incerto; o receptor externo resolve melhor e mais barato |
| **Galileo HAS** (correção PPP gratuita da UE, também por NTRIP) | Receptor: decímetros. Celular Pixel 7: cerca de 1 m (2D, abaixo de 1 m) num teste de 60 min | Exige PPP sobre dado bruto, ou seja, app nativo; fora da área oficial não há garantia | **Não para o celular.** Útil num receptor que já tenha HAS |
| **Correções 3D do Google** (prédios) | Cerca de 50 a 75% menos erro de "lado errado da rua" | Já vem no Android; é **urbano** | Irrelevante no campo |
| **ARCore Geospatial / VPS** (posição por imagem do Street View) | VPS típico: cerca de 5 m; precisa de cobertura | App nativo; o campo quase não tem cobertura | **Descartar** |
| **IA que contorna a cerca na imagem** (Delineate Anything, 2025, código aberto) | Desenha o talhão na imagem, mas a imagem também erra metros (em estudo da UFPE, uma imagem WorldView-3 não atingiu a precisão do INCRA) | Rodaria no servidor | **Só como ajuda de croqui/CAR**, nunca como precisão |

---

## 3. Receptor externo (o caminho para centímetro)

### 3.1 Como ligar ao Vertces: quatro caminhos

| Caminho | Plataforma | Esforço nosso | Tipo de fix? | Veredito |
|---|---|---|---|---|
| **Web Serial (Bluetooth SPP) + repasse NTRIP no servidor** | Chrome no Android 138+ (e computador) | Médio: leitor NMEA, repasse WebSocket↔NTRIP na VPS e tela de conexão | **Sim** | **Principal** |
| **Web Bluetooth (BLE)** | Chrome no Android e computador | Médio (UART BLE) | Sim | Complemento para receptores só BLE (ex.: SparkFun RTK) |
| **Local fictício no Android** (Lefebure NTRIP Client, GNSS Master): o app joga a posição do receptor no lugar da do sistema | Android | **Quase zero** (só os pisos de 0,5 a 1,5 m do estudo) | Não, só a precisão | **Já, como plano B.** Falta confirmar num aparelho que o Chrome lê o local fictício: as fontes falam de apps de SIG, não do Chrome |
| **Receptor MFi no iPhone** (Emlid RX2, Bad Elf, EOS Arrow, Trimble) | iPhone | Quase zero | Não | Único caminho no iPhone. O fabricante diz "funciona com qualquer app de localização"; o Safari não foi confirmado e precisa de teste |

### 3.2 Equipamentos (referência de preço em US$, sem frete nem imposto)

| Opção | O que é | Preço | Observação |
|---|---|---|---|
| **Quectel LG290P** (placa Waveshare ou SparkFun) | Módulo de 4 frequências com RTK: 0,8 cm + 1 ppm | Módulo de cerca de US$ 50 a 80; placa de cerca de US$ 90 (Waveshare) a 190 (SparkFun) | Precisa de antena, bateria e uma ponte Bluetooth (ESP32). **Base de um "kit Vertces" barato**, se quisermos vender hardware |
| **SparkFun RTK Torch / Postcard** (firmware "RTK Everywhere") | Receptor pronto, NMEA por **SPP e BLE** | Médio | Firmware aberto, entra direto pelo Web Serial ou Web Bluetooth |
| **ArduSimple simpleRTK** (u-blox F9P / Septentrio mosaic) | Placas e kits RTK | Médio | Muito usado; NTRIP pelo celular |
| **Emlid Reach RX2** | Receptor de todas as bandas, MFi, com **compensação de inclinação** | Cerca de US$ 2.399 | Funciona no Android e no iPhone; o bastão não precisa estar nivelado |
| Linha de topografia (CHC, Stonex, Comnav, Trimble, Leica) | O que os agrimensores já têm | — | **Pela Web Serial, o Vertces serve para o receptor que o cliente já tem**: é o maior alcance |

### 3.3 De onde vem a correção (Brasil)

| Serviço | Custo | Precisão | Observação |
|---|---|---|---|
| **RBMC-IP (IBGE)** | **Grátis**, com cadastro | RTK de centímetro perto da estação | `gps-ntrip.ibge.gov.br:2101`. Fontes antigas falam em limite de 3 estações por usuário e senha válida por até 3 meses. **O IBGE não garante disponibilidade 24/7**, e a rede é rala no interior |
| **u-blox PointPerfect Flex (Nordian)** | Pago | **3 a 6 cm, convergindo em segundos** (PPP-RTK) | Cobre o Brasil; por internet e satélite; formato RTCM para qualquer receptor |
| **GEODNET / onocoy** (redes colaborativas) | Pago (onocoy a partir de US$ 20 por mês mais uso) | RTK | Mais de 2.000 / 7.900 estações no mundo; **não achei o número no Brasil** |
| **Galileo HAS** | Grátis (cadastro na UE) | Cerca de 20 cm (meta oficial de 15 cm em 68%) | A área oficial é a Europa; no Brasil funciona sem garantia; exige receptor com PPP |
| Base própria (um segundo receptor num marco) | Custo do receptor | Centímetro | Pode ser a base do próprio agrimensor transmitindo por NTRIP |

### 3.4 Bibliotecas para o caminho do receptor

- **NMEA no navegador:** `gnss.js` (npm) lê GGA, GSA, GSV, RMC, GST e VTG e tem cliente NTRIP por WebSocket. Também é pequeno o bastante para escrevermos o nosso leitor de GGA e GST, como foi feito com o leitor de TXT.
- **RTCM:** o navegador **não precisa decodificar**, só repassar os bytes da correção para o receptor.
- **Repasse NTRIP:** na VPS, um serviço curto de WebSocket↔TCP (com o login do usuário, para não virar repasse aberto). Alternativa: `str2str` do RTKLIB.
- **RTKLIB / RTKLIB-EX (demo5):** licença BSD-2, referência para pós-processamento (PPK). Não achei versão WebAssembly pronta. O **RTKapp** (iOS, 2026) já faz PPK e PPP no celular a partir do bruto, mas é app de terceiros.

---

## 4. A régua: o que é obrigatório e o que é marketing

- **INCRA (NTGIR, 3ª edição):** 0,50 m para limite artificial, 3,00 m para natural e 7,50 m para inacessível, **em 1σ (68%)**. O celular nunca atinge o limite artificial. Com o receptor em RTK fixo e um protocolo de ocupação, o Vertces pode marcar o vértice como "apto para SIGEF".
- O **CAR** aceita imagem e croqui. O celular corrigido (camada 2) basta.

---

## 5. Recomendação final

1. **Celular** (sem equipamento):
   - correções do estudo (duplicadas, aquecimento, 95%, ocupação longa, ajuste de retas por lado, Kalman);
   - **calibração por marco SIGEF**.
   - Atende croqui, CAR e pré-orçamento.
2. **Receptor no navegador** (o grande salto):
   - conexão pela **Web Serial (SPP)** e pela Web Bluetooth (BLE);
   - repasse NTRIP na VPS, com a RBMC-IP e a conta do próprio cliente (PointPerfect, GEODNET, base própria);
   - selo **RTK fixo / flutuante / autônomo** em cada vértice;
   - modo **"ponto de SIGEF"**, que só aceita RTK fixo, com ocupação mínima e duas medidas que concordam.

   Funciona com o receptor que o agrimensor **já tem**, no Android.
3. **Plano B imediato:** local fictício no Android e receptor MFi no iPhone, com página de ajuda. Só depende de tirar os pisos de 0,5 a 1,5 m do código.
4. **Opcional, comercial:** um kit barato com o LG290P (com cerca de US$ 100 de placa) com a marca Vertces.
5. **Descartados por ora:** dado bruto do celular, PPP no celular, VPS/ARCore e correções 3D urbanas.

**Antes de escrever código, há três testes de bancada (meia hora cada, com um receptor Bluetooth emprestado):**
1. o Chrome do Android lê o **local fictício**?
2. a **Web Serial** abre o receptor pareado (SPP) e recebe a GGA?
3. o Safari do iPhone recebe a posição de um receptor **MFi**?

---

## Fontes

- Web Serial sobre Bluetooth no Android: [Intent to Ship (blink-dev)](https://groups.google.com/a/chromium.org/g/blink-dev/c/BqUGCcurReE), [Chrome 138 (devicebase)](https://devicebase.net/en/google-google-chrome/updates/web-serial-over-bluetooth-on-android/71h), [caniuse #7413](https://github.com/Fyrd/caniuse/issues/7413), [Chrome 148 beta](https://www.notebookcheck.net/Chrome-148-Beta-for-Android-adds-Web-Serial-SharedWorker-support.1269721.0.html), [PSA Web Serial no Android](https://groups.google.com/a/chromium.org/g/blink-dev/c/yGhvQ6mEmcY)
- Precisão do Android em 68%: [Location.Accuracy](https://learn.microsoft.com/en-us/dotnet/api/android.locations.location.accuracy?view=net-android-37.0)
- Multipath e média: [GPS World](https://www.gpsworld.com/?p=34195), [Robustelli 2019](https://iris.uniroma1.it/retrieve/e383531e-ab38-15e8-e053-a505fe0a3de9/Robustelli_Assessment-dual-frequency_2019.pdf)
- Dado bruto e RTK no celular: [1–2 cm com Mi 8 (Inside GNSS)](https://insidegnss.com/researchers-achieve-1-2-cm-accuracy-with-commercial-smartphone), [Sensors 22 09879](https://mdpi-res.com/d_attachment/sensors/sensors-22-09879/article_deploy/sensors-22-09879.pdf), [GSDC / GNSS-INS (NAVI)](https://navi.ion.org/custom-print/153687), [PMC9919037](https://pmc.ncbi.nlm.nih.gov/articles/PMC9919037)
- Galileo HAS: [Celular com HAS (TU Wien)](https://repositum.tuwien.at/bitstream/20.500.12708/206047/1/Wareyka-Glaner-2024-Smartphone%20PPP%20with%20the%20Galileo%20High%20Accuracy%20Service-vor.pdf), [HAS pela internet (GSC)](https://www.gsc-europa.eu/node/7397), [GPS World](https://www.gpsworld.com/inside-galileo-has-a-new-era-of-free-high-precision-gnss/)
- Google: [Correções 3D urbanas](https://android-developers.googleblog.com/2020/12/improving-urban-gps-accuracy-for-your.html), [ARCore VPS](https://developers.google.com/ar/develop/java/geospatial/check-vps-availability)
- IA de contorno: [Delineate Anything](https://arxiv.org/abs/2504.02534), [DelAnyFlow](https://arxiv.org/abs/2511.13417)
- Local fictício: [Emlid](https://docs.emlid.com/reachrx/integration/mock-location/), [Lefebure (RTKdata)](https://docs.rtkdata.com/integration-hub/ntrip-clients-and-field-software/lefebure-ntrip-client), [GNSS Master](https://docs.rtkdata.com/integration-hub/ntrip-clients-and-field-software/gnss-master)
- Equipamentos: [LG290P SparkFun](https://www.sparkfun.com/sparkfun-quadband-gnss-rtk-breakout-lg290p-qwiic.html), [Waveshare LG290P](https://www.cnx-software.com/2025/11/25/waveshare-low-cost-lg290p-gnss-rtk-breakout-board-rtc-battery-support/?amp=1), [SparkFun RTK Everywhere (SPP/BLE)](https://docs.sparkfun.com/SparkFun_RTK_Everywhere_Firmware/connecting_bluetooth/), [Emlid RX2](https://advexure.com/products/emlid-reach-rx2), [Bad Elf MFi](https://apps.apple.com/us/app/-/id391764718), [Inclinação por IMU (Trimble)](https://help.trimblegeospatial.com/TrimbleAccess/latest/en/GNSS-IMU-tilt-compensation.htm)
- Correções no Brasil: [RBMC-IP (IBGE)](https://www.ibge.gov.br/geociencias/informacoes-sobre-posicionamento-geodesico/servicos-para-posicionamento-geodesico/16332-rbmc-ip-rede-brasileira-de-monitoramento-continuo-dos-sistemas-gnss-em-tempo-real.html), [Acesso RBMC-IP (gov.br)](https://www.gov.br/pt-br/servicos/obter-acesso-a-rbmc-ip), [PointPerfect no Brasil](https://insidegnss.com/u-blox-and-nordian-introduce-pointperfect-gnss-correction-service-to-brazil/), [PointPerfect Flex América do Sul](https://www.u-blox.com/en/pointperfect-flex-south-america-coverage-expansion), [GEODNET](https://geodnet.com/free), [onocoy](https://onocoy.com/onocoy-services), [ArduSimple Brasil](https://www.ardusimple.com/?p=75469)
- Bibliotecas: [gnss.js](https://www.pkgstats.com/pkg:@brandon7lewis/gnss.js), [RTKapp / RTKLIB-EX](https://github.com/rtklibexplorer/RTKLIB/discussions/808), [RtkGps (illarionov)](https://github.com/illarionov/RTKLIB)
- INCRA: [precisões da NTGIR (IFSC)](https://moodle3.ifsc.edu.br/mod/resource/view.php?id=84466), [UFPE](https://periodicos.ufpe.br/revistas/rbgfe/article/view/245727)
