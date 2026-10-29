// Pós-processamento da maquete 3D: sombra de contato (N8AO), brilho (bloom),
// saída (tone mapping + sRGB) e a "lente" do modo cinema (tilt-shift,
// vinheta e grão). A N8AO desenha a cena ela mesma e reconstrói a normal pela
// profundidade — por isso funciona com a altura calculada no shader.
import * as THREE from "three";
import { N8AOPass } from "n8ao";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";

/** Tilt-shift (desfoca acima e abaixo da faixa de foco), vinheta e grão — depois da saída sRGB. */
const LENTE = {
  uniforms: {
    tDiffuse: { value: null },
    uTilt: { value: 0 },
    uFoco: { value: 0.5 },
    uFaixa: { value: 0.12 },
    uVinheta: { value: 0.22 },
    uGrao: { value: 0.025 },
    uTempo: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTilt, uFoco, uFaixa, uVinheta, uGrao, uTempo;
    uniform vec2 uRes;
    varying vec2 vUv;
    float ruido(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec4 cor = texture2D(tDiffuse, vUv);
      // raio do desfoque cresce com a distância à faixa de foco (em pixels, até ~9 px em 1080p)
      float fora = max(0.0, abs(vUv.y - uFoco) - uFaixa);
      float r = uTilt * smoothstep(0.0, 0.45, fora) * 9.0 * (uRes.y / 1080.0);
      if (r > 0.35) {
        vec3 soma = cor.rgb; float peso = 1.0;
        // disco de Vogel com 16 amostras (sem padrão visível)
        for (int i = 0; i < 16; i++) {
          float fi = float(i) + 0.5;
          float ang = fi * 2.39996323;
          vec2 d = vec2(cos(ang), sin(ang)) * sqrt(fi / 16.0) * r / uRes;
          // textureLod: no laço com desvio, derivada implícita é indefinida
          soma += textureLod(tDiffuse, vUv + d, 0.0).rgb; peso += 1.0;
        }
        cor.rgb = soma / peso;
      }
      vec2 c = vUv - 0.5;
      cor.rgb *= 1.0 - uVinheta * smoothstep(0.25, 0.85, dot(c, c) * 2.2);
      cor.rgb += (ruido(vUv * uRes + uTempo) - 0.5) * uGrao;
      gl_FragColor = cor;
    }`,
};

export class Pos {
  readonly composer: EffectComposer;
  readonly ao: N8AOPass;
  readonly bloom: UnrealBloomPass;
  private simples: RenderPass;
  private lente: ShaderPass;
  /** a N8AO foi desligada por falta de fôlego da placa */
  aoDesligada = false;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, w: number, h: number) {
    this.composer = new EffectComposer(renderer);
    this.ao = new N8AOPass(scene, camera, w, h);
    const c = this.ao.configuration;
    // raio em metros (casa ~3 m de pé-direito); meia resolução com upsampling pela profundidade
    c.aoRadius = 6;
    c.distanceFalloff = 1.4;
    c.intensity = 6;
    c.aoSamples = 12;
    c.denoiseSamples = 6;
    c.denoiseRadius = 10;
    c.halfRes = true;
    c.depthAwareUpsampling = true;
    c.gammaCorrection = false;
    c.color = new THREE.Color(0x0b0c10);
    // antisserrilhado: a N8AO desenha a cena num alvo próprio (sem MSAA de fábrica)
    if (renderer.capabilities.isWebGL2) this.ao.beautyRenderTarget.samples = 4;
    this.simples = new RenderPass(scene, camera);
    this.simples.enabled = false;
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0, 0.6, 0.92);
    // de dia (força 0) o bloom não roda: economiza 5 passes de desfoque
    this.bloom.enabled = false;
    this.lente = new ShaderPass(LENTE);
    this.composer.addPass(this.ao);
    this.composer.addPass(this.simples);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.composer.addPass(this.lente);
  }

  /** Sem a N8AO (placa fraca ou desligada pelo usuário). */
  setAO(v: boolean): void {
    this.ao.enabled = v;
    this.simples.enabled = !v;
  }

  /** tilt-shift 0..1, altura da faixa de foco na tela (0 embaixo, 1 em cima) */
  setLente(tilt: number, foco = 0.5, vinheta = 0.22): void {
    const u = this.lente.uniforms;
    u.uTilt.value = tilt;
    u.uFoco.value = foco;
    u.uVinheta.value = vinheta;
  }

  setSize(w: number, h: number): void {
    this.composer.setSize(w, h);
    const pr = this.composer.renderer.getPixelRatio();
    this.lente.uniforms.uRes.value.set(w * pr, h * pr);
  }

  setPixelRatio(pr: number, w: number, h: number): void {
    this.composer.setPixelRatio(pr);
    this.lente.uniforms.uRes.value.set(w * pr, h * pr);
  }

  render(): void {
    this.bloom.enabled = this.bloom.strength > 0.02;
    this.lente.uniforms.uTempo.value = (performance.now() % 1000) / 10;
    this.composer.render();
  }

  dispose(): void {
    this.ao.dispose?.();
    this.composer.dispose();
  }
}
