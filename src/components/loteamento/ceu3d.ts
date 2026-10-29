// Céu da maquete 3D: três fotos HDRI do mesmo lugar (Poly Haven, CC0, série
// Qwantani "pure sky": meio-dia, fim de tarde e anoitecer) misturadas pela
// altura do sol. Cada foto é girada para o sol dela cair no azimute do sol da
// cena (latitude da gleba e hora). Serve de fundo (modo paisagem) e de luz
// ambiente/reflexo (PMREM) — o vidro das casas reflete esse céu.
import * as THREE from "three";
import { HDRLoader } from "three/examples/jsm/loaders/HDRLoader.js";

const ARQUIVOS = ["/maquete/ceu-dia.hdr", "/maquete/ceu-tarde.hdr", "/maquete/ceu-crepusculo.hdr"];
/**
 * Brilho médio do céu (sem o sol) que cada foto passa a ter: cada uma é
 * calibrada pela própria média. Com a escala do meio-dia nas três, o
 * horizonte em brasa do pôr do sol iluminava a cena demais e estourava tudo.
 */
const BRILHO_ALVO = [1.1, 0.7, 0.28];

const VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 p = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * p;
    gl_Position.z = gl_Position.w; // sempre no fundo
  }`;

const FRAG = /* glsl */ `
  uniform sampler2D t0; uniform sampler2D t1; uniform sampler2D t2;
  uniform vec3 uPeso; uniform vec3 uGiro; uniform vec3 uEscala; uniform float uTeto;
  uniform vec3 uHorizonte;
  varying vec3 vDir;
  vec3 amostra(sampler2D t, float giro, vec3 d) {
    float u = atan(d.z, d.x) / 6.2831853 + 0.5 - giro;
    float v = asin(clamp(d.y, -1.0, 1.0)) / 3.1415927 + 0.5;
    return texture2D(t, vec2(fract(u), v)).rgb;
  }
  void main() {
    vec3 d = normalize(vDir);
    // abaixo do horizonte as fotos "pure sky" não têm chão: a cor do horizonte (casa com a névoa)
    vec3 dc = vec3(d.x, max(d.y, 0.02), d.z);
    vec3 c = amostra(t0, uGiro.x, dc) * (uPeso.x * uEscala.x) + amostra(t1, uGiro.y, dc) * (uPeso.y * uEscala.y) + amostra(t2, uGiro.z, dc) * (uPeso.z * uEscala.z);
    c = min(c, vec3(uTeto));
    c = mix(c, uHorizonte, smoothstep(0.02, -0.06, d.y));
    gl_FragColor = vec4(c, 1.0);
  }`;

interface Foto {
  tex: THREE.DataTexture;
  /** ângulo do sol na foto (atan2(z, x) na convenção do shader) */
  solAng: number;
  /** cor média do horizonte (linear, já na escala) */
  horizonte: THREE.Color;
}

export class Ceu {
  readonly fundo: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private fotos: Foto[];
  private escala: THREE.Vector3;
  private peso = new THREE.Vector3(1, 0, 0);

  private constructor(fotos: Foto[], escala: THREE.Vector3, raio: number) {
    this.fotos = fotos;
    this.escala = escala;
    // fundo: o sol fica um disco claro, sem estourar (o bloom é só para luzes acesas)
    this.fundo = new THREE.Mesh(new THREE.SphereGeometry(raio, 48, 24), this.material(5));
    this.fundo.frustumCulled = false;
    this.fundo.renderOrder = -10;
  }

  /** Baixa as três fotos (≈3,4 MB). null sem rede. */
  static async carregar(raio: number): Promise<Ceu | null> {
    try {
      const ld = new HDRLoader();
      const texs = await Promise.all(ARQUIVOS.map((u) => ld.loadAsync(u)));
      const fotos = texs.map((t) => analisar(t as THREE.DataTexture));
      const k = texs.map((t, i) => BRILHO_ALVO[i] / Math.max(1e-3, brilhoMedio(t as THREE.DataTexture)));
      fotos.forEach((f, i) => f.horizonte.multiplyScalar(k[i]));
      return new Ceu(fotos, new THREE.Vector3(k[0], k[1], k[2]), raio);
    } catch (e) {
      console.warn("céu HDRI indisponível", e);
      return null;
    }
  }

  /** Material do céu; `teto` limita o disco do sol (no reflexo ele vira mancha, o sol de verdade é a luz direcional). */
  material(teto: number): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      uniforms: {
        t0: { value: this.fotos[0].tex }, t1: { value: this.fotos[1].tex }, t2: { value: this.fotos[2].tex },
        uPeso: { value: this.peso }, uGiro: { value: new THREE.Vector3() }, uEscala: { value: this.escala },
        uTeto: { value: teto }, uHorizonte: { value: new THREE.Color() },
      },
      vertexShader: VERT, fragmentShader: FRAG,
      side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
    });
  }

  /**
   * Sol da cena: direção (mundo) e elevação em graus. Ajusta pesos e giros de
   * todos os materiais dados. Devolve a cor do horizonte (para a névoa).
   */
  setSol(dir: THREE.Vector3, elG: number, mats: THREE.ShaderMaterial[]): THREE.Color {
    // meio-dia acima de 35°, fim de tarde por volta de 12°, anoitecer abaixo de 2°
    const a = Math.max(0, Math.min(1, (elG - 12) / 23));
    const b = Math.max(0, Math.min(1, (elG - 1) / 11));
    this.peso.set(a, b * (1 - a), 1 - b);
    const solAng = Math.atan2(dir.z, dir.x);
    const giro = this.fotos.map((f) => (solAng - f.solAng) / (Math.PI * 2));
    const hz = new THREE.Color(0, 0, 0);
    this.fotos.forEach((f, i) => hz.add(f.horizonte.clone().multiplyScalar(this.peso.getComponent(i))));
    for (const m of mats) {
      m.uniforms.uGiro.value.set(giro[0], giro[1], giro[2]);
      m.uniforms.uHorizonte.value.copy(hz);
    }
    return hz;
  }

  dispose(): void {
    this.fundo.geometry.dispose();
    this.fundo.material.dispose();
    for (const f of this.fotos) f.tex.dispose();
  }
}

/** Valores (linear) da textura do HDRLoader (meio float por padrão). */
function valores(t: THREE.DataTexture): { w: number; h: number; px: (i: number) => [number, number, number] } {
  const img = t.image as { width: number; height: number; data: Uint16Array | Float32Array };
  const d = img.data;
  const f = d instanceof Uint16Array ? (k: number) => THREE.DataUtils.fromHalfFloat(d[k]) : (k: number) => d[k];
  return { w: img.width, h: img.height, px: (i) => [f(i * 4), f(i * 4 + 1), f(i * 4 + 2)] };
}

/** Sol = pixel mais brilhante; horizonte = média de uma faixa logo acima. Linha 0 da imagem é o zênite (flipY). */
function analisar(t: THREE.DataTexture): Foto {
  t.colorSpace = THREE.LinearSRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  const { w, h, px } = valores(t);
  let melhor = -1, mi = 0;
  for (let i = 0; i < w * h; i++) {
    const [r, g, b] = px(i);
    const l = r * 0.2126 + g * 0.7152 + b * 0.0722;
    if (l > melhor) { melhor = l; mi = i; }
  }
  const u = (mi % w + 0.5) / w;
  const solAng = (u - 0.5) * Math.PI * 2;
  // faixa entre 1° e 6° acima do horizonte
  const hz = new THREE.Color(0, 0, 0);
  let n = 0;
  const l0 = Math.floor(h * (0.5 - 6 / 180)), l1 = Math.floor(h * (0.5 - 1 / 180));
  for (let y = l0; y <= l1; y++) for (let x = 0; x < w; x += 2) {
    const [r, g, b] = px(y * w + x);
    // o lado do sol estoura: fora da conta
    if (r + g + b > 30) continue;
    hz.r += r; hz.g += g; hz.b += b; n++;
  }
  hz.multiplyScalar(1 / Math.max(1, n));
  return { tex: t, solAng, horizonte: hz };
}

function brilhoMedio(t: THREE.DataTexture): number {
  const { w, h, px } = valores(t);
  let s = 0, n = 0;
  // só o céu (metade de cima), sem o disco do sol
  for (let y = 0; y < h / 2; y += 2) for (let x = 0; x < w; x += 2) {
    const [r, g, b] = px(y * w + x);
    const l = r * 0.2126 + g * 0.7152 + b * 0.0722;
    if (l > 20) continue;
    s += l; n++;
  }
  return s / Math.max(1, n);
}
