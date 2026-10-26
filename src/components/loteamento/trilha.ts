// Trilha da apresentação: ambiente de lançamento imobiliário gerado na hora
// (WebAudio, sem arquivo de áudio) — acordes abertos em I–V–vi–IV com
// sétimas e nonas, baixo, arpejo de "piano" suave e reverb longo. Vai para
// os alto-falantes e, na gravação, também para a faixa de áudio do vídeo.

const ACORDES: { pad: number[]; baixo: number; arpejo: number[] }[] = [
  { pad: [48, 55, 59, 62, 64], baixo: 36, arpejo: [72, 76, 79, 83, 86, 79] }, // Cmaj9
  { pad: [47, 50, 55, 62, 64], baixo: 43, arpejo: [71, 74, 79, 83, 86, 79] }, // G6/B
  { pad: [45, 52, 55, 60, 64], baixo: 33, arpejo: [69, 72, 76, 79, 84, 76] }, // Am9
  { pad: [41, 48, 52, 57, 60], baixo: 29, arpejo: [65, 69, 72, 76, 81, 72] }, // Fmaj7
];
const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
const COMPASSO = 4.2; // s por acorde

export class Trilha {
  private ctx: AudioContext;
  private mestre: GainNode;
  private destino: MediaStreamAudioDestinationNode;
  private alto: GainNode;
  private fontes: AudioScheduledSourceNode[] = [];
  /** cada tocar() ganha um número; parar() muda o número e o tocar() pendente desiste */
  private vez = 0;

  constructor() {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AC();
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 3;
    this.mestre = this.ctx.createGain();
    this.mestre.gain.value = 0;
    this.mestre.connect(comp);
    // alto-falante (pode ser mudo) e a faixa do vídeo (sempre com som)
    this.alto = this.ctx.createGain();
    comp.connect(this.alto);
    this.alto.connect(this.ctx.destination);
    this.destino = this.ctx.createMediaStreamDestination();
    comp.connect(this.destino);
  }

  /** A faixa de áudio para o gravador. */
  get faixa(): MediaStreamTrack | null { return this.destino.stream.getAudioTracks()[0] ?? null; }

  /** Som nos alto-falantes (a faixa do vídeo continua com som). */
  setMudo(mudo: boolean): void { this.alto.gain.setTargetAtTime(mudo ? 0 : 1, this.ctx.currentTime, 0.1); }

  /** Reverb: ruído com decaimento exponencial (2,8 s), estéreo. */
  private reverb(): ConvolverNode {
    const c = this.ctx.createConvolver();
    const n = Math.floor(this.ctx.sampleRate * 2.8);
    const buf = this.ctx.createBuffer(2, n, this.ctx.sampleRate);
    let s = 1234567;
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < n; i++) { s = (s * 16807) % 2147483647; d[i] = ((s / 2147483647) * 2 - 1) * (1 - i / n) ** 3.2; }
    }
    c.buffer = buf;
    return c;
  }

  /** Toca `duracao` segundos, com entrada e saída suaves. */
  async tocar(duracao: number): Promise<void> {
    const vez = ++this.vez;
    if (this.ctx.state === "suspended") await this.ctx.resume();
    if (vez !== this.vez) return;
    // as notas da música anterior já terminaram ou foram paradas
    this.fontes = [];
    const t0 = this.ctx.currentTime + 0.1, fim = t0 + duracao;
    const rev = this.reverb();
    const molhado = this.ctx.createGain();
    molhado.gain.value = 0.55;
    rev.connect(molhado);
    molhado.connect(this.mestre);
    const seco = this.ctx.createGain();
    seco.gain.value = 0.7;
    seco.connect(this.mestre);
    seco.connect(rev);
    const g = this.mestre.gain;
    g.cancelScheduledValues(t0);
    g.setValueAtTime(0, t0);
    g.linearRampToValueAtTime(1.5, t0 + 2.5);
    g.setValueAtTime(1.5, Math.max(t0 + 2.6, fim - 3.5));
    g.linearRampToValueAtTime(0, fim);

    // filtro do pad abre devagar ao longo da música (sensação de "subida")
    const filtro = this.ctx.createBiquadFilter();
    filtro.type = "lowpass";
    filtro.Q.value = 0.6;
    filtro.frequency.setValueAtTime(700, t0);
    filtro.frequency.linearRampToValueAtTime(2300, t0 + duracao * 0.75);
    filtro.connect(seco);

    for (let k = 0, t = t0; t < fim; k++, t += COMPASSO) {
      const a = ACORDES[k % ACORDES.length];
      // pad: dentes-de-serra levemente desafinados, ataque e soltura lentos
      for (const nota of a.pad) for (const det of [-6, 5]) {
        const o = this.ctx.createOscillator();
        o.type = "sawtooth";
        o.frequency.value = hz(nota);
        o.detune.value = det;
        const e = this.ctx.createGain();
        e.gain.setValueAtTime(0, t);
        e.gain.linearRampToValueAtTime(0.022, t + 1.4);
        e.gain.setValueAtTime(0.022, t + COMPASSO - 0.2);
        e.gain.linearRampToValueAtTime(0, t + COMPASSO + 1.6);
        o.connect(e).connect(filtro);
        o.start(t); o.stop(t + COMPASSO + 1.7);
        this.fontes.push(o);
      }
      // baixo: senoide redonda
      const b = this.ctx.createOscillator();
      b.type = "sine";
      b.frequency.value = hz(a.baixo);
      const eb = this.ctx.createGain();
      eb.gain.setValueAtTime(0, t);
      eb.gain.linearRampToValueAtTime(0.16, t + 0.25);
      eb.gain.exponentialRampToValueAtTime(0.06, t + COMPASSO);
      eb.gain.linearRampToValueAtTime(0, t + COMPASSO + 0.3);
      b.connect(eb).connect(seco);
      b.start(t); b.stop(t + COMPASSO + 0.35);
      this.fontes.push(b);
      // arpejo: "piano" (triângulo + harmônico) em colcheias, só depois da introdução
      if (k >= 1) {
        const passo = COMPASSO / 8;
        for (let i = 0; i < 8; i++) {
          const ti = t + i * passo;
          if (ti > fim - 2) break;
          const nota = a.arpejo[(i * 5 + k) % a.arpejo.length];
          for (const [tipo, mult, vol] of [["triangle", 1, 0.05], ["sine", 2, 0.015]] as const) {
            const o = this.ctx.createOscillator();
            o.type = tipo;
            o.frequency.value = hz(nota) * mult;
            const e = this.ctx.createGain();
            const v = vol * (i % 4 === 0 ? 1.25 : 0.85);
            e.gain.setValueAtTime(0, ti);
            e.gain.linearRampToValueAtTime(v, ti + 0.012);
            e.gain.exponentialRampToValueAtTime(0.0008, ti + 1.1);
            o.connect(e).connect(seco);
            o.start(ti); o.stop(ti + 1.15);
            this.fontes.push(o);
          }
        }
      }
    }
  }

  /** Para com uma saída rápida. */
  parar(): void {
    this.vez++;
    const t = this.ctx.currentTime;
    this.mestre.gain.cancelScheduledValues(t);
    this.mestre.gain.setTargetAtTime(0, t, 0.25);
    const fontes = this.fontes;
    this.fontes = [];
    setTimeout(() => { for (const f of fontes) { try { f.stop(); } catch { /* já parou */ } } }, 1500);
  }

  fechar(): void {
    this.parar();
    setTimeout(() => { void this.ctx.close(); }, 1600);
  }
}
