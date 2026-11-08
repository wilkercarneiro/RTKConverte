# Estudo: como deixar o GPS do Medir no campo o mais preciso possível

Data: 08/11/2026. Escopo: a ferramenta **Medir no campo** (`#/campo`) e a localização da **Consulta** (`ConsultaImovel.tsx`). O estudo foi feito pela leitura do código. Ainda não há medição de campo que dê números; a seção 6 propõe como obtê-los.

---

## 1. Resumo para decidir

| Camada | O que dá para alcançar | Custo | Recomendação |
|---|---|---|---|
| **A. Software no navegador** (só código nosso) | Hoje o erro fica em torno de 3 a 8 m. Com as correções, cerca de 1,5 a 3 m em céu aberto. A área perde menos nos cantos. | Baixo. Sem dependência nova. | **Fazer já.** |
| **B. Ajuste por ponto conhecido** (marco SIGEF do vizinho) | Cerca de 0,5 a 1,5 m perto do marco, numa medição curta. | Médio. Usa a base `parcelas_sigef` que já temos. | **Fazer em seguida.** É o maior ganho sem comprar equipamento. |
| **C. Receptor GNSS RTK externo** (Bluetooth) | Cerca de 1 a 3 cm com fix RTK (RBMC-IP ou base própria). | O equipamento custa de R$ 3 a 15 mil por agrimensor; no código, de baixo a médio. | **Preparar o sistema para aceitar.** É o único caminho para precisão de SIGEF. |
| **D. App nativo com dados brutos do GNSS** (Android) | Cerca de 0,3 a 1 m, e só em celular de dupla frequência. Ainda é pesquisa. | Alto: app nativo e RTKLIB. | **Não agora.** |

**Limite que não muda:** o GPS do celular, sozinho, **nunca** atinge a precisão do SIGEF. A norma do INCRA pede 0,50 m em limite artificial, 3,00 m em limite natural e 7,50 m em limite inacessível. O celular serve para croqui, CAR, conferência e pré-orçamento. Só a camada C serve para peça técnica, e a tela deve dizer isso.

---

## 2. Como o GPS funciona hoje (o que o código faz)

- **Fonte:** `navigator.geolocation.watchPosition` com `enableHighAccuracy: true, maximumAge: 0, timeout: 20000` ([gps.ts:68](../src/lib/campo/gps.ts#L68)). O navegador entrega a posição **fundida** do sistema (GNSS, Wi-Fi, rede de celular e sensores). O site não tem acesso a satélites, DOP, tipo de fix nem dados brutos.
- **Precisão informada (`coords.accuracy`):** no Android é o raio de **68% de confiança** (1 sigma), e não o erro máximo. Quando o celular mostra "±3 m", cerca de 1 leitura em cada 3 está **fora** desses 3 m.
- **Marcar ponto aqui:** junta leituras por **5 s** (padrão em [tipos.ts:69](../src/lib/campo/tipos.ts#L69)). Também pede `getCurrentPosition` a cada 1 s ([Campo.tsx:261-262](../src/components/campo/Campo.tsx#L261-L262)). Tira a mediana, descarta as leituras que pularam longe e faz a média ponderada por 1/precisão² ([motor.ts:79](../src/lib/campo/motor.ts#L79)).
- **Caminhar:** cada leitura bruta pode virar vértice, a cada 5 m ou quando a direção muda mais de 15° ([motor.ts:34](../src/lib/campo/motor.ts#L34)). Não há suavização.
- **Limpar linha reta:** aplica Douglas–Peucker sobre os vértices brutos. Escolhe **quais ficam**, mas não **corrige onde ficam** ([simplificar.ts](../src/lib/campo/simplificar.ts)).
- **Datum:** o GPS dá WGS84 na época atual e o sistema trata como SIRGAS 2000 ([tipos.ts:5](../src/lib/campo/tipos.ts#L5)). Na escala do celular não faz diferença. Com RTK faz (ver C.4).

---

## 3. Problemas encontrados no código (camada A)

### A.1 Leituras duplicadas no Marcar ponto
Durante o Marcar ponto, o `watchPosition` e o `pedirAgora` (a cada 1 s) entregam **a mesma posição duas vezes**, porque o Chrome devolve o último fix. As duas entram em `marcandoRef` ([Campo.tsx:234](../src/components/campo/Campo.tsx#L234)). Isso tem dois efeitos:
- o peso daquela posição dobra na média;
- o **espalhamento fica subestimado**, e a "precisão honesta" pode sair melhor do que é.

Além disso, `paraLeitura` grava `t: Date.now()` e joga fora `p.timestamp` ([gps.ts:42](../src/lib/campo/gps.ts#L42)). Assim não há como reconhecer a repetição.
**Correção:** guardar `tGps = p.timestamp` na `Leitura` e descartar a leitura repetida (mesmo `tGps`, ou mesma lat/lon e mesma precisão) antes de `combinarLeituras`.

### A.2 Marcar ponto curto demais
Com 5 s, a média quase não ajuda. O erro do GPS do celular (multicaminho e ionosfera) **muda devagar**, numa escala de dezenas de segundos a minutos, e leituras de 5 s são praticamente a mesma amostra. O próprio comentário do motor já reconhece isso ([motor.ts:15-18](../src/lib/campo/motor.ts#L15-L18)).
**Correção:**
- passar o padrão para **20 s** e criar um modo **"Ocupação longa"** de 1 a 3 min para os cantos importantes;
- mostrar a convergência ao vivo, com o desvio caindo e "estável há N s", e oferecer **"Pronto"** quando estabilizar;
- vale a regra da estação total: ficar mais tempo no canto que importa.

### A.3 Começo de sessão sem aquecimento
As primeiras posições depois de ligar vêm da rede (Wi-Fi ou antena) ou de um GNSS que ainda está convergindo. Muitas vezes informam precisão "boa" com a posição deslocada.
**Correção:** criar o estado **"Aquecendo o GPS"**. O primeiro vértice só é aceito depois de cerca de 15 a 30 s com GNSS, ou quando a precisão parar de cair (3 leituras seguidas sem melhorar mais de 10%). A tela mostra a precisão caindo.

### A.4 Caminhar usa leitura crua e corta os cantos
- Cada vértice do Caminhar é **uma leitura só**, com todo o ruído dela.
- O vértice de "direção" só nasce **depois** do canto: são pelo menos `max(2 m, passo/2)` já no lado novo ([motor.ts:46-49](../src/lib/campo/motor.ts#L46-L49)). O canto real **nunca é gravado**, e o contorno sai chanfrado. Em canto de 90° com passo de 5 m, cada canto perde até cerca de 12 m² de área. A perda é sistemática e sempre para menos.

**Correção (o maior ganho de software):** **ajuste de retas por lado**.
1. Gravar **todas** as leituras do Caminhar (o trajeto bruto), e não só os vértices.
2. Ao fechar, ou ao limpar, segmentar o trajeto pelos vértices de canto já detectados.
3. Ajustar uma reta a cada lado por mínimos quadrados robustos (RANSAC ou Huber, ponderado por 1/precisão²).
4. O canto passa a ser a **interseção das retas vizinhas**. O ruído de dezenas de leituras se compensa, e o canto volta ao lugar.
5. Os vértices de Marcar ponto e os tocados à mão continuam fixos, como já acontece no `limparLinhaReta`.

Isso substitui o "escolher quais ficam" por "calcular onde ficam". Cabe em `simplificar.ts` como uma 3ª passada, com antes × depois da área na tela, como já existe.

### A.5 Filtro de trajeto (Kalman leve)
Para o Caminhar, um filtro de velocidade constante 2D (estado x, y, vx, vy em UTM, ruído de medição = precisão²) suaviza o zigue-zague e **rejeita saltos impossíveis**: um pulo de 15 m em 1 s andando a pé é reflexo, não deslocamento. Hoje o salto entra como vértice se a precisão informada estiver dentro do limite. O `coords.speed` e o `coords.heading`, quando vêm, entram como medida extra.

### A.6 Limites que travam precisão melhor
Vários pisos foram pensados para erro de metros e vão atrapalhar se a fonte for RTK (camada C):
- `Math.max(0.5, precisao)` no peso ([motor.ts:79](../src/lib/campo/motor.ts#L79));
- corte mínimo de 1,5 m nas leituras descartadas ([motor.ts:76](../src/lib/campo/motor.ts#L76));
- `limitePrecisaoM` com mínimo de 1 m ([tipos.ts:74](../src/lib/campo/tipos.ts#L74));
- tolerância da limpeza entre 0,5 e 1,5 m ([simplificar.ts:33-37](../src/lib/campo/simplificar.ts#L33-L37)).

Todos devem escalar com a precisão da fonte, e não ter número fixo.

### A.7 A tela comunica 1 sigma como se fosse o erro
Hoje "±3 m" quer dizer "68% das vezes dentro de 3 m". **Proposta:** mostrar o valor em 95% (cerca de 2,45 × σ em 2D, o padrão de relatório) ou dizer "provável ±3 m, até ±7 m". É a mesma honestidade que o motor já busca.

### A.8 Orientação ao usuário (sem código, só texto na tela)
Coisas que pesam muito no resultado e o agrimensor nem sempre sabe:
- **Android:** Localização → "Precisão de localização do Google" **ligada**, e busca por Wi-Fi e Bluetooth ligadas. Economia de bateria **desligada**, porque o modo de economia derruba o GNSS para 1 Hz ou menos ou o troca pela rede.
- Celular de **dupla frequência (L1 + L5)** erra bem menos sob árvore e perto de construção. Exemplos: linha Pixel 5 em diante, Galaxy S2x/S2x Ultra, vários Xiaomi. Isso vale citar na ajuda.
- Segurar o celular **na horizontal, acima da cabeça ou no bastão**, longe do corpo, que bloqueia metade do céu.
- Evitar copa de árvore, beiral e cerca de arame (multicaminho). No canto ruim, marcar a 1 ou 2 m para fora e anotar o afastamento. Isso pede uma função de **ponto com afastamento**, como na estação total.

---

## 4. Ajuste por ponto conhecido (camada B)

**Ideia:** o erro do celular numa medição curta (dezenas de minutos, centenas de metros) é **quase o mesmo em todo o trajeto**. Se o agrimensor parar sobre um ponto de coordenada conhecida, a diferença entre o que o GPS diz e a verdade é esse viés, e ele pode ser subtraído de todos os vértices. É um "diferencial do pobre".

**Por que encaixa no Vertces:** já temos as **parcelas SIGEF em PostGIS** (`parcelas_sigef`, nota do mapa interativo). Os vértices certificados dos vizinhos têm precisão centimétrica e quase sempre há um marco perto. Também há os marcos da rede geodésica do IBGE.

**Como fica na tela:**
1. "Calibrar num marco conhecido": o mapa mostra os vértices SIGEF próximos (raio de 500 m) e o agrimensor toca no marco onde está parado.
2. Faz uma ocupação longa (60 a 120 s, ver A.2) sobre o marco.
3. O sistema calcula o deslocamento (ΔE, ΔN) e aplica a translação na medição inteira. A tela mostra "corrigido pelo marco XXX-M-1234, deslocamento de 2,1 m".
4. Se houver **dois ou mais marcos** (um no começo e um no fim), interpola o viés no tempo, porque ele anda devagar.
5. O vértice guarda a correção aplicada, para auditoria e para o arquivo exportado.

**Ressalvas:** o ganho cai com o tempo e com a distância ao marco. Por isso a recalibração depois de cerca de 20 a 30 min aparece como aviso. Não corrige o multicaminho local de cada canto.

---

## 5. Receptor GNSS externo (camada C)

Este é o caminho para **centímetro** e o único que atende SIGEF.

### C.1 Sem código: o receptor alimenta a localização do sistema
- **Android:** o receptor Bluetooth (Emlid Reach RX/RS, ArduSimple com ZED-F9P, Stonex, CHC, Trimble Catalyst e outros) é ligado a um app de ponte, como **Lefebure NTRIP Client** ou **Bluetooth GNSS**, configurado como **"app de local fictício"** nas opções de desenvolvedor. O app ainda pode receber as correções NTRIP da **RBMC-IP do IBGE** (gratuita, com cadastro). A partir daí, o `navigator.geolocation` do Chrome **já recebe a posição RTK**, e o Vertces funciona sem mudar nada além do item A.6.
- **iPhone:** receptores com certificação MFi (Bad Elf, EOS Arrow, Trimble R1/R2, entre outros) substituem a localização do iOS para todos os apps, e o Safari passa a recebê-la também.

**O que precisamos fazer:** (1) o item A.6, para os pisos não estragarem o centímetro; (2) uma página de ajuda "Usar receptor RTK" com o passo a passo; (3) o campo "fonte" no vértice ("celular" ou "receptor"), deduzido pela precisão (abaixo de 0,1 m = receptor).

**Limite:** pela geolocalização do navegador não se sabe se o fix é **RTK fixo ou flutuante**, só a precisão. Para peça técnica isso é insuficiente, e é o que leva ao C.2.

### C.2 Ligação direta pelo Web Bluetooth (Chrome Android e computador)
- O Chrome lê receptores **BLE** e recebe as sentenças NMEA. A **GGA** traz o tipo de fix (4 = RTK fixo, 5 = flutuante), o número de satélites, o HDOP e a idade da correção. A **GST** traz o desvio em E, N e U.
- Com isso, a tela pode **recusar o vértice que não estiver em RTK fixo**, como faz uma controladora de campo de verdade.
- **Limites:** não funciona no iPhone (o Safari não tem Web Bluetooth). Muitos receptores só falam Bluetooth Clássico (SPP), que o navegador não abre. Nesses casos, alguns receptores oferecem NMEA por Wi-Fi/TCP, que também não é acessível pelo navegador sem uma ponte.
- **Encaixe no código:** uma nova `FonteGps` (`fonteBluetooth()`) ao lado de `fonteDoNavegador()`, porque a interface já foi pensada para trocar a fonte ([gps.ts:13](../src/lib/campo/gps.ts#L13)). A `Leitura` ganha os campos opcionais `fix`, `sats`, `hdop` e `sigmaE`/`sigmaN`.

### C.3 Pós-processamento (estático)
Para ocupação estática de marco sem rádio ou internet, o agrimensor grava o bruto no receptor e processa no **IBGE-PPP** ou contra a RBMC. Isso fica fora do Vertces. Mais tarde dá para aceitar o resultado (arquivo de saída) como importação.

### C.4 Datum, quando a fonte for RTK
- Com correção da RBMC-IP, a posição sai em **SIRGAS 2000**, e não há nada a fazer.
- Com fonte em WGS84/ITRF na época atual (correção via satélite ou PPP em tempo real), a diferença para o SIRGAS 2000 é de cerca de **0,3 a 0,4 m** no Brasil, porque a placa anda cerca de 1,2 cm por ano desde 2000,4. Nesses casos é preciso **converter a época** (velocidades do modelo VEMOS). O vértice precisa registrar o referencial e a época de origem.

---

## 6. Como medir antes e depois (para não decidir no escuro)

1. **Gravar o bruto:** criar um "modo diagnóstico" no Campo que grava **todas** as leituras (lat, lon, precisão, `timestamp` do GPS, velocidade, rumo, altitude) e exporta JSON. O laboratório (`#/lab/campo`) já toca trajetos gravados ([gps.ts:111](../src/lib/campo/gps.ts#L111)), então os trajetos reais viram fixtures.
2. **Protocolo de campo** (um técnico da D'Prol, cerca de 1 h):
   - ficar **10 min parado sobre um marco SIGEF** conhecido, em céu aberto e depois perto de árvore;
   - **caminhar o perímetro** de uma área já certificada (área e vértices conhecidos);
   - repetir com 2 ou 3 celulares (um de dupla frequência, se houver).
3. **Métricas:** erro horizontal em 68% e 95% contra o marco; erro de área (%) contra a área certificada; deslocamento médio de canto.
4. Reprocessar os **mesmos** arquivos com cada melhoria (A.1 a A.5 e B) pelo laboratório e comparar os números.

---

## 7. Ordem sugerida

1. **A.1 + A.3 + A.7 + A.8** (duplicadas, aquecimento, 95%, orientação): pequenos e seguros.
2. **Modo diagnóstico + protocolo de campo (seção 6)**: dá a régua.
3. **A.2 + A.4** (ocupação longa, ajuste de retas por lado): o maior ganho de software, medido pela régua.
4. **B** (calibração pelo marco SIGEF).
5. **A.6 + C.1** (aceitar receptor RTK pela localização do sistema, com página de ajuda).
6. **C.2** (Web Bluetooth com tipo de fix), se os agrimensores usarem receptor BLE.
7. A.5 (Kalman) e D, só se os números da régua pedirem.

---

## 8. Situação (08/11/2026, à noite)

Feito no código, com testes em `tests/campo_precisao.test.mjs`:

| Item | Onde |
|---|---|
| A.1 posição repetida conta uma vez (`tGps`) | `motor.ts` (`semRepetidas`), `gps.ts` |
| A.2 Marcar ponto de 20 s (máx. 300), convergência ao vivo, "+1 min" e "Pronto" quando o ponto assenta | `tipos.ts`, `filtro.ts` (`convergencia`), `Campo.tsx` |
| A.3 aquecimento: o 1º vértice andando espera a precisão parar de melhorar (8 a 45 s); selo "Aquecendo" | `filtro.ts` (`estadoAquecimento`) |
| A.4 **Ajustar a cerca**: reta média por lado, cantos no cruzamento, chanfro e zigue-zague fora | `ajuste.ts`. Na simulação, a cerca de 4 lados volta com 4 cantos; com sinal bom, o erro de canto cai de 1,05 m para 0,54 m. Com sinal ruim (erro que "passeia" ±1,5 m), o canto não melhora. É a régua que vai dizer quanto ganha no campo |
| A.5 filtro de Kalman no Caminhar: recusa o salto impossível a pé | `filtro.ts` (`criarFiltroCaminhar`) |
| A.6 pisos que acompanham a precisão (RTK de ±1 cm passa inteiro) | `motor.ts`, `simplificar.ts`, `geometria.ts` (texto em cm) |
| A.7 raio de 95% (1,62×) no selo e no resultado | `geometria.ts` (`textoPrecisao95`) |
| A.8 dicas na aba Precisão → Dicas | `Precisao.tsx` |
| B calibração num marco (SIGEF da base, ou coordenada digitada), interpolada no tempo; os vértices guardam o bruto | `calibracao.ts`, migração `0048` (a coluna `calibracoes`; o site funciona sem ela) |
| Régua: modo diagnóstico (grava as leituras e baixa JSON), laboratório toca o arquivo, `scripts/avaliar-gps.mjs` | `diagnostico.ts`, `LaboratorioCampo.tsx` |
| C receptor RTK (Web Serial/Web Bluetooth + NTRIP pela VPS) | `nmea.ts`, `receptor.ts`, `ntrip.ts`, função `ntrip` |
