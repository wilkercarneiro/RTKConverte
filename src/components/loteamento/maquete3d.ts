// Maquete 3D do loteamento (three.js). Só o desenho: os dados vêm de
// lib/loteamento/cena3d.ts e o chão pintado de lib/loteamento/textura3d.ts.
//
// A altura de tudo é calculada no shader a partir da cota REAL (atributos
// aNat/aFin/aBase): o exagero vertical, a transição "antes → depois" (o
// terreno natural vira o projetado) e o crescimento das casas e das árvores
// são só uniforms — mexer no controle não reconstrói nada.
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Sky } from "three/examples/jsm/objects/Sky.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import type { Legenda, Roteiro } from "../../lib/loteamento/cinema3d.ts";
import { camNoTempo, legendaNoTempo, roteiroDoVoo } from "../../lib/loteamento/cinema3d.ts";
import type { Cena, Casa } from "../../lib/loteamento/cena3d.ts";
import { cotaFinal, loteNoPonto, PLATIBANDA } from "../../lib/loteamento/cena3d.ts";
import type { Resultado } from "../../lib/loteamento/calculo.ts";
import type { Pt } from "../../lib/loteamento/geom.ts";
import { centroide, comprimento, dist, esquerda, pontoNaPolilinha } from "../../lib/loteamento/geom.ts";

export interface Rotulo { texto: string; x: number; y: number; visivel: boolean; tipo: "quadra" }

export interface EventosMaquete {
  /** lote sob o cursor (índice) e posição na tela */
  onPasso?: (lote: number | null) => void;
  onClique?: (lote: number | null) => void;
  /** rótulos das quadras na tela (a cada quadro em que a câmera mudou) */
  onRotulos?: (r: Rotulo[]) => void;
  onAnimacao?: (rodando: boolean, progresso: number) => void;
  /** rumo da câmera (rad, 0 = olhando para o norte) — para a bússola */
  onBussola?: (rumo: number) => void;
  /** legenda do voo no ar (null = nenhuma) e a opacidade */
  onLegenda?: (l: Legenda | null, alfa: number) => void;
  /** modo cinema (voo/apresentação): a tela some com os painéis e ganha as faixas */
  onCinema?: (ativo: boolean) => void;
  /** a hora mudou por conta própria (timelapse da apresentação): o controle acompanha */
  onHora?: (h: number) => void;
  /** cartela na tela durante o roteiro: o título na abertura, o fecho no fim */
  onCartela?: (fase: "abertura" | "fecho" | null) => void;
}

/** Textos das cartelas do vídeo (abertura e fecho). */
export interface Cartela { nome: string; linha: string; rodape: string }

interface Uniforms {
  uExag: { value: number };
  uRef: { value: number };
  uBase: { value: number };
  uMistura: { value: number };
  uMisturaCor: { value: number };
  uCresce: { value: number };
}

// ---------------------------------------------------------------------------
// Shaders: altura pela cota real
// ---------------------------------------------------------------------------

type Tipo = "terreno" | "parede" | "objeto" | "instancia";

const DECL = `
uniform float uExag; uniform float uRef; uniform float uBase; uniform float uMistura; uniform float uCresce;
attribute float aNat; attribute float aFin; attribute vec2 aGNat; attribute vec2 aGFin;
attribute float aBaixo; attribute float aBase; attribute float aAtraso;
float crescer(float atraso) { float c = clamp(uCresce * 1.7 - atraso * 0.7, 0.0, 1.0); return c * c * (3.0 - 2.0 * c); }
`;

function patchVertice(src: string, tipo: Tipo): string {
  let s = DECL + src;
  if (tipo === "terreno") {
    s = s.replace("#include <beginnormal_vertex>", `
      vec2 gr = mix(aGNat, aGFin, uMistura) * uExag;
      vec3 objectNormal = normalize(vec3(-gr.x, 1.0, gr.y));`);
    s = s.replace("#include <begin_vertex>", `
      vec3 transformed = vec3(position);
      transformed.y = (mix(aNat, aFin, uMistura) - uRef) * uExag;`);
  } else if (tipo === "parede") {
    s = s.replace("#include <begin_vertex>", `
      vec3 transformed = vec3(position);
      transformed.y = aBaixo > 0.5 ? uBase : (mix(aNat, aFin, uMistura) - uRef) * uExag;`);
  } else if (tipo === "objeto") {
    // a fundação (y < 0) acompanha o exagero até o chão; o resto cresce
    s = s.replace("#include <begin_vertex>", `
      vec3 transformed = vec3(position);
      float cr = crescer(aAtraso);
      transformed.y = (position.y < 0.0 ? position.y * uExag : position.y * cr) + (aBase - uRef) * uExag;
      if (cr < 0.01) transformed.y -= 10000.0;`);
  } else {
    const inst = `
      vec4 POS = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        POS = instanceMatrix * POS;
        vec3 pe_POS = vec3(instanceMatrix[3].x, 0.0, instanceMatrix[3].z);
        float cr_POS = crescer(aAtraso);
        POS.xyz = pe_POS + (POS.xyz - pe_POS) * cr_POS;
        if (cr_POS < 0.01) POS.y -= 10000.0;
      #endif
      POS.y += (aBase - uRef) * uExag;`;
    s = s.replace("#include <project_vertex>", `${inst.replace(/POS/g, "mvPosition")}
      mvPosition = modelViewMatrix * mvPosition;
      gl_Position = projectionMatrix * mvPosition;`);
    s = s.replace("#include <worldpos_vertex>", `
      #if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0
        ${inst.replace(/POS/g, "worldPosition")}
        worldPosition = modelMatrix * worldPosition;
      #endif`);
  }
  return s;
}

function elevar<M extends THREE.Material>(mat: M, tipo: Tipo, U: Uniforms, extra?: (sh: THREE.WebGLProgramParametersWithUniforms) => void): M {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = patchVertice(sh.vertexShader, tipo);
    extra?.(sh);
  };
  mat.customProgramCacheKey = () => `elevar-${tipo}`;
  return mat;
}

/** Material de sombra com a mesma elevação (senão a sombra fica no lugar errado). */
function sombraDe(tipo: Tipo, U: Uniforms): THREE.MeshDepthMaterial {
  return elevar(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }), tipo, U);
}

// ---------------------------------------------------------------------------
// Texturas procedurais
// ---------------------------------------------------------------------------

/** Fachada: um vão de 3,2 m × 2,9 m com janela (cinza), parede branca (a cor vem do vértice). */
function texturaFachada(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 128; c.height = 128;
  const x = c.getContext("2d")!;
  x.fillStyle = "#ffffff";
  x.fillRect(0, 0, 128, 128);
  // janela com moldura e peitoril
  x.fillStyle = "#f4f4f4";
  x.fillRect(34, 26, 60, 52);
  x.fillStyle = "#3b4a57";
  x.fillRect(38, 30, 52, 44);
  x.fillStyle = "rgba(255,255,255,0.18)";
  x.fillRect(38, 30, 52, 12);
  x.fillStyle = "#dcdcdc";
  x.fillRect(62, 30, 3, 44);
  x.fillRect(32, 76, 64, 4);
  // rodapé
  x.fillStyle = "#d8d8d8";
  x.fillRect(0, 118, 128, 10);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Máscara das janelas da fachada (o emissivo: janelas acesas ao anoitecer). */
function texturaJanelas(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 128; c.height = 128;
  const x = c.getContext("2d")!;
  x.fillStyle = "#000";
  x.fillRect(0, 0, 128, 128);
  x.fillStyle = "#fff";
  x.fillRect(38, 30, 52, 44);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Ripado de madeira vertical (uv em metros: ~9 réguas por metro, veios e frestas escuras). */
function texturaRipado(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 128; c.height = 128;
  const x = c.getContext("2d")!;
  const tons = ["#a8744a", "#9c6a42", "#b07b4f", "#94633d", "#a5724a"];
  for (let i = 0; i < 9; i++) {
    const x0 = Math.round((i * 128) / 9), x1 = Math.round(((i + 1) * 128) / 9);
    x.fillStyle = tons[i % tons.length];
    x.fillRect(x0, 0, x1 - x0, 128);
    x.fillStyle = "rgba(60,35,18,0.18)";
    for (let k = 0; k < 3; k++) x.fillRect(x0 + 2 + ((i * 5 + k * 4) % (x1 - x0 - 4)), 0, 1, 128);
    x.fillStyle = "#3a2414";
    x.fillRect(x1 - 2, 0, 2, 128);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Caixilho do pano de vidro: montante a cada módulo (u) e quadro em cima e embaixo (v de 0 a 1). */
function texturaVidro(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 64; c.height = 64;
  const x = c.getContext("2d")!;
  const g = x.createLinearGradient(0, 0, 64, 64);
  g.addColorStop(0, "#ffffff");
  g.addColorStop(0.5, "#d9dee2");
  g.addColorStop(1, "#f2f4f5");
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  x.fillStyle = "#202326";
  x.fillRect(0, 0, 3, 64);
  x.fillRect(0, 0, 64, 3);
  x.fillRect(0, 61, 64, 3);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Camadas do solo na lateral do bloco (como o corte de uma maquete física). */
function texturaSolo(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 64; c.height = 256;
  const x = c.getContext("2d")!;
  const g = x.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, "#4b3523");
  g.addColorStop(0.08, "#5d4129");
  g.addColorStop(0.1, "#8a5a33");
  g.addColorStop(0.45, "#a0683a");
  g.addColorStop(0.5, "#b4794a");
  g.addColorStop(0.8, "#c28d5c");
  g.addColorStop(1, "#9c7a5e");
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 256);
  let s = 7;
  for (let i = 0; i < 900; i++) {
    s = (s * 16807) % 2147483647;
    const px = s % 64, py = (s >> 6) % 256;
    x.fillStyle = `rgba(${s % 2 ? "255,240,220" : "40,25,15"},${0.08 + (s % 7) / 70})`;
    x.fillRect(px, py, 1 + (s % 3), 1);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------------------------------------------------------------------------
// A maquete
// ---------------------------------------------------------------------------

export class Maquete {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  readonly U: Uniforms;
  private sky = new Sky();
  private sol = new THREE.DirectionalLight(0xffffff, 3);
  private hemi = new THREE.HemisphereLight(0xcfe3ff, 0x6b5a45, 0.6);
  private pmrem: THREE.PMREMGenerator;
  private envRT: THREE.WebGLRenderTarget | null = null;
  private chao!: THREE.Mesh;
  private mesa!: THREE.Mesh;
  private grupoCasas = new THREE.Group();
  private grupoArvores = new THREE.Group();
  private grupoPostes = new THREE.Group();
  private ambienteAlvo = 0.09;
  private meioFio: THREE.Mesh | null = null;
  private cortina: THREE.Mesh | null = null;
  private cortinaPasso: THREE.Mesh | null = null;
  private sujo = 3;
  /** `aoInterromper`: o estado que a animação deixa se for cortada (a abertura e o Hoje/Projeto não ficam pela metade) */
  private anim: { t0: number; dur: number; passo: (t: number) => void; fim?: () => void; aoInterromper?: () => void } | null = null;
  private raio: number;
  private centro: Pt;
  private hover = -1;
  private hora = 9.5;
  private texAntes: THREE.Texture;
  readonly texProjeto: THREE.CanvasTexture;
  private rotulosQuadra: { texto: string; p: Pt }[];
  private ro: ResizeObserver;
  private gravador: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  /** vídeo: o quadro 3D + as cartelas, compostos num canvas 2D */
  private comp: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; t0: number; tFim: number } | null = null;
  private cartela: Cartela = { nome: "", linha: "", rodape: "" };
  private fundo: { canvas: HTMLCanvasElement; tex: THREE.CanvasTexture };
  private matParede: THREE.MeshStandardMaterial | null = null;
  private matVidro: THREE.MeshStandardMaterial | null = null;
  private matLampada: THREE.MeshStandardMaterial | null = null;
  private matPoca: THREE.MeshBasicMaterial | null = null;
  private ultimoRumo = NaN;
  /** brilho (bloom) no crepúsculo: janelas e postes "acendem" de verdade */
  private composer!: EffectComposer;
  private bloom!: UnrealBloomPass;
  /** sombra refeita só quando algo muda (sol, exagero, transição) — mexer a câmera não precisa */
  private sombraSuja = true;
  /** carros andando pelas ruas (só no voo e na apresentação) */
  private carros: { im: THREE.InstancedMesh; base: THREE.InstancedBufferAttribute; lista: { rua: number; s: number; sentido: number; vel: number }[] } | null = null;
  private movimento = false;
  private ultimoT = 0;
  /** roteiro de cinema em curso */
  private cinema: { r: Roteiro; t0: number; timelapse: [number, number] | null; ultimaHora: number; legenda: { l: Legenda | null; alfa: number }; fase: "abertura" | "fecho" | null } | null = null;
  /** resolução adaptativa: cai durante o movimento se a placa não der conta, volta parada */
  private prMax = 1;
  private prAtual = 1;
  private emaQuadro = 16;
  private ultimoDesenho = 0;
  private agarre: { plano: THREE.Plane; p0: THREE.Vector3; id: number } | null = null;
  private envTimer = 0;
  private destruida = false;

  constructor(
    private caixa: HTMLElement,
    private res: Resultado,
    private cena: Cena,
    canvasProjeto: HTMLCanvasElement,
    canvasAntes: HTMLCanvasElement,
    private lat: number,
    private ev: EventosMaquete = {},
  ) {
    this.centro = cena.centro;
    this.raio = Math.max(60, cena.raio);
    const amplitude = Math.max(1, cena.cotaMax - cena.cotaMin);
    // exagero inicial: relevo suave ganha leitura, relevo forte fica real
    const exag = Math.max(1, Math.min(2.5, (this.raio * 0.12) / amplitude));
    const esp = Math.max(6, this.raio * 0.045);
    this.U = {
      uExag: { value: exag }, uRef: { value: cena.cotaMin }, uBase: { value: -esp }, uMistura: { value: 1 },
      uMisturaCor: { value: 1 }, uCresce: { value: 1 },
    };

    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: false, powerPreference: "high-performance" });
    // o "estúdio" atrás da maquete é desenhado na cena (a foto e o vídeo saem com ele) e muda com a hora
    const fc = document.createElement("canvas");
    fc.width = 4; fc.height = 256;
    const ft = new THREE.CanvasTexture(fc);
    ft.colorSpace = THREE.SRGBColorSpace;
    this.fundo = { canvas: fc, tex: ft };
    this.scene.background = ft;
    this.prMax = this.prAtual = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(this.prMax);
    this.renderer.setSize(caixa.clientWidth, caixa.clientHeight);
    // Neutral preserva a cor do projeto (o ACES lavava o verde dos lotes)
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 0.8;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    caixa.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.display = "block";
    this.pmrem = new THREE.PMREMGenerator(this.renderer);

    this.camera = new THREE.PerspectiveCamera(42, caixa.clientWidth / Math.max(1, caixa.clientHeight), 0.5, this.raio * 60);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.screenSpacePanning = false;
    this.controls.maxPolarAngle = Math.PI * 0.47;
    this.controls.minDistance = 8;
    this.controls.maxDistance = this.raio * 7;
    this.controls.zoomToCursor = true;
    // o botão direito (e Shift+esquerdo) é nosso: "agarrar o chão", sem amortecimento
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: -1 as unknown as THREE.MOUSE };
    this.controls.addEventListener("change", () => { this.sujo = Math.max(this.sujo, 2); });

    // texturas do chão
    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();
    this.texProjeto = new THREE.CanvasTexture(canvasProjeto);
    this.texProjeto.colorSpace = THREE.SRGBColorSpace;
    this.texProjeto.anisotropy = maxAniso;
    this.texAntes = new THREE.CanvasTexture(canvasAntes);
    this.texAntes.colorSpace = THREE.SRGBColorSpace;
    this.texAntes.anisotropy = maxAniso;

    this.montarCeu();
    this.montarTerreno();
    this.montarCasas(cena.casas);
    this.montarArvores();
    this.montarMeioFio();
    this.montarPostes();
    this.montarCarros();
    this.scene.add(this.grupoCasas, this.grupoArvores, this.grupoPostes);

    this.rotulosQuadra = res.quadras.map((q) => ({ texto: q.nome, p: q.centro ?? centroide(q.pol.ext) }));
    // pós-processamento só para o brilho do crepúsculo (de dia desenha direto, mais leve)
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(caixa.clientWidth, caixa.clientHeight), 0, 0.6, 0.92);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.camera.position.copy(this.posGeral());
    this.controls.target.set(0, this.alturaMundo(this.centro) * 0.6, 0);
    this.controls.update();
    this.setHora(this.hora);

    // interação: passar o mouse e clicar num lote
    const el = this.renderer.domElement;
    let baixo: { x: number; y: number } | null = null;
    // "agarrar o chão" (botão direito, do meio ou Shift+esquerdo): o ponto do terreno sob o
    // cursor fica sob o cursor — o pan do OrbitControls, amortecido, ia atrás do mouse
    el.addEventListener("pointerdown", (e) => {
      if (e.pointerType !== "mouse" || !(e.button === 2 || e.button === 1 || (e.button === 0 && e.shiftKey))) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      this.pararAnimacao();
      const ray = this.raio3d(e.clientX, e.clientY);
      const ch = this.pontoNoChao(e.clientX, e.clientY, ray);
      const y = ch ? ray.at(ch[2], new THREE.Vector3()).y : this.controls.target.y;
      const plano = new THREE.Plane(new THREE.Vector3(0, 1, 0), -y);
      const p0 = ray.intersectPlane(plano, new THREE.Vector3());
      if (!p0) return;
      this.agarre = { plano, p0, id: e.pointerId };
      el.setPointerCapture(e.pointerId);
    }, { capture: true });
    el.addEventListener("pointerdown", (e) => { baixo = { x: e.clientX, y: e.clientY }; this.pararAnimacao(); });
    el.addEventListener("pointermove", (e) => {
      const a = this.agarre;
      if (a && e.pointerId === a.id) {
        const p = this.raio3d(e.clientX, e.clientY).intersectPlane(a.plano, new THREE.Vector3());
        // raio quase paralelo ao chão (olhando o horizonte): não deixa a câmera voar longe
        if (p && p.distanceTo(this.camera.position) < this.raio * 12) {
          const d = a.p0.clone().sub(p);
          this.camera.position.add(d);
          this.controls.target.add(d);
          this.sujo = Math.max(this.sujo, 2);
        }
        return;
      }
      this.passar(e);
    });
    const soltar = (e: PointerEvent) => { if (this.agarre && e.pointerId === this.agarre.id) { this.agarre = null; if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId); } };
    el.addEventListener("pointerup", soltar);
    el.addEventListener("pointercancel", soltar);
    el.addEventListener("pointerleave", () => { this.mostrarPasso(-1); });
    el.addEventListener("pointerup", (e) => {
      if (baixo && Math.hypot(e.clientX - baixo.x, e.clientY - baixo.y) < 5) this.ev.onClique?.(this.loteNaTela(e.clientX, e.clientY));
      baixo = null;
    });
    el.addEventListener("wheel", () => this.pararAnimacao(), { passive: true });

    this.ro = new ResizeObserver(() => this.redimensionar());
    this.ro.observe(caixa);
    this.renderer.setAnimationLoop((t) => this.quadro(t));
  }

  // -------------------------------------------------------------------------
  // Mundo ↔ plano
  // -------------------------------------------------------------------------

  /** plano → mundo (x, z) */
  private xz(p: Pt): [number, number] { return [p[0] - this.centro[0], -(p[1] - this.centro[1])]; }
  /** cota do chão no mundo (com exagero e mistura atuais) */
  alturaMundo(p: Pt): number {
    const g = this.cena.grade;
    const m = this.U.uMistura.value;
    const h = cotaFinal(g, p, "natural") * (1 - m) + cotaFinal(g, p, "final") * m;
    return (h - this.U.uRef.value) * this.U.uExag.value;
  }

  // -------------------------------------------------------------------------
  // Céu, sol e luz ambiente
  // -------------------------------------------------------------------------

  private montarCeu(): void {
    this.sky.scale.setScalar(this.raio * 50);
    const u = this.sky.material.uniforms;
    u.turbidity.value = 4.5;
    u.rayleigh.value = 1.4;
    u.mieCoefficient.value = 0.004;
    u.mieDirectionalG.value = 0.82;
    // o céu não é desenhado (fundo de estúdio); ele dá a luz ambiente e os reflexos (PMREM)
    this.sol.castShadow = true;
    const sm = this.renderer.capabilities.maxTextureSize >= 8192 ? 4096 : 2048;
    this.sol.shadow.mapSize.set(sm, sm);
    const r = this.raio * 1.35;
    const cam = this.sol.shadow.camera;
    cam.left = -r; cam.right = r; cam.top = r; cam.bottom = -r;
    cam.near = 1; cam.far = this.raio * 8;
    cam.updateProjectionMatrix();
    this.sol.shadow.bias = -0.0003;
    this.sol.shadow.radius = 3;
    this.sol.shadow.normalBias = 0.25;
    this.scene.add(this.sol, this.sol.target, this.hemi);
  }

  /** Hora do dia (6–18,5 h): posição do sol pela latitude da gleba e pela data de hoje. */
  setHora(h: number): void {
    this.hora = h;
    const dia = Math.floor((Date.now() - Date.UTC(new Date().getUTCFullYear(), 0, 0)) / 864e5);
    const decl = (-23.44 * Math.cos(((2 * Math.PI) / 365) * (dia + 10)) * Math.PI) / 180;
    const fi = (this.lat * Math.PI) / 180, H = ((h - 12) * 15 * Math.PI) / 180;
    const sinEl = Math.sin(fi) * Math.sin(decl) + Math.cos(fi) * Math.cos(decl) * Math.cos(H);
    const el = Math.asin(Math.max(-1, Math.min(1, sinEl)));
    let az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(fi) - Math.tan(decl) * Math.cos(fi)) + Math.PI;
    if (!Number.isFinite(az)) az = Math.PI;
    // azimute a partir do norte (−z), no sentido horário (leste = +x)
    const d = new THREE.Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), -Math.cos(el) * Math.cos(az));
    const elG = (el * 180) / Math.PI;
    this.sky.material.uniforms.sunPosition.value.copy(d);
    this.sol.position.copy(d.clone().multiplyScalar(this.raio * 3));
    this.sol.target.position.set(0, 0, 0);
    // três momentos: dia, sol baixo dourado (luz rasante nas fachadas) e a "hora azul"
    // dos filmes de lançamento (céu azul-arroxeado, ambiente azul, janelas e postes acesos)
    const t = Math.max(0, Math.min(1, (elG - 2) / 28));
    const azul = Math.max(0, Math.min(1, (4 - elG) / 6));
    const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
    const cor = new THREE.Color().setHSL(0.08 + 0.05 * t, 0.9 - 0.75 * t, 0.62 + 0.3 * t).lerp(new THREE.Color(0xff7a52), azul * 0.7);
    this.sol.color.copy(cor);
    this.sol.intensity = lerp(1.5 + 2.0 * Math.min(1, Math.max(0, elG) / 25), 0.22, azul);
    // pouca luz do céu em relação ao sol: é ela que "lava" as sombras
    const f = Math.max(0, Math.min(1, elG / 30));
    this.hemi.intensity = lerp(0.32 + 0.2 * f, 1.0, azul);
    this.hemi.color.setHSL(0.6 - 0.5 * (1 - f) * 0.2, 0.5, 0.75).lerp(new THREE.Color(0x7f9cff), azul);
    this.hemi.groundColor.setHex(0x6b5a45).lerp(new THREE.Color(0x223055), azul);
    this.renderer.toneMappingExposure = lerp(0.9 + 0.05 * f, 1.15, azul);
    this.ambienteAlvo = lerp(0.09, 0.04, azul);
    this.scene.environmentIntensity = this.ambienteAlvo;
    // janelas e postes acendem com o sol abaixo de ~10°; o brilho (bloom) vem junto
    const noite = Math.max(0, Math.min(1, (10 - elG) / 10));
    if (this.matParede) this.matParede.emissiveIntensity = 4.5 * noite;
    if (this.matVidro) this.matVidro.emissiveIntensity = 1.6 * noite;
    if (this.matLampada) this.matLampada.emissiveIntensity = 0.3 + 8 * Math.max(0, Math.min(1, (12 - elG) / 10));
    if (this.matPoca) this.matPoca.opacity = 0.75 * Math.max(0, Math.min(1, (8 - elG) / 8));
    if (this.bloom) { this.bloom.strength = 1.2 * noite; this.bloom.radius = 0.55 + 0.25 * noite; }
    this.sombraSuja = true;
    // a sombra do bloco na mesa só com sol alto (rasante ela vira uma mancha "flutuando" no fundo)
    if (this.mesa) this.mesa.visible = elG > 14;
    this.pintarFundo(Math.max(0, Math.min(1, (16 - elG) / 16)), azul);
    // reflexo do céu (PMREM) com folga: refazer a cada movimento do controle pesa
    clearTimeout(this.envTimer);
    // no timelapse o sol anda sem parar: o reflexo do céu é refeito a cada ~1,2 s
    if (this.cinema?.timelapse && performance.now() - this.ultimoAmbiente > 1200) this.refazerAmbiente();
    else this.envTimer = window.setTimeout(() => this.refazerAmbiente(), 120);
    this.sujo = Math.max(this.sujo, 2);
  }

  /** Fundo de estúdio: azul-ardósia de dia, dourado e lilás com o sol baixo. */
  private pintarFundo(ouro: number, azul = 0): void {
    const x = this.fundo.canvas.getContext("2d")!;
    // dia → dourado → hora azul (azul-marinho em cima, brasa no horizonte)
    const mix = (a: number[], b: number[], c: number[]) => `rgb(${a.map((v, i) => Math.round((v + (b[i] - v) * ouro) * (1 - azul) + c[i] * azul)).join(",")})`;
    const g = x.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, mix([18, 24, 32], [30, 22, 44], [8, 14, 38]));
    g.addColorStop(0.3, mix([40, 56, 74], [96, 70, 92], [32, 42, 92]));
    g.addColorStop(0.44, mix([62, 84, 108], [206, 128, 92], [196, 104, 92]));
    g.addColorStop(0.62, mix([34, 44, 56], [70, 44, 66], [38, 30, 64]));
    g.addColorStop(1, mix([14, 18, 24], [18, 14, 26], [6, 8, 18]));
    x.fillStyle = g;
    x.fillRect(0, 0, 4, 256);
    this.fundo.tex.needsUpdate = true;
  }

  private ultimoAmbiente = 0;
  private refazerAmbiente(): void {
    if (this.destruida) return;
    this.ultimoAmbiente = performance.now();
    const cenaCeu = new THREE.Scene();
    const s2 = new Sky();
    s2.scale.setScalar(1000);
    Object.entries(this.sky.material.uniforms).forEach(([k, v]) => { (s2.material.uniforms as Record<string, { value: unknown }>)[k].value = (v as { value: unknown }).value; });
    cenaCeu.add(s2);
    const rt = this.pmrem.fromScene(cenaCeu, 0, 0.1, 2000);
    this.envRT?.dispose();
    this.envRT = rt;
    this.scene.environment = rt.texture;
    this.scene.environmentIntensity = this.ambienteAlvo;
    s2.geometry.dispose();
    (s2.material as THREE.Material).dispose();
    this.sujo = Math.max(this.sujo, 2);
  }

  // -------------------------------------------------------------------------
  // Terreno: o bloco da maquete
  // -------------------------------------------------------------------------

  private montarTerreno(): void {
    const g = this.cena.grade, { nx, ny, passo } = g, n = nx * ny;
    const pos = new Float32Array(n * 3), uv = new Float32Array(n * 2);
    const aNat = new Float32Array(n), aFin = new Float32Array(n);
    const gNat = new Float32Array(n * 2), gFin = new Float32Array(n * 2);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const [x, z] = this.xz([g.x0 + i * passo, g.y0 + j * passo]);
      pos[k * 3] = x; pos[k * 3 + 2] = z;
      uv[k * 2] = i / (nx - 1); uv[k * 2 + 1] = j / (ny - 1);
      aNat[k] = g.natural[k]; aFin[k] = g.final[k];
      const ia = Math.max(0, i - 1), ib = Math.min(nx - 1, i + 1), ja = Math.max(0, j - 1), jb = Math.min(ny - 1, j + 1);
      for (const [h, gr] of [[g.natural, gNat], [g.final, gFin]] as const) {
        gr[k * 2] = (h[j * nx + ib] - h[j * nx + ia]) / ((ib - ia) * passo);
        gr[k * 2 + 1] = (h[jb * nx + i] - h[ja * nx + i]) / ((jb - ja) * passo);
      }
    }
    const idx = new Uint32Array((nx - 1) * (ny - 1) * 6);
    let o = 0;
    for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
      idx[o++] = a; idx[o++] = b; idx[o++] = c;
      idx[o++] = b; idx[o++] = d; idx[o++] = c;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    geo.setAttribute("aNat", new THREE.BufferAttribute(aNat, 1));
    geo.setAttribute("aFin", new THREE.BufferAttribute(aFin, 1));
    geo.setAttribute("aGNat", new THREE.BufferAttribute(gNat, 2));
    geo.setAttribute("aGFin", new THREE.BufferAttribute(gFin, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    // a caixa de recorte precisa da altura (a posição y é zero; quem eleva é o shader)
    geo.boundingBox = new THREE.Box3(new THREE.Vector3(-1e5, -1e4, -1e5), new THREE.Vector3(1e5, 1e4, 1e5));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    const mat = elevar(new THREE.MeshStandardMaterial({ map: this.texProjeto, roughness: 0.93, metalness: 0 }), "terreno", this.U, (sh) => {
      sh.uniforms.tAntes = { value: this.texAntes };
      sh.uniforms.uMisturaCor = this.U.uMisturaCor;
      sh.fragmentShader = "uniform sampler2D tAntes; uniform float uMisturaCor;\n" + sh.fragmentShader.replace("#include <map_fragment>", `
        #include <map_fragment>
        diffuseColor.rgb = mix(texture2D(tAntes, vMapUv).rgb, diffuseColor.rgb, uMisturaCor);`);
    });
    this.chao = new THREE.Mesh(geo, mat);
    // o terreno só recebe sombra: projetando, ele sombreava a si mesmo (acne
    // em toda a gleba) — e o relevo de um loteamento é suave demais para precisar
    this.chao.receiveShadow = true;
    this.scene.add(this.chao);

    // laterais do bloco (camadas do solo) e a base escura
    const lados: number[][] = [
      Array.from({ length: nx }, (_, i) => i),
      Array.from({ length: ny }, (_, j) => j * nx + nx - 1),
      Array.from({ length: nx }, (_, i) => (ny - 1) * nx + nx - 1 - i),
      Array.from({ length: ny }, (_, j) => (ny - 1 - j) * nx),
    ];
    const paredes: THREE.BufferGeometry[] = [];
    for (const lado of lados) {
      const m = lado.length;
      const p = new Float32Array(m * 2 * 3), nat = new Float32Array(m * 2), fin = new Float32Array(m * 2), baixo = new Float32Array(m * 2), u2 = new Float32Array(m * 2 * 2);
      const ix: number[] = [];
      let s = 0;
      lado.forEach((k, t) => {
        const x = pos[k * 3], z = pos[k * 3 + 2];
        if (t) s += Math.hypot(x - pos[lado[t - 1] * 3], z - pos[lado[t - 1] * 3 + 2]);
        for (const b of [0, 1]) {
          const v = t * 2 + b;
          p[v * 3] = x; p[v * 3 + 2] = z;
          nat[v] = aNat[k]; fin[v] = aFin[k]; baixo[v] = b;
          // v = 1 no topo (com flipY, o topo do canvas — o húmus — fica junto do terreno)
          u2[v * 2] = s / 25; u2[v * 2 + 1] = 1 - b;
        }
        if (t) { const a = (t - 1) * 2; ix.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      });
      const gg = new THREE.BufferGeometry();
      gg.setAttribute("position", new THREE.BufferAttribute(p, 3));
      gg.setAttribute("aNat", new THREE.BufferAttribute(nat, 1));
      gg.setAttribute("aFin", new THREE.BufferAttribute(fin, 1));
      gg.setAttribute("aBaixo", new THREE.BufferAttribute(baixo, 1));
      gg.setAttribute("uv", new THREE.BufferAttribute(u2, 2));
      gg.setIndex(ix);
      // normal horizontal para fora do bloco
      const a0 = lado[0], a1 = lado[m - 1];
      const dx = pos[a1 * 3] - pos[a0 * 3], dz = pos[a1 * 3 + 2] - pos[a0 * 3 + 2];
      const L = Math.hypot(dx, dz) || 1;
      const nrm = new Float32Array(m * 2 * 3);
      for (let v = 0; v < m * 2; v++) { nrm[v * 3] = -dz / L; nrm[v * 3 + 2] = dx / L; }
      gg.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
      paredes.push(gg);
    }
    const geoP = mergeGeometries(paredes)!;
    geoP.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    const solo = elevar(new THREE.MeshStandardMaterial({ map: texturaSolo(), roughness: 1, side: THREE.DoubleSide }), "parede", this.U);
    const bloco = new THREE.Mesh(geoP, solo);
    bloco.receiveShadow = true;
    this.scene.add(bloco);

    const W = (nx - 1) * passo, H = (ny - 1) * passo;
    const [cx, cz] = this.xz([g.x0 + W / 2, g.y0 + H / 2]);
    const base = new THREE.Mesh(
      new THREE.BoxGeometry(W + 3, 2.5, H + 3),
      new THREE.MeshStandardMaterial({ color: 0x24262b, roughness: 0.55, metalness: 0.1 }),
    );
    base.position.set(cx, this.U.uBase.value - 1.25, cz);
    base.receiveShadow = true;
    base.castShadow = true;
    this.scene.add(base);
    // a mesa: invisível, só recebe a sombra do bloco (a maquete não flutua)
    this.mesa = new THREE.Mesh(new THREE.CircleGeometry(this.raio * 6, 64), new THREE.ShadowMaterial({ color: 0x000000, opacity: 0.42 }));
    this.mesa.rotation.x = -Math.PI / 2;
    this.mesa.position.y = this.U.uBase.value - 2.5;
    this.mesa.receiveShadow = true;
    this.scene.add(this.mesa);
  }

  // -------------------------------------------------------------------------
  // Casas (uma geometria só, paredes com janelas e telhado)
  // -------------------------------------------------------------------------

  private montarCasas(casas: Casa[]): void {
    const P: number[] = [], N: number[] = [], C: number[] = [], UV: number[] = [], B: number[] = [], A: number[] = [];
    const PT: number[] = [], NT: number[] = [], CT: number[] = [], BT: number[] = [], AT: number[] = [];
    const cor = new THREE.Color(), cor2 = new THREE.Color();
    const tri = (dst: { P: number[]; N: number[]; C: number[]; UV?: number[]; B: number[]; A: number[] }, vs: THREE.Vector3[], uvs: number[][] | null, c: THREE.Color, base: number, atraso: number) => {
      const n = new THREE.Vector3().subVectors(vs[1], vs[0]).cross(new THREE.Vector3().subVectors(vs[2], vs[0])).normalize();
      for (let i = 0; i < 3; i++) {
        dst.P.push(vs[i].x, vs[i].y, vs[i].z);
        dst.N.push(n.x, n.y, n.z);
        dst.C.push(c.r, c.g, c.b);
        dst.UV?.push(...(uvs ? uvs[i] : [0.05, 0.05]));
        dst.B.push(base);
        dst.A.push(atraso);
      }
    };
    const paredes = { P, N, C, UV, B, A }, telhados = { P: PT, N: NT, C: CT, B: BT, A: AT };
    const vidros = { P: [] as number[], N: [] as number[], C: [] as number[], UV: [] as number[], B: [] as number[], A: [] as number[] };
    const madeira = { P: [] as number[], N: [] as number[], C: [] as number[], UV: [] as number[], B: [] as number[], A: [] as number[] };
    type Dst = typeof paredes | typeof telhados;
    const LISO = [[0.1, 0.5], [0.1, 0.5], [0.1, 0.5], [0.1, 0.5]];
    const COR_ACAB: Record<string, number> = { grafite: 0x3b3e43, concreto: 0xaaa79f, madeira: 0xffffff };
    for (const c of casas) {
      const V = esquerda(c.u);
      const atraso = Math.min(1, dist(c.c, this.centro) / this.raio) * 0.85 + ((c.lote * 0.6180339) % 1) * 0.15;
      const W = (a: number, b: number, y: number): THREE.Vector3 => {
        const p: Pt = [c.c[0] + c.u[0] * a + V[0] * b, c.c[1] + c.u[1] * a + V[1] * b];
        const [x, z] = this.xz(p);
        return new THREE.Vector3(x, y, z);
      };
      if (c.volumes) {
        const o = W(0, 0, 0);
        const D = (da: number, db: number, dy: number) => W(da, db, dy).sub(o);
        // quadrilátero com a normal virada para `fora` (a ordem dos cantos não importa)
        const quad = (dst: Dst, q: THREE.Vector3[], fora: THREE.Vector3, uvs: number[][] | null, k: THREE.Color) => {
          const n = new THREE.Vector3().subVectors(q[1], q[0]).cross(new THREE.Vector3().subVectors(q[2], q[0]));
          const vira = n.dot(fora) < 0;
          const [q0, q1, q2, q3] = vira ? [q[0], q[3], q[2], q[1]] : q;
          const u = uvs && (vira ? [uvs[0], uvs[3], uvs[2], uvs[1]] : uvs);
          tri(dst, [q0, q1, q2], u && [u[0], u[1], u[2]], k, c.piso, atraso);
          tri(dst, [q0, q2, q3], u && [u[0], u[2], u[3]], k, c.piso, atraso);
        };
        const fund = c.fundacao - c.piso;
        const cBase = new THREE.Color(0xa8a196), cLaje = new THREE.Color(c.corTelhado);
        const FORA: [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0]];
        const cantosDe = (v: { a0: number; a1: number; b0: number; b1: number }): [number, number][] =>
          [[v.a0, v.b0], [v.a1, v.b0], [v.a1, v.b1], [v.a0, v.b1]];
        for (const v of c.volumes) {
          const k = new THREE.Color(v.acab === "parede" ? c.corParede : COR_ACAB[v.acab]);
          const dst = v.acab === "madeira" ? madeira : paredes;
          const cs = cantosDe(v);
          // uv: madeira em metros (réguas verticais); o resto liso
          const uvM = (L: number, y0: number, y1: number) => (v.acab === "madeira" ? [[0, y0], [L, y0], [L, y1], [0, y1]] : LISO);
          for (let f = 0; f < 4; f++) {
            const [a1, b1] = cs[f], [a2, b2] = cs[(f + 1) % 4];
            const fora = D(FORA[f][0], FORA[f][1], 0);
            const L = Math.hypot(a2 - a1, b2 - b1);
            quad(dst, [W(a1, b1, v.y0), W(a2, b2, v.y0), W(a2, b2, v.y1), W(a1, b1, v.y1)], fora, uvM(L, v.y0, v.y1), k);
            if (v.y0 === 0) quad(paredes, [W(a1, b1, fund), W(a2, b2, fund), W(a2, b2, 0), W(a1, b1, 0)], fora, LISO, cBase);
          }
          const cima = new THREE.Vector3(0, 1, 0), baixo = new THREE.Vector3(0, -1, 0);
          const topo = (dy: number, e: number) => cs.map(([a, b]) => W(a + (a === v.a0 ? e : -e), b + (b === v.b0 ? e : -e), dy));
          if (v.y0 > 0) quad(dst, topo(v.y0, 0), baixo, uvM(1, 0, 1), k);
          if (!v.platibanda) { quad(dst, topo(v.y1, 0), cima, uvM(1, 0, 1), k); continue; }
          // platibanda: borda de 18 cm, faces internas e a laje meio metro abaixo
          const ext = topo(v.y1, 0), int = topo(v.y1, 0.18), yL = v.y1 - PLATIBANDA + 0.1, laje = topo(yL, 0.18);
          for (let f = 0; f < 4; f++) {
            const g = (f + 1) % 4;
            quad(dst, [ext[f], ext[g], int[g], int[f]], cima, uvM(1, 0, 1), k);
            quad(dst, [int[f], int[g], laje[g], laje[f]], D(-FORA[f][0], -FORA[f][1], 0), uvM(1, 0, 1), k);
          }
          quad(telhados, laje, cima, null, cLaje);
        }
        const branco = new THREE.Color(0xffffff);
        for (const vd of c.vidros ?? []) {
          const v = c.volumes[vd.vol];
          const cs = cantosDe(v);
          const [a1, b1] = cs[vd.face], [a2, b2] = cs[(vd.face + 1) % 4];
          const L = Math.hypot(a2 - a1, b2 - b1), da = (a2 - a1) / L, db = (b2 - b1) / L;
          const [fa, fb] = FORA[vd.face];
          const P0 = (s: number, y: number) => W(a1 + da * s + fa * 0.03, b1 + db * s + fb * 0.03, y);
          const m = (vd.s1 - vd.s0) / Math.max(1, Math.round((vd.s1 - vd.s0) / 1.25));
          quad(vidros, [P0(vd.s0, vd.y0), P0(vd.s1, vd.y0), P0(vd.s1, vd.y1), P0(vd.s0, vd.y1)], D(fa, fb, 0),
            [[0, 0], [(vd.s1 - vd.s0) / m, 0], [(vd.s1 - vd.s0) / m, 1], [0, 1]], branco);
        }
        continue;
      }
      const hl = c.larg / 2, hp = c.prof / 2;
      const altura = c.andares * 2.9 + 0.35 + (c.telhado === "laje" ? 0.8 : 0);
      const fund = c.fundacao - c.piso;
      cor.setHex(c.corParede);
      cor2.setHex(0xa8a196);
      // quatro lados: fundação (até o chão) e parede com janelas (uv em metros)
      const cantos: [number, number][] = [[-hl, -hp], [hl, -hp], [hl, hp], [-hl, hp]];
      for (let s = 0; s < 4; s++) {
        const [a1, b1] = cantos[s], [a2, b2] = cantos[(s + 1) % 4];
        const L = Math.hypot(a2 - a1, b2 - b1);
        // ordem para a face apontar para fora (o anel é anti-horário em (a, b))
        const q1 = W(a1, b1, 0), q2 = W(a2, b2, 0), q3 = W(a2, b2, altura), q4 = W(a1, b1, altura);
        const u1 = 0, u2 = L / 3.2, v2 = altura / 2.9;
        tri(paredes, [q1, q3, q2], [[u1, 0], [u2, v2], [u2, 0]], cor, c.piso, atraso);
        tri(paredes, [q1, q4, q3], [[u1, 0], [u1, v2], [u2, v2]], cor, c.piso, atraso);
        const f1 = W(a1, b1, fund), f2 = W(a2, b2, fund);
        tri(paredes, [f1, q2, f2], null, cor2, c.piso, atraso);
        tri(paredes, [f1, q1, q2], null, cor2, c.piso, atraso);
      }
      if (c.telhado === "laje") {
        // prédio público: laje plana com platibanda (as paredes sobem 0,8 m além do teto)
        cor.setHex(c.corTelhado);
        const t1 = W(-hl, -hp, altura - 0.05), t2 = W(hl, -hp, altura - 0.05), t3 = W(hl, hp, altura - 0.05), t4 = W(-hl, hp, altura - 0.05);
        tri(telhados, [t1, t3, t2], null, cor, c.piso, atraso);
        tri(telhados, [t1, t4, t3], null, cor, c.piso, atraso);
        continue;
      }
      // telhado: cumeeira no lado mais comprido, beiral de 45 cm
      const longoU = c.larg >= c.prof;
      const lo = (longoU ? c.larg : c.prof) / 2 + 0.45, cu = (longoU ? c.prof : c.larg) / 2 + 0.45;
      const hr = cu * (0.36 + ((c.lote * 0.37) % 0.12));
      const R = (l: number, s2: number, y: number) => (longoU ? W(l, s2, y) : W(s2, l, y));
      cor.setHex(c.corTelhado);
      const e1 = R(-lo, -cu, altura), e2 = R(lo, -cu, altura), e3 = R(lo, cu, altura), e4 = R(-lo, cu, altura);
      if (c.telhado === "quatro") {
        const rl = Math.max(0, lo - cu);
        const r1 = R(-rl, 0, altura + hr), r2 = R(rl, 0, altura + hr);
        tri(telhados, [e1, e2, r2], null, cor, c.piso, atraso); tri(telhados, [e1, r2, r1], null, cor, c.piso, atraso);
        tri(telhados, [e3, e4, r1], null, cor, c.piso, atraso); tri(telhados, [e3, r1, r2], null, cor, c.piso, atraso);
        tri(telhados, [e2, e3, r2], null, cor, c.piso, atraso); tri(telhados, [e4, e1, r1], null, cor, c.piso, atraso);
      } else {
        const r1 = R(-lo, 0, altura + hr), r2 = R(lo, 0, altura + hr);
        tri(telhados, [e1, e2, r2], null, cor, c.piso, atraso); tri(telhados, [e1, r2, r1], null, cor, c.piso, atraso);
        tri(telhados, [e3, e4, r1], null, cor, c.piso, atraso); tri(telhados, [e3, r1, r2], null, cor, c.piso, atraso);
        // oitões (triângulos de parede nas pontas)
        cor2.setHex(c.corParede);
        const lw = (longoU ? c.larg : c.prof) / 2, cw = (longoU ? c.prof : c.larg) / 2;
        const hw = hr * (cw / cu);
        for (const sx of [-1, 1]) {
          const g1 = R(sx * lw, -cw, altura), g2 = R(sx * lw, cw, altura), g3 = R(sx * lw, 0, altura + hw);
          tri(paredes, sx > 0 ? [g1, g2, g3] : [g2, g1, g3], null, cor2, c.piso, atraso);
        }
      }
    }
    const mk = (d: { P: number[]; N: number[]; C: number[]; UV?: number[]; B: number[]; A: number[] }) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(d.P, 3));
      geo.setAttribute("normal", new THREE.Float32BufferAttribute(d.N, 3));
      geo.setAttribute("color", new THREE.Float32BufferAttribute(d.C, 3));
      if (d.UV) geo.setAttribute("uv", new THREE.Float32BufferAttribute(d.UV, 2));
      geo.setAttribute("aBase", new THREE.Float32BufferAttribute(d.B, 1));
      geo.setAttribute("aAtraso", new THREE.Float32BufferAttribute(d.A, 1));
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
      return geo;
    };
    if (!P.length) return;
    const fachada = texturaFachada();
    const mP = elevar(new THREE.MeshStandardMaterial({
      vertexColors: true, map: fachada, roughness: 0.82, side: THREE.DoubleSide,
      emissive: 0xffd48a, emissiveMap: texturaJanelas(), emissiveIntensity: 0,
    }), "objeto", this.U);
    this.matParede = mP;
    const mT = elevar(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.66, side: THREE.DoubleSide }), "objeto", this.U);
    const casasP = new THREE.Mesh(mk(paredes), mP), casasT = new THREE.Mesh(mk(telhados), mT);
    for (const m of [casasP, casasT]) { m.castShadow = m.receiveShadow = true; m.customDepthMaterial = sombraDe("objeto", this.U); }
    this.grupoCasas.add(casasP, casasT);
    if (madeira.P.length) {
      const mM = elevar(new THREE.MeshStandardMaterial({ map: texturaRipado(), roughness: 0.72, side: THREE.DoubleSide }), "objeto", this.U);
      const casasM = new THREE.Mesh(mk(madeira), mM);
      casasM.castShadow = casasM.receiveShadow = true;
      casasM.customDepthMaterial = sombraDe("objeto", this.U);
      this.grupoCasas.add(casasM);
    }
    if (vidros.P.length) {
      // vidro fumê refletindo o céu; à noite acende (interior iluminado, caixilho escuro)
      const texVidro = texturaVidro();
      this.matVidro = elevar(new THREE.MeshStandardMaterial({
        // luz ambiente da cena é baixa (sombras marcadas): vidro metálico ficaria preto
        color: 0x5d7688, map: texVidro, emissiveMap: texVidro, roughness: 0.14, metalness: 0.2,
        emissive: 0xffcf94, emissiveIntensity: 0, side: THREE.DoubleSide,
      }), "objeto", this.U);
      const casasV = new THREE.Mesh(mk(vidros), this.matVidro);
      casasV.receiveShadow = true;
      this.grupoCasas.add(casasV);
    }
  }

  // -------------------------------------------------------------------------
  // Árvores (instanciadas: tronco + copa redonda ou cônica; ipês floridos)
  // -------------------------------------------------------------------------

  private montarArvores(): void {
    const arv = this.cena.arvores;
    if (!arv.length) return;
    const tronco = new THREE.CylinderGeometry(0.12, 0.2, 1, 6);
    tronco.translate(0, 0.5, 0);
    const redonda = new THREE.IcosahedronGeometry(1, 1);
    const conica = new THREE.ConeGeometry(1, 2.2, 7);
    const redondas = arv.filter((a) => a.tipo !== 1), conicas = arv.filter((a) => a.tipo === 1);
    const mats = {
      tronco: elevar(new THREE.MeshStandardMaterial({ roughness: 1 }), "instancia", this.U),
      copa: elevar(new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true }), "instancia", this.U),
      cone: elevar(new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true }), "instancia", this.U),
    };
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), cor = new THREE.Color();
    const instancias = (geo: THREE.BufferGeometry, lista: typeof arv, mat: THREE.Material, f: (a: (typeof arv)[number], i: number) => [number, number, number, number, number]) => {
      const im = new THREE.InstancedMesh(geo, mat, lista.length);
      const base = new Float32Array(lista.length), atraso = new Float32Array(lista.length);
      lista.forEach((a, i) => {
        const [x, z] = this.xz(a.p);
        const [y, sx, sy, sz, rot] = f(a, i);
        e.set(0, rot, 0);
        q.setFromEuler(e);
        m4.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(sx, sy, sz));
        im.setMatrixAt(i, m4);
        im.setColorAt(i, cor.setHex(mat === mats.tronco ? 0x6b4c33 : a.cor).offsetHSL(0, 0, ((i * 0.618) % 1) * 0.08 - 0.04));
        base[i] = a.z;
        atraso[i] = Math.min(1, dist(a.p, this.centro) / this.raio) * 0.8 + ((i * 0.381) % 1) * 0.2;
      });
      geo.setAttribute("aBase", new THREE.InstancedBufferAttribute(base, 1));
      geo.setAttribute("aAtraso", new THREE.InstancedBufferAttribute(atraso, 1));
      im.castShadow = true;
      im.receiveShadow = true;
      im.customDepthMaterial = sombraDe("instancia", this.U);
      im.frustumCulled = false;
      this.grupoArvores.add(im);
      return im;
    };
    instancias(tronco, arv, mats.tronco, (a) => [0, a.copa * 0.22, a.altura * 0.62, a.copa * 0.22, 0]);
    instancias(redonda, redondas, mats.copa, (a, i) => [a.altura - a.copa * 0.85, a.copa, a.copa * 0.82, a.copa, i]);
    instancias(conica, conicas, mats.cone, (a) => [a.altura * 0.42 + a.copa, a.copa * 0.7, a.altura / 3.2, a.copa * 0.7, 0]);
  }

  // -------------------------------------------------------------------------
  // Meio-fio (15 cm acima da pista, com o topo de concreto)
  // -------------------------------------------------------------------------

  private montarMeioFio(): void {
    const P: number[] = [], N: number[] = [], B: number[] = [], A: number[] = [];
    const pista = this.cena.pista;
    const g = this.cena.grade;
    const dentroPista = (p: Pt) => pista.some((pg) => {
      // par-ímpar no anel externo (furos: a calçada de dentro do canteiro)
      let c = false;
      for (const an of [pg.ext, ...pg.furos]) for (let i = 0, j = an.length - 1; i < an.length; j = i++) {
        if ((an[i][1] > p[1]) !== (an[j][1] > p[1]) && p[0] < ((an[j][0] - an[i][0]) * (p[1] - an[i][1])) / (an[j][1] - an[i][1]) + an[i][0]) c = !c;
      }
      return c;
    });
    for (const linha of this.cena.meioFio) {
      if (linha.length < 2) continue;
      // lado da calçada: o que fica fora da pista
      const meio = pontoNaPolilinha(linha, comprimento(linha) / 2);
      const nn = esquerda(meio.dir);
      const sinal = dentroPista([meio.pt[0] + nn[0] * 0.4, meio.pt[1] + nn[1] * 0.4]) ? -1 : 1;
      for (let k = 0; k + 1 < linha.length; k++) {
        const a = linha[k], b = linha[k + 1];
        const d = [b[0] - a[0], b[1] - a[1]];
        const L = Math.hypot(d[0], d[1]);
        if (L < 1e-3) continue;
        const n: Pt = [(-d[1] / L) * sinal, (d[0] / L) * sinal];
        const ha = cotaFinal(g, a), hb = cotaFinal(g, b);
        const a2: Pt = [a[0] + n[0] * 0.15, a[1] + n[1] * 0.15], b2: Pt = [b[0] + n[0] * 0.15, b[1] + n[1] * 0.15];
        const [ax, az] = this.xz(a), [bx, bz] = this.xz(b), [a2x, a2z] = this.xz(a2), [b2x, b2z] = this.xz(b2);
        // a face olha para a pista (−n no plano); no mundo z = −y
        const [nx, nz] = [-n[0], n[1]];
        // face vertical (para a pista) e topo
        const quad = (v: number[][], nrm: number[], bs: number[]) => {
          for (const i of [0, 1, 2, 0, 2, 3]) { P.push(...v[i]); N.push(...nrm); B.push(bs[i]); A.push(0.55); }
        };
        quad([[ax, -0.05, az], [bx, -0.05, bz], [bx, 0.15, bz], [ax, 0.15, az]], [nx, 0, nz], [ha, hb, hb, ha]);
        quad([[ax, 0.15, az], [bx, 0.15, bz], [b2x, 0.15, b2z], [a2x, 0.15, a2z]], [0, 1, 0], [ha, hb, hb, ha]);
      }
    }
    if (!P.length) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
    geo.setAttribute("normal", new THREE.Float32BufferAttribute(N, 3));
    geo.setAttribute("aBase", new THREE.Float32BufferAttribute(B, 1));
    geo.setAttribute("aAtraso", new THREE.Float32BufferAttribute(A, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.meioFio = new THREE.Mesh(geo, elevar(new THREE.MeshStandardMaterial({ color: 0xe4e0d8, roughness: 0.85, side: THREE.DoubleSide }), "objeto", this.U));
    this.meioFio.receiveShadow = true;
    this.scene.add(this.meioFio);
  }

  // -------------------------------------------------------------------------
  // Seleção: "cortina" de luz em volta do lote
  // -------------------------------------------------------------------------

  private cortinaDe(idx: number, cor: number, alfa: number, alto: number): THREE.Mesh | null {
    const l = this.res.lotes[idx];
    if (!l) return null;
    const anel = l.pol.ext;
    const pts: Pt[] = [];
    for (let i = 0; i < anel.length; i++) {
      const a = anel[i], b = anel[(i + 1) % anel.length];
      const m = Math.max(1, Math.ceil(dist(a, b) / 1));
      for (let s = 0; s < m; s++) pts.push([a[0] + ((b[0] - a[0]) * s) / m, a[1] + ((b[1] - a[1]) * s) / m]);
    }
    pts.push(pts[0]);
    const P: number[] = [], H: number[] = [], N: number[] = [], F: number[] = [];
    const g = this.cena.grade;
    for (let i = 0; i + 1 < pts.length; i++) {
      const [ax, az] = this.xz(pts[i]), [bx, bz] = this.xz(pts[i + 1]);
      const na = cotaFinal(g, pts[i], "natural"), nb = cotaFinal(g, pts[i + 1], "natural");
      const fa = cotaFinal(g, pts[i]), fb = cotaFinal(g, pts[i + 1]);
      for (const [x, y, z, hn, hf] of [[ax, 0, az, na, fa], [bx, 0, bz, nb, fb], [bx, alto, bz, nb, fb], [ax, 0, az, na, fa], [bx, alto, bz, nb, fb], [ax, alto, az, na, fa]]) {
        P.push(x, y, z); H.push(y / alto); N.push(hn); F.push(hf);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
    geo.setAttribute("aH", new THREE.Float32BufferAttribute(H, 1));
    geo.setAttribute("aNat", new THREE.Float32BufferAttribute(N, 1));
    geo.setAttribute("aFin", new THREE.Float32BufferAttribute(F, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uExag: this.U.uExag, uRef: this.U.uRef, uMistura: this.U.uMistura, uCor: { value: new THREE.Color(cor) }, uAlfa: { value: alfa } },
      vertexShader: `uniform float uExag; uniform float uRef; uniform float uMistura; attribute float aH; attribute float aNat; attribute float aFin; varying float vH;
        void main() { vH = aH; vec3 p = position; p.y += (mix(aNat, aFin, uMistura) - uRef) * uExag + 0.08; gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0); }`,
      fragmentShader: `uniform vec3 uCor; uniform float uAlfa; varying float vH;
        void main() { float a = uAlfa * pow(1.0 - vH, 1.6) + (vH < 0.04 ? 0.5 : 0.0); gl_FragColor = vec4(uCor, a); }`,
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    });
    return new THREE.Mesh(geo, mat);
  }

  private tirar(m: THREE.Mesh | null): null {
    if (m) { this.scene.remove(m); m.geometry.dispose(); (m.material as THREE.Material).dispose(); }
    return null;
  }

  selecionar(idx: number | null): void {
    this.cortina = this.tirar(this.cortina);
    if (idx !== null && idx >= 0) {
      this.cortina = this.cortinaDe(idx, 0xffc533, 0.85, 7);
      if (this.cortina) this.scene.add(this.cortina);
    }
    this.sujo = Math.max(this.sujo, 2);
  }

  private mostrarPasso(idx: number): void {
    if (idx === this.hover) return;
    this.hover = idx;
    this.cortinaPasso = this.tirar(this.cortinaPasso);
    if (idx >= 0) {
      this.cortinaPasso = this.cortinaDe(idx, 0xffffff, 0.6, 4.5);
      if (this.cortinaPasso) this.scene.add(this.cortinaPasso);
    }
    this.renderer.domElement.style.cursor = idx >= 0 ? "pointer" : "";
    this.ev.onPasso?.(idx >= 0 ? idx : null);
    this.sujo = Math.max(this.sujo, 2);
  }

  private ultimoPasso = 0;
  private passar(e: PointerEvent): void {
    if (e.buttons) return;
    const agora = performance.now();
    if (agora - this.ultimoPasso < 40) return;
    this.ultimoPasso = agora;
    const k = this.loteNaTela(e.clientX, e.clientY);
    this.mostrarPasso(k ?? -1);
  }

  private raio3d(cx: number, cy: number): THREE.Ray {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    return ray.ray;
  }

  /** Lote sob o cursor: o telhado/parede de uma casa ganha do chão atrás dela. */
  loteNaTela(cx: number, cy: number): number | null {
    const ray = this.raio3d(cx, cy);
    const tCasa = this.casaNoRaio(ray);
    const p = this.pontoNoChao(cx, cy, ray);
    if (tCasa && (!p || tCasa.t < p[2])) return tCasa.lote;
    if (!p) return null;
    const k = loteNoPonto(this.res, this.cena.grade, [p[0], p[1]]);
    return k >= 0 ? k : null;
  }

  /** Raio contra as caixas das casas (no referencial de cada casa). */
  private casaNoRaio(ray: THREE.Ray): { t: number; lote: number } | null {
    if (!this.grupoCasas.visible || this.U.uCresce.value < 0.5) return null;
    let melhor: { t: number; lote: number } | null = null;
    const ex = this.U.uExag.value, ref = this.U.uRef.value;
    for (const c of this.cena.casas) {
      if (c.lote < 0) continue;
      const [x, z] = this.xz(c.c);
      // eixos da casa no mundo: u (plano) → (u0, −u1); v = esquerda(u)
      const ux = c.u[0], uz = -c.u[1], vx = -c.u[1], vz = -c.u[0];
      const ox = ray.origin.x - x, oz = ray.origin.z - z;
      const o = [ox * ux + oz * uz, ray.origin.y, ox * vx + oz * vz];
      const d = [ray.direction.x * ux + ray.direction.z * uz, ray.direction.y, ray.direction.x * vx + ray.direction.z * vz];
      const y0 = (c.piso - ref) * ex, y1 = y0 + (c.volumes ? Math.max(...c.volumes.map((v) => v.y1)) : c.andares * 2.9 + 1.5);
      const lo = [-c.larg / 2, y0, -c.prof / 2], hi = [c.larg / 2, y1, c.prof / 2];
      let t0 = 0, t1 = Infinity;
      for (let a = 0; a < 3 && t0 <= t1; a++) {
        if (Math.abs(d[a]) < 1e-9) { if (o[a] < lo[a] || o[a] > hi[a]) t0 = Infinity; continue; }
        const ta = (lo[a] - o[a]) / d[a], tb = (hi[a] - o[a]) / d[a];
        t0 = Math.max(t0, Math.min(ta, tb)); t1 = Math.min(t1, Math.max(ta, tb));
      }
      if (t0 <= t1 && Number.isFinite(t0) && (!melhor || t0 < melhor.t)) melhor = { t: t0, lote: c.lote };
    }
    return melhor;
  }

  /** Ponto do chão sob o cursor (plano) e a distância ao longo do raio. */
  pontoNoChao(cx: number, cy: number, ray = this.raio3d(cx, cy)): [number, number, number] | null {
    const o = ray.origin, d = ray.direction;
    const g = this.cena.grade;
    const passo = g.passo * 0.6;
    const plano = (t: number): Pt => [o.x + d.x * t + this.centro[0], -(o.z + d.z * t) + this.centro[1]];
    const acima = (t: number) => o.y + d.y * t - this.alturaMundo(plano(t));
    const maxT = this.raio * 12;
    let t0 = 0;
    // pula até perto do bloco (descida vertical rápida)
    if (d.y < 0) t0 = Math.max(0, (o.y - (this.cena.cotaMax - this.U.uRef.value) * this.U.uExag.value - 5) / -d.y);
    let ant = acima(t0);
    for (let t = t0 + passo; t < maxT; t += passo) {
      const v = acima(t);
      if (v <= 0 && ant > 0) {
        let a = t - passo, b = t;
        for (let s = 0; s < 8; s++) { const m = (a + b) / 2; if (acima(m) > 0) a = m; else b = m; }
        const p = plano(b);
        if (p[0] < g.x0 || p[1] < g.y0 || p[0] > g.x0 + (g.nx - 1) * g.passo || p[1] > g.y0 + (g.ny - 1) * g.passo) return null;
        return [p[0], p[1], b];
      }
      ant = v;
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Controles
  // -------------------------------------------------------------------------

  /** Exagero vertical (a cortina de seleção usa os mesmos uniforms e acompanha sozinha). */
  setExagero(e: number): void { this.U.uExag.value = e; this.sombraSuja = true; this.sujo = 3; }

  setVisivel(camada: "casas" | "arvores" | "meioFio", v: boolean): void {
    const o = camada === "casas" ? this.grupoCasas : camada === "arvores" ? this.grupoArvores : this.meioFio;
    if (o) o.visible = v;
    this.sombraSuja = true;
    this.sujo = 3;
  }

  setSombras(v: boolean): void {
    this.renderer.shadowMap.enabled = v;
    this.sombraSuja = true;
    this.scene.traverse((o) => { const m = (o as THREE.Mesh).material as THREE.Material | undefined; if (m) m.needsUpdate = true; });
    this.sujo = 3;
  }

  atualizarChao(): void { this.texProjeto.needsUpdate = true; this.sujo = 3; }

  /** Leva a câmera até o lote (de lado, na altura de um drone baixo). */
  focarLote(idx: number): void {
    const l = this.res.lotes[idx];
    if (!l) return;
    const c = centroide(l.pol.ext);
    const [x, z] = this.xz(c);
    const y = this.alturaMundo(c);
    const alvo = new THREE.Vector3(x, y, z);
    const dir = this.camera.position.clone().sub(this.controls.target).setY(0).normalize();
    const dist0 = 45 + Math.sqrt(l.area) * 1.3;
    const pos = alvo.clone().add(dir.multiplyScalar(dist0)).setY(y + dist0 * 0.62);
    this.voarPara(pos, alvo, 1600);
  }

  /** Distância para a gleba caber na tela (celular em pé precisa de mais). */
  private distanciaQueCabe(folga: number): number {
    const meia = Math.tan(((this.camera.fov / 2) * Math.PI) / 180);
    return (this.raio * folga) / (meia * Math.min(1, this.camera.aspect));
  }

  private posGeral(): THREE.Vector3 {
    // tela em pé (celular): mais de cima, senão sobra céu e o loteamento fica pequeno
    const dir = this.camera.aspect < 0.8 ? new THREE.Vector3(-0.75, 1.7, 0.95) : new THREE.Vector3(-1.15, 1.05, 1.45);
    return dir.normalize().multiplyScalar(this.distanciaQueCabe(this.camera.aspect < 0.8 ? 0.95 : 0.85));
  }

  visaoGeral(): void {
    const alvo = new THREE.Vector3(0, this.alturaMundo(this.centro) * 0.6, 0);
    this.voarPara(this.posGeral(), alvo, 1600);
  }

  vistaDeCima(): void {
    const alvo = new THREE.Vector3(0, this.alturaMundo(this.centro), 0);
    // norte para cima (a câmera um tico ao sul)
    this.voarPara(new THREE.Vector3(0, this.distanciaQueCabe(1.12), 0.01), alvo, 1600);
  }

  private voarPara(pos: THREE.Vector3, alvo: THREE.Vector3, ms: number): void {
    const p0 = this.camera.position.clone(), a0 = this.controls.target.clone();
    this.animar(ms, (t) => {
      const s = t * t * (3 - 2 * t);
      this.camera.position.lerpVectors(p0, pos, s);
      // arco: sobe no meio do caminho
      this.camera.position.y += Math.sin(Math.PI * s) * p0.distanceTo(pos) * 0.15;
      this.controls.target.lerpVectors(a0, alvo, s);
    });
  }

  /** Gravando o voo: nada pode trocar a animação (o fim dela é que para o gravador). */
  get gravando(): boolean { return !!this.gravador; }

  private animar(ms: number, passo: (t: number) => void, fim?: () => void, aoInterromper?: () => void, forcar = false): boolean {
    if (this.gravador && !forcar) return false;
    const ant = this.anim;
    if (ant?.aoInterromper) { ant.aoInterromper(); this.sombraSuja = true; }
    this.anim = { t0: performance.now(), dur: ms, passo, fim, aoInterromper };
    this.ev.onAnimacao?.(true, 0);
    return true;
  }

  pararAnimacao(): void {
    if (!this.anim || this.gravador) return;
    const ant = this.anim;
    this.anim = null;
    // a abertura e o Hoje/Projeto não podem ficar pela metade (casas sumidas, chão misturado)
    ant.aoInterromper?.();
    this.sombraSuja = true;
    this.sujo = Math.max(this.sujo, 2);
    this.ev.onAnimacao?.(false, 1);
  }

  /** Sai do modo cinema (fim do roteiro ou interrompido). */
  private sairDoCinema(): void {
    if (!this.cinema) return;
    this.cinema = null;
    this.movimento = false;
    this.ev.onLegenda?.(null, 0);
    this.ev.onCartela?.(null);
    this.ev.onCinema?.(false);
  }

  private projetoPronto = () => { this.U.uMistura.value = 1; this.U.uMisturaCor.value = 1; this.U.uCresce.value = 1; this.sombraSuja = true; };

  /** Transição hoje → projeto (o miolo da abertura e da apresentação), em `t` de 0 a 1. */
  private transicao(t: number): void {
    const seg = (a: number, b: number) => { const x = Math.max(0, Math.min(1, (t - a) / (b - a))); return x * x * (3 - 2 * x); };
    const mc = seg(0.12, 0.42), mi = seg(0.18, 0.5), cr = seg(0.45, 0.98);
    if (mi !== this.U.uMistura.value || cr !== this.U.uCresce.value) this.sombraSuja = true;
    this.U.uMisturaCor.value = mc;
    this.U.uMistura.value = mi;
    this.U.uCresce.value = cr;
  }

  /**
   * Apresentação: vista geral no terreno de hoje, a transição para o projeto e
   * o voo de drone. É também o roteiro do vídeo.
   */
  apresentacao(aoFim?: () => void, forcar = false): number {
    if (this.gravador && !forcar) return 0;
    // o sol anda da manhã ao pôr do sol durante o voo: as janelas e os postes acendem no fim
    return this.rodarRoteiro(true, [7.6, 17.85], aoFim, forcar);
  }

  /** Roteiro de cinema: câmera, legendas, transformação, timelapse e carros andando. */
  private rodarRoteiro(abertura: boolean, timelapse: [number, number] | null, aoFim: (() => void) | undefined, forcar: boolean): number {
    this.anim = null;
    this.selecionar(null);
    const r = roteiroDoVoo({
      res: this.res, cena: this.cena, raio: this.raio, aspecto: this.camera.aspect,
      xz: (p) => this.xz(p),
      chao: (p) => (cotaFinal(this.cena.grade, p) - this.U.uRef.value) * this.U.uExag.value,
    }, abertura);
    if (abertura) { this.U.uMistura.value = 0; this.U.uMisturaCor.value = 0; this.U.uCresce.value = 0; this.sombraSuja = true; }
    this.cinema = { r, t0: performance.now(), timelapse, ultimaHora: 0, legenda: { l: null, alfa: 0 }, fase: null };
    this.movimento = true;
    this.ev.onCinema?.(true);
    const final = () => {
      if (abertura) this.projetoPronto();
      // a apresentação termina no pôr do sol (com as luzes acesas): o controle de hora acompanha
      if (timelapse) this.ev.onHora?.(this.hora);
      this.sombraSuja = true;
      this.sairDoCinema();
    };
    const ok = this.animar(r.duracao * 1000, (t) => {
      const ts = t * r.duracao;
      // começa e termina com suavidade; no meio, o tempo do roteiro
      // tempo do roteiro com arranque e frenagem suaves (contínuo: sem salto em 1,2 s)
      const a = Math.min(1.2, r.duracao / 4), D = r.duracao, v = D / (D - a);
      const ease = ts < a ? (v * ts * ts) / (2 * a) : ts > D - a ? D - (v * (D - ts) ** 2) / (2 * a) : v * (ts - a / 2);
      const { pos, alvo } = camNoTempo(r, ease);
      this.camera.position.set(pos[0], pos[1], pos[2]);
      this.controls.target.set(alvo[0], alvo[1], alvo[2]);
      if (r.transformacao) this.transicao(Math.max(0, Math.min(1, (ts - r.transformacao[0]) / (r.transformacao[1] - r.transformacao[0]))));
      if (timelapse && this.cinema) {
        const f = Math.max(0, Math.min(1, (ts - r.voo[0]) / (r.voo[1] - r.voo[0])));
        const h = timelapse[0] + (timelapse[1] - timelapse[0]) * f * f * (3 - 2 * f);
        if (Math.abs(h - this.cinema.ultimaHora) > 0.02) { this.cinema.ultimaHora = h; this.setHora(h); }
      }
      const fase = abertura && ts < 5.6 ? "abertura" : ts > r.duracao - 5 ? "fecho" : null;
      if (this.cinema && fase !== this.cinema.fase) { this.cinema.fase = fase; this.ev.onCartela?.(fase); }
      const lg = legendaNoTempo(r, ts);
      if (this.cinema) {
        const ant = this.cinema.legenda;
        const novo = { l: lg?.legenda ?? null, alfa: lg?.alfa ?? 0 };
        if (novo.l !== ant.l || Math.abs(novo.alfa - ant.alfa) > 0.04) { this.cinema.legenda = novo; this.ev.onLegenda?.(novo.l, novo.alfa); }
      }
    }, () => { final(); aoFim?.(); }, final, forcar);
    if (!ok) { final(); return 0; }
    return r.duracao;
  }

  /** Abertura: o terreno de hoje (satélite) vira o projeto; as casas sobem e as árvores crescem. */
  abertura(): void {
    this.U.uMistura.value = 0; this.U.uMisturaCor.value = 0; this.U.uCresce.value = 0;
    const p0 = this.camera.position.clone();
    const ang = 0.45;
    this.animar(9000, (t) => {
      this.transicao(t);
      // giro lento da câmera em volta da maquete
      const a = ang * (t - 0.5) * 2 * 0.5;
      const v = p0.clone().sub(this.controls.target);
      v.applyAxisAngle(new THREE.Vector3(0, 1, 0), -a);
      this.camera.position.copy(this.controls.target).add(v);
    }, this.projetoPronto, this.projetoPronto);
  }

  /** Antes (terreno de hoje) ↔ depois (projeto), animado. */
  alternarAntes(depois: boolean): void {
    const m0 = this.U.uMistura.value, c0 = this.U.uCresce.value;
    this.animar(2600, (t) => {
      const s = t * t * (3 - 2 * t);
      this.sombraSuja = true;
      if (depois) {
        this.U.uMistura.value = this.U.uMisturaCor.value = Math.min(1, m0 + (1 - m0) * Math.min(1, s * 1.8));
        this.U.uCresce.value = Math.max(0, Math.min(1, (s - 0.35) / 0.65));
      } else {
        this.U.uCresce.value = c0 * Math.max(0, 1 - s * 2);
        this.U.uMistura.value = this.U.uMisturaCor.value = m0 * Math.max(0, Math.min(1, 1 - (s - 0.3) / 0.7));
      }
    }, () => {
      const v = depois ? 1 : 0;
      this.U.uMistura.value = this.U.uMisturaCor.value = this.U.uCresce.value = v;
    }, () => {
      const v = depois ? 1 : 0;
      this.U.uMistura.value = this.U.uMisturaCor.value = this.U.uCresce.value = v;
    });
  }

  /**
   * Voo de drone: aproximação em espiral, passeio baixo pela rua mais longa
   * e subida para a vista geral. `aoFim` quando terminar.
   */
  /** Voo de drone: o tour de cinema pelo projeto (rua de entrada, área verde, institucional, miolo). */
  voo(aoFim?: () => void, forcar = false): number {
    if (this.gravador && !forcar) return 0;
    return this.rodarRoteiro(false, null, aoFim, forcar);
  }

  setCartela(c: Cartela): void { this.cartela = c; }

  /**
   * Vídeo pronto para o cliente (MP4 se o navegador souber, senão WebM):
   * cartela com o nome do empreendimento, o terreno de hoje virando o
   * projeto, o voo de drone e a cartela final com os números.
   */
  gravarVoo(audio?: { faixa: MediaStreamTrack | null; tocar: (duracao: number) => void }): Promise<{ blob: Blob; ext: string }> {
    return new Promise((ok, falha) => {
      const comSom = !!audio?.faixa;
      const tipos = comSom
        ? ["video/mp4;codecs=avc1.640028,mp4a.40.2", "video/mp4;codecs=avc1,mp4a.40.2", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/mp4", "video/webm"]
        : ["video/mp4;codecs=avc1.640028", "video/mp4", "video/webm;codecs=vp9", "video/webm"];
      const tipo = tipos.find((t) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t));
      if (!tipo) { falha(new Error("Este navegador não grava vídeo do canvas.")); return; }
      if (this.gravador) { falha(new Error("Já está gravando.")); return; }
      this.pararAnimacao();
      // o vídeo sai do canvas composto (3D + cartelas), sem o destaque de seleção
      const gl = this.renderer.domElement;
      const canvas = Object.assign(document.createElement("canvas"), { width: gl.width, height: gl.height });
      this.comp = { canvas, ctx: canvas.getContext("2d")!, t0: performance.now(), tFim: 0 };
      for (const c of [this.cortina, this.cortinaPasso]) if (c) c.visible = false;
      const stream = canvas.captureStream(30);
      if (audio?.faixa) stream.addTrack(audio.faixa.clone());
      this.stream = stream;
      const rec = new MediaRecorder(stream, { mimeType: tipo, videoBitsPerSecond: 4_500_000 });
      const partes: Blob[] = [];
      const soltar = () => {
        this.gravador = null; this.comp = null;
        stream.getTracks().forEach((t) => t.stop()); this.stream = null;
        for (const c of [this.cortina, this.cortinaPasso]) if (c) c.visible = true;
        this.sujo = 3;
      };
      rec.ondataavailable = (e) => { if (e.data.size) partes.push(e.data); };
      rec.onerror = () => { soltar(); this.pararAnimacao(); falha(new Error("A gravação do vídeo falhou neste navegador.")); };
      rec.onstop = () => {
        soltar();
        // maquete fechada no meio da gravação: não sobe download depois
        if (this.destruida) { falha(new Error("Gravação cancelada.")); return; }
        ok({ blob: new Blob(partes, { type: tipo.split(";")[0] }), ext: tipo.startsWith("video/mp4") ? "mp4" : "webm" });
      };
      this.gravador = rec;
      rec.start(500);
      // a cartela final fica 3,5 s na tela depois do voo
      const fim = () => { if (this.comp) this.comp.tFim = performance.now(); setTimeout(() => { if (rec.state !== "inactive") rec.stop(); }, 3500); };
      const dur = this.apresentacao(fim, true);
      if (!dur) { rec.stop(); falha(new Error("Não deu para iniciar o voo.")); return; }
      audio?.tocar(dur + 3.4);
    });
  }

  /** Quadro do vídeo: o 3D e, por cima, as cartelas de abertura e de fecho. */
  private comporVideo(): void {
    const c = this.comp;
    if (!c) return;
    const { ctx, canvas } = c;
    const W = canvas.width, H = canvas.height, k = H / 1080;
    ctx.drawImage(this.renderer.domElement, 0, 0, W, H);
    const agora = performance.now();
    const ab = (agora - c.t0) / 1000;
    // faixas de cinema (2,35:1) que entram no começo
    const faixa = H * 0.105 * Math.min(1, ab / 1.2);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, faixa);
    ctx.fillRect(0, H - faixa, W, faixa);
    // legenda do roteiro (terço inferior, acima da faixa)
    const lg = this.cinema?.legenda;
    if (lg?.l && lg.alfa > 0 && !c.tFim) {
      ctx.save();
      ctx.globalAlpha = lg.alfa;
      const x = 80 * k, y = H - faixa - 70 * k;
      // degradê escuro atrás (a legenda não some sobre grama e terra claras)
      ctx.font = `500 ${Math.round(26 * k)}px Inter, system-ui, sans-serif`;
      const larg = Math.max(ctx.measureText(lg.l.texto).width * 1.25, 900 * k);
      const gd = ctx.createLinearGradient(x, 0, x + larg, 0);
      gd.addColorStop(0, "rgba(8,10,14,0.66)"); gd.addColorStop(0.6, "rgba(8,10,14,0.4)"); gd.addColorStop(1, "rgba(8,10,14,0)");
      ctx.fillStyle = gd;
      ctx.fillRect(x, y - 78 * k, larg, 124 * k);
      ctx.fillStyle = "#ffc533";
      ctx.fillRect(x, y - 58 * k, 5 * k, 82 * k);
      ctx.fillStyle = "#fff";
      ctx.font = `700 ${Math.round(46 * k)}px Inter, system-ui, sans-serif`;
      ctx.shadowColor = "rgba(0,0,0,0.6)"; ctx.shadowBlur = 12 * k;
      ctx.fillText(lg.l.titulo, x + 22 * k, y - 16 * k);
      ctx.font = `500 ${Math.round(26 * k)}px Inter, system-ui, sans-serif`;
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.fillText(lg.l.texto, x + 22 * k, y + 22 * k);
      ctx.restore();
    }
    // abertura: nome do empreendimento no canto, entra e sai
    const aA = ab < 0.6 ? ab / 0.6 : ab < 4.2 ? 1 : Math.max(0, 1 - (ab - 4.2) / 0.8);
    if (aA > 0) {
      ctx.save();
      ctx.globalAlpha = aA;
      const g = ctx.createLinearGradient(0, H * 0.62, 0, H);
      g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(0,0,0,0.65)");
      ctx.fillStyle = g; ctx.fillRect(0, H * 0.62, W, H * 0.38);
      const base = H - faixa - 60 * k;
      ctx.fillStyle = "#ffc533"; ctx.fillRect(80 * k, base - 140 * k, 70 * k, 6 * k);
      ctx.fillStyle = "#fff";
      ctx.font = `750 ${Math.round(72 * k)}px Inter, system-ui, sans-serif`;
      ctx.fillText(this.cartela.nome, 80 * k, base - 52 * k);
      ctx.font = `500 ${Math.round(30 * k)}px Inter, system-ui, sans-serif`;
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.fillText("Loteamento · maquete 3D", 80 * k, base);
      ctx.restore();
    }
    // fecho: cartela no centro
    if (c.tFim) {
      const af = Math.min(1, (agora - c.tFim) / 700);
      ctx.save();
      ctx.globalAlpha = af;
      ctx.fillStyle = "rgba(12,16,22,0.72)"; ctx.fillRect(0, 0, W, H);
      ctx.textAlign = "center";
      ctx.fillStyle = "#ffc533"; ctx.fillRect(W / 2 - 40 * k, H / 2 - 120 * k, 80 * k, 6 * k);
      ctx.fillStyle = "#fff";
      ctx.font = `750 ${Math.round(76 * k)}px Inter, system-ui, sans-serif`;
      ctx.fillText(this.cartela.nome, W / 2, H / 2 - 20 * k);
      ctx.font = `500 ${Math.round(32 * k)}px Inter, system-ui, sans-serif`;
      ctx.fillStyle = "rgba(255,255,255,0.88)";
      ctx.fillText(this.cartela.linha, W / 2, H / 2 + 40 * k);
      ctx.font = `500 ${Math.round(22 * k)}px Inter, system-ui, sans-serif`;
      ctx.fillStyle = "rgba(255,255,255,0.6)";
      ctx.fillText(this.cartela.rodape, W / 2, H / 2 + 100 * k);
      ctx.restore();
    }
  }

  /** Foto em alta (2× a tela). */
  async foto(): Promise<Blob | null> {
    const pr = this.renderer.getPixelRatio();
    this.renderer.setPixelRatio(Math.min(4, this.prMax * 2));
    this.renderer.setSize(this.caixa.clientWidth, this.caixa.clientHeight, false);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(this.caixa.clientWidth, this.caixa.clientHeight);
    this.desenhar();
    const blob = await new Promise<Blob | null>((ok) => this.renderer.domElement.toBlob(ok, "image/png"));
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(this.caixa.clientWidth, this.caixa.clientHeight, false);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(this.caixa.clientWidth, this.caixa.clientHeight);
    this.sujo = 3;
    return blob;
  }

  /**
   * Modelo para SketchUp/Blender/Twinmotion (glTF binário): a geometria é
   * "assada" (no app quem eleva é o shader), na altura REAL — sem o exagero
   * da tela, senão o relevo sai distorcido e as casas não. Árvores vão
   * mescladas com cor por vértice: instâncias exigiriam uma extensão que
   * parte dos programas recusa.
   */
  async exportarGlb(): Promise<Blob> {
    const g = this.cena.grade, ex = 1, ref = this.U.uRef.value;
    const grupo = new THREE.Group();
    grupo.name = "Loteamento";
    // terreno com a textura do projeto, com no máximo ~90 mil nós (o modelo de
    // elevação de origem tem 8 m: pular nós não perde relevo e o arquivo cai a 1/4)
    const passoNo = Math.max(1, Math.ceil(Math.sqrt((g.nx * g.ny) / 90000)));
    const is: number[] = [], js: number[] = [];
    for (let i = 0; i < g.nx; i += passoNo) is.push(i);
    if (is[is.length - 1] !== g.nx - 1) is.push(g.nx - 1);
    for (let j = 0; j < g.ny; j += passoNo) js.push(j);
    if (js[js.length - 1] !== g.ny - 1) js.push(g.ny - 1);
    const W = is.length, Hn = js.length;
    const pos = new Float32Array(W * Hn * 3), uvs = new Float32Array(W * Hn * 2), idx: number[] = [];
    js.forEach((j, b) => is.forEach((i, a) => {
      const k = j * g.nx + i, v = b * W + a;
      const [x, z] = this.xz([g.x0 + i * g.passo, g.y0 + j * g.passo]);
      pos[v * 3] = x; pos[v * 3 + 1] = (g.final[k] - ref) * ex; pos[v * 3 + 2] = z;
      uvs[v * 2] = i / (g.nx - 1); uvs[v * 2 + 1] = j / (g.ny - 1);
    }));
    for (let b = 0; b + 1 < Hn; b++) for (let a = 0; a + 1 < W; a++) {
      const p = b * W + a;
      idx.push(p, p + 1, p + W, p + 1, p + W + 1, p + W);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const terreno = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: this.texProjeto, roughness: 0.93 }));
    terreno.name = "Terreno";
    grupo.add(terreno);
    // casas e meio-fio
    for (const m of [...this.grupoCasas.children, ...(this.meioFio ? [this.meioFio] : [])] as THREE.Mesh[]) {
      const gg = m.geometry.clone();
      const p = gg.getAttribute("position") as THREE.BufferAttribute, b = gg.getAttribute("aBase") as THREE.BufferAttribute;
      for (let k = 0; k < p.count; k++) { const y = p.getY(k); p.setY(k, (y < 0 ? y * ex : y) + (b.getX(k) - ref) * ex); }
      gg.deleteAttribute("aBase"); gg.deleteAttribute("aAtraso");
      const src = m.material as THREE.MeshStandardMaterial;
      const mm = new THREE.Mesh(gg, new THREE.MeshStandardMaterial({ vertexColors: src.vertexColors, map: src.map, color: src.color, roughness: src.roughness, side: THREE.DoubleSide }));
      mm.name = m === this.meioFio ? "MeioFio" : "Casas";
      grupo.add(mm);
    }
    // árvores: cada instância vira geometria (altura somada na matriz) com a cor no vértice
    const partes: THREE.BufferGeometry[] = [];
    const m4 = new THREE.Matrix4(), c = new THREE.Color();
    for (const im of [...this.grupoArvores.children, ...this.grupoPostes.children] as THREE.InstancedMesh[]) {
      if (im.material === this.matPoca) continue;
      const corMat = (im.material as THREE.MeshStandardMaterial).color;
      const base = im.geometry.getAttribute("aBase") as THREE.InstancedBufferAttribute;
      const molde = im.geometry.index ? im.geometry.toNonIndexed() : im.geometry.clone();
      for (const a of Object.keys(molde.attributes)) if (a !== "position" && a !== "normal") molde.deleteAttribute(a);
      for (let i = 0; i < im.count; i++) {
        im.getMatrixAt(i, m4);
        m4.elements[13] += (base.getX(i) - ref) * ex;
        const gg = molde.clone().applyMatrix4(m4);
        if (im.instanceColor) im.getColorAt(i, c); else c.copy(corMat);
        const cores = new Float32Array(gg.getAttribute("position").count * 3);
        for (let k = 0; k < cores.length; k += 3) { cores[k] = c.r; cores[k + 1] = c.g; cores[k + 2] = c.b; }
        gg.setAttribute("color", new THREE.BufferAttribute(cores, 3));
        partes.push(gg);
      }
      molde.dispose();
    }
    if (partes.length) {
      const arv = new THREE.Mesh(mergeGeometries(partes)!, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true }));
      arv.name = "Arvores";
      grupo.add(arv);
      partes.forEach((p) => p.dispose());
    }
    const r = await new GLTFExporter().parseAsync(grupo, { binary: true, maxTextureSize: 2048 });
    grupo.traverse((o) => { const m = o as THREE.Mesh; m.geometry?.dispose(); (m.material as THREE.Material | undefined)?.dispose(); });
    return new Blob([r as ArrayBuffer], { type: "model/gltf-binary" });
  }

  // -------------------------------------------------------------------------
  // Laço
  // -------------------------------------------------------------------------

  private redimensionar(): void {
    const w = this.caixa.clientWidth, h = this.caixa.clientHeight;
    if (!w || !h) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.sujo = 3;
  }

  /** Desenha o quadro: com brilho no crepúsculo (pós-processamento), direto de dia. */
  private desenhar(): void {
    if (this.sombraSuja) { this.renderer.shadowMap.needsUpdate = true; this.sombraSuja = false; }
    if (this.bloom.strength > 0.02) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  /** Resolução adaptativa: em movimento, se o quadro passa de ~24 ms, baixa; parado, volta a nitidez total. */
  private ajustarResolucao(agora: number, desenhou: boolean): void {
    if (this.gravador) return;
    if (desenhou) {
      const dt = agora - this.ultimoDesenho;
      if (dt < 120) this.emaQuadro = this.emaQuadro * 0.85 + dt * 0.15;
      this.ultimoDesenho = agora;
      if (this.emaQuadro > 24 && this.prAtual > 1) {
        this.prAtual = Math.max(1, this.prAtual - 0.25);
        this.renderer.setPixelRatio(this.prAtual);
        this.composer.setPixelRatio(this.prAtual);
        this.emaQuadro = 16;
      }
    } else if (this.prAtual < this.prMax && agora - this.ultimoDesenho > 350) {
      this.prAtual = this.prMax;
      this.renderer.setPixelRatio(this.prMax);
      this.composer.setPixelRatio(this.prMax);
      this.sujo = 2;
    }
  }

  // -------------------------------------------------------------------------
  // Carros e postes
  // -------------------------------------------------------------------------

  private montarCarros(): void {
    const ruas = this.res.ruas.map((r, i) => ({ r, i, L: comprimento(r.eixo) })).filter((x) => x.L > 40);
    if (!ruas.length) return;
    const lista: { rua: number; s: number; sentido: number; vel: number }[] = [];
    let semente = 7;
    const rnd = () => { semente = (semente * 16807) % 2147483647; return semente / 2147483647; };
    for (const x of ruas) {
      const n = Math.max(1, Math.floor(x.L / 75));
      for (let k = 0; k < n && lista.length < 90; k++) lista.push({ rua: x.i, s: x.L * ((k + 0.3 + rnd() * 0.4) / n), sentido: rnd() < 0.5 ? 1 : -1, vel: 7 + rnd() * 5 });
    }
    // carroceria (cor da instância) e cabine com vidro escuro
    const corpo = new THREE.BoxGeometry(4.2, 0.95, 1.8).translate(0, 0.62, 0);
    const cabine = new THREE.BoxGeometry(2.2, 0.72, 1.62).translate(-0.25, 1.45, 0);
    const pinta = (g: THREE.BufferGeometry, c: number) => { const n = g.getAttribute("position").count; const a = new Float32Array(n * 3).fill(c); g.setAttribute("color", new THREE.BufferAttribute(a, 3)); return g; };
    const geo = mergeGeometries([pinta(corpo.toNonIndexed(), 1), pinta(cabine.toNonIndexed(), 0.16)])!;
    corpo.dispose(); cabine.dispose();
    const mat = elevar(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.4 }), "instancia", this.U);
    const im = new THREE.InstancedMesh(geo, mat, lista.length);
    const cores = [0xf2f2f2, 0xd9d9d9, 0x2b2d31, 0x8a1c1c, 0x1f4e8c, 0x9aa1a8, 0xf2f2f2, 0x2b2d31, 0xc9b27a];
    const c = new THREE.Color();
    lista.forEach((_, i) => im.setColorAt(i, c.setHex(cores[i % cores.length])));
    const base = new THREE.InstancedBufferAttribute(new Float32Array(lista.length), 1);
    geo.setAttribute("aBase", base);
    geo.setAttribute("aAtraso", new THREE.InstancedBufferAttribute(new Float32Array(lista.length).fill(0.6), 1));
    im.frustumCulled = false;
    im.receiveShadow = true;
    this.carros = { im, base, lista };
    this.posicionarCarros(0);
    this.scene.add(im);
  }

  /** Anda com os carros `dt` segundos (na ponta da rua, fazem o retorno pela outra mão). */
  private posicionarCarros(dt: number): void {
    const cs = this.carros;
    if (!cs) return;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), um = new THREE.Vector3(1, 1, 1), eixoY = new THREE.Vector3(0, 1, 0);
    const meia = this.cena.larguraPista / 4;
    cs.lista.forEach((c, i) => {
      const r = this.res.ruas[c.rua];
      const L = comprimento(r.eixo);
      c.s += c.vel * c.sentido * dt;
      if (c.s > L - 4) { c.s = L - 4; c.sentido = -1; }
      if (c.s < 4) { c.s = 4; c.sentido = 1; }
      const { pt, dir } = pontoNaPolilinha(r.eixo, c.s);
      const d: Pt = [dir[0] * c.sentido, dir[1] * c.sentido];
      // mão de direção: à direita de quem vai
      const p: Pt = [pt[0] + d[1] * meia, pt[1] - d[0] * meia];
      const [x, z] = this.xz(p);
      q.setFromAxisAngle(eixoY, Math.atan2(d[1], d[0]));
      m4.compose(new THREE.Vector3(x, 0, z), q, um);
      cs.im.setMatrixAt(i, m4);
      cs.base.setX(i, cotaFinal(this.cena.grade, p));
    });
    cs.im.instanceMatrix.needsUpdate = true;
    cs.base.needsUpdate = true;
  }

  private montarPostes(): void {
    const ps = this.cena.postes;
    if (!ps.length) return;
    const poste = mergeGeometries([
      new THREE.CylinderGeometry(0.07, 0.11, 7, 6).translate(0, 3.5, 0).toNonIndexed(),
      new THREE.BoxGeometry(1.7, 0.08, 0.08).translate(0.8, 6.95, 0).toNonIndexed(),
    ])!;
    const cabeca = new THREE.BoxGeometry(0.62, 0.14, 0.32).translate(1.55, 6.86, 0);
    // poça de luz no chão (mancha quente, aditiva) — acende com a noite
    const poca = new THREE.PlaneGeometry(12, 12).rotateX(-Math.PI / 2).translate(1.8, 0.18, 0);
    const pc = document.createElement("canvas");
    pc.width = pc.height = 128;
    const px = pc.getContext("2d")!;
    const rg = px.createRadialGradient(64, 64, 0, 64, 64, 64);
    rg.addColorStop(0, "rgba(255,206,140,1)"); rg.addColorStop(0.35, "rgba(255,180,110,0.55)"); rg.addColorStop(1, "rgba(255,160,90,0)");
    px.fillStyle = rg; px.fillRect(0, 0, 128, 128);
    const tPoca = new THREE.CanvasTexture(pc);
    tPoca.colorSpace = THREE.SRGBColorSpace;
    this.matPoca = elevar(new THREE.MeshBasicMaterial({
      map: tPoca, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -4,
    }), "instancia", this.U);
    const matPoste = elevar(new THREE.MeshStandardMaterial({ color: 0x6f747a, roughness: 0.6, metalness: 0.5 }), "instancia", this.U);
    this.matLampada = elevar(new THREE.MeshStandardMaterial({ color: 0xdedede, emissive: 0xffc98a, emissiveIntensity: 0.3, roughness: 0.4 }), "instancia", this.U);
    const eixoY = new THREE.Vector3(0, 1, 0), q = new THREE.Quaternion(), m4 = new THREE.Matrix4(), um = new THREE.Vector3(1, 1, 1);
    for (const [geo, mat] of [[poste, matPoste], [cabeca, this.matLampada], [poca, this.matPoca]] as const) {
      const im = new THREE.InstancedMesh(geo, mat, ps.length);
      const base = new Float32Array(ps.length), atraso = new Float32Array(ps.length);
      ps.forEach((p, i) => {
        const [x, z] = this.xz(p.p);
        q.setFromAxisAngle(eixoY, Math.atan2(p.dir[1], p.dir[0]));
        m4.compose(new THREE.Vector3(x, 0, z), q, um);
        im.setMatrixAt(i, m4);
        base[i] = p.z;
        atraso[i] = Math.min(1, dist(p.p, this.centro) / this.raio) * 0.8;
      });
      geo.setAttribute("aBase", new THREE.InstancedBufferAttribute(base, 1));
      geo.setAttribute("aAtraso", new THREE.InstancedBufferAttribute(atraso, 1));
      im.castShadow = mat !== this.matPoca;
      if (im.castShadow) im.customDepthMaterial = sombraDe("instancia", this.U);
      im.frustumCulled = false;
      if (mat === this.matPoca) im.renderOrder = 2;
      this.grupoPostes.add(im);
    }
  }

  private quadro(agora: number): void {
    if (this.anim) {
      const t = Math.min(1, (agora - this.anim.t0) / this.anim.dur);
      this.anim.passo(t);
      this.ev.onAnimacao?.(true, t);
      if (t >= 1) {
        const fim = this.anim.fim;
        this.anim = null;
        fim?.();
        this.ev.onAnimacao?.(false, 1);
      }
      this.sujo = 2;
    }
    const mudou = this.controls.update();
    if (mudou) this.sujo = Math.max(this.sujo, 1);
    // gravando: todo quadro conta
    if (this.gravador) this.sujo = Math.max(this.sujo, 1);
    const dt = Math.min(0.1, (agora - (this.ultimoT || agora)) / 1000);
    this.ultimoT = agora;
    if (this.movimento && this.carros) { this.posicionarCarros(dt); this.sujo = Math.max(this.sujo, 1); }
    if (this.sujo <= 0) { this.ajustarResolucao(agora, false); return; }
    this.sujo--;
    this.desenhar();
    this.ajustarResolucao(agora, true);
    this.comporVideo();
    this.emitirRotulos();
  }

  private emitirRotulos(): void {
    // bússola: rumo da câmera (0 = olhando para o norte, −z)
    const f = this.controls.target.clone().sub(this.camera.position);
    const rumo = Math.atan2(f.x, -f.z);
    if (this.ev.onBussola && !(Math.abs(rumo - this.ultimoRumo) < 0.005)) { this.ultimoRumo = rumo; this.ev.onBussola(rumo); }
    if (!this.ev.onRotulos) return;
    const r = this.renderer.domElement.getBoundingClientRect();
    const v = new THREE.Vector3();
    const cam = this.camera.position;
    const itens = this.rotulosQuadra.map((q) => {
      const [x, z] = this.xz(q.p);
      const w = new THREE.Vector3(x, this.alturaMundo(q.p) + 22, z);
      v.copy(w).project(this.camera);
      let visivel = v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05;
      // atrás do morro: a linha da câmera ao rótulo passa por baixo do terreno
      for (let s = 1; s < 20 && visivel; s++) {
        const p = cam.clone().lerp(w, s / 20);
        if (p.y < this.alturaMundo([p.x + this.centro[0], -p.z + this.centro[1]]) - 0.5) visivel = false;
      }
      return { texto: q.texto, x: ((v.x + 1) / 2) * r.width, y: ((1 - v.y) / 2) * r.height, visivel, tipo: "quadra" as const, d: cam.distanceTo(w) };
    });
    // sem amontoar: o mais perto ganha, o outro some
    const mostrados: { x: number; y: number }[] = [];
    for (const it of [...itens].sort((a, b) => a.d - b.d)) {
      if (!it.visivel) continue;
      if (mostrados.some((m) => Math.hypot(m.x - it.x, m.y - it.y) < 38)) { it.visivel = false; continue; }
      mostrados.push(it);
    }
    const out: Rotulo[] = itens.map(({ texto, x, y, visivel, tipo }) => ({ texto, x, y, visivel, tipo }));
    const chave = out.map((x) => `${x.visivel ? 1 : 0}${Math.round(x.x)},${Math.round(x.y)}`).join("|");
    if (chave === this.ultimosRotulos) return;
    this.ultimosRotulos = chave;
    this.ev.onRotulos(out);
  }
  private ultimosRotulos = "";

  destruir(): void {
    this.destruida = true;
    this.renderer.setAnimationLoop(null);
    this.ro.disconnect();
    clearTimeout(this.envTimer);
    if (this.gravador && this.gravador.state !== "inactive") this.gravador.stop();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.controls.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mats = (Array.isArray(m.material) ? m.material : m.material ? [m.material] : []) as THREE.Material[];
      if (m.customDepthMaterial) mats.push(m.customDepthMaterial);
      for (const mm of mats) { for (const v of Object.values(mm)) if (v instanceof THREE.Texture) v.dispose(); mm.dispose(); }
    });
    this.sol.dispose();
    this.composer.dispose();
    this.sky.geometry.dispose();
    (this.sky.material as THREE.Material).dispose();
    this.texAntes.dispose();
    this.texProjeto.dispose();
    this.envRT?.dispose();
    this.pmrem.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}
