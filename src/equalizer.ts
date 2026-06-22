const BAR_COUNT = 12;
const BAR_GAP = 2;
const BAR_WIDTH_RATIO = 0.7;
const MIN_BAR_HEIGHT = 4;
const PEAK_DECAY = 0.012;

export class EqualizerVisualizer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private analyser: AnalyserNode;
  private dataArray: Uint8Array;
  private history: number[] = [];
  private peaks: number[] = [];
  private rafId: number | null = null;
  private visible = false;
  private dpr = window.devicePixelRatio || 1;

  constructor(canvas: HTMLCanvasElement, analyser: AnalyserNode) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Failed to acquire 2D context for equalizer");
    }
    this.ctx = ctx;
    this.analyser = analyser;
    this.dataArray = new Uint8Array(analyser.frequencyBinCount);

    for (let i = 0; i < BAR_COUNT; i++) {
      this.history.push(0);
      this.peaks.push(0);
    }
  }

  start(): void {
    if (this.rafId != null) return;
    this.tick();
  }

  stop(): void {
    if (this.rafId != null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    if (visible) {
      this.start();
    } else {
      this.stop();
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
  }

  resize(): void {
    this.dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.max(1, Math.floor(rect.width * this.dpr));
    this.canvas.height = Math.max(1, Math.floor(rect.height * this.dpr));
  }

  private tick = (): void => {
    this.rafId = requestAnimationFrame(this.tick);

    if (!this.visible) return;

    this.analyser.getByteFrequencyData(this.dataArray as Uint8Array<ArrayBuffer>);

    const w = this.canvas.width;
    const h = this.canvas.height;

    this.ctx.clearRect(0, 0, w, h);

    const totalGapWidth = BAR_GAP * (BAR_COUNT - 1);
    const barWidth = ((w - totalGapWidth) / BAR_COUNT) * BAR_WIDTH_RATIO;
    const barFull = (w - totalGapWidth) / BAR_COUNT;
    const binsPerBar = Math.floor(this.dataArray.length / BAR_COUNT);

    const values: number[] = [];
    for (let i = 0; i < BAR_COUNT; i++) {
      let sum = 0;
      const startIdx = i * binsPerBar;
      const endIdx = Math.min(this.dataArray.length, startIdx + binsPerBar);

      for (let j = startIdx; j < endIdx; j++) {
        sum += this.dataArray[j] ?? 0;
      }
      const avg = endIdx > startIdx ? sum / (endIdx - startIdx) / 255 : 0;

      const prev = this.history[i] ?? 0;
      const next = prev * 0.4 + avg * 0.6;
      this.history[i] = next;
      values.push(next);
    }

    let x = 0;
    for (let i = 0; i < BAR_COUNT; i++) {
      const value = values[i] ?? 0;
      const scaled = Math.pow(value, 0.85);
      const barHeight = Math.max(MIN_BAR_HEIGHT * this.dpr, scaled * h);
      const y = (h - barHeight) / 2;

      const peak = this.peaks[i] ?? 0;
      const peakTarget = barHeight;
      if (peakTarget > peak) {
        this.peaks[i] = peakTarget;
      } else {
        this.peaks[i] = Math.max(0, peak - PEAK_DECAY * h);
      }

      const gradient = this.ctx.createLinearGradient(0, h, 0, 0);
      gradient.addColorStop(0, "rgba(99, 102, 241, 0.95)");
      gradient.addColorStop(0.5, "rgba(139, 92, 246, 0.95)");
      gradient.addColorStop(1, "rgba(236, 72, 153, 0.95)");

      this.ctx.fillStyle = gradient;
      this.roundRectFill(x, y, barWidth, barHeight, 2 * this.dpr);

      this.ctx.fillStyle = "rgba(236, 72, 153, 0.7)";
      this.ctx.fillRect(x, y - 3 * this.dpr, barWidth, 2 * this.dpr);

      x += barFull;
    }
  };

  private roundRectFill(x: number, y: number, w: number, h: number, r: number): void {
    const radius = Math.min(r, w / 2, h / 2);
    this.ctx.beginPath();
    this.ctx.moveTo(x + radius, y);
    this.ctx.lineTo(x + w - radius, y);
    this.ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
    this.ctx.lineTo(x + w, y + h - radius);
    this.ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    this.ctx.lineTo(x + radius, y + h);
    this.ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
    this.ctx.lineTo(x, y + radius);
    this.ctx.quadraticCurveTo(x, y, x + radius, y);
    this.ctx.closePath();
    this.ctx.fill();
  }
}
