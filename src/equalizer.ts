export class EqualizerVisualizer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private analyser: AnalyserNode;
  private dataArray: Uint8Array;
  private smoothed: number[] = [];
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

    this.analyser.getByteTimeDomainData(this.dataArray as Uint8Array<ArrayBuffer>);

    const rawLen = this.dataArray.length;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const mid = h / 2;

    const pointCount = 24;
    const rawStep = Math.max(1, Math.floor(rawLen / pointCount));

    if (this.smoothed.length !== pointCount) {
      this.smoothed = new Array(pointCount).fill(0);
    }

    for (let i = 0; i < pointCount; i++) {
      const idx = Math.min(rawLen - 1, i * rawStep);
      const amplitude = ((this.dataArray[idx] ?? 128) - 128) / 128;
      this.smoothed[i] = (this.smoothed[i] ?? 0) * 0.35 + amplitude * 0.65;
    }

    this.ctx.clearRect(0, 0, w, h);
    this.ctx.beginPath();

    const xStep = w / (pointCount - 1);

    let px = 0;
    let py = mid - (this.smoothed[0] ?? 0) * mid;
    this.ctx.moveTo(px, py);

    for (let i = 1; i < pointCount; i++) {
      const cx = px + xStep;
      const cy = mid - (this.smoothed[i] ?? 0) * mid;
      const mx = (px + cx) / 2;
      const my = (py + cy) / 2;
      this.ctx.quadraticCurveTo(px, py, mx, my);
      px = cx;
      py = cy;
    }

    this.ctx.lineTo(px, py);

    this.ctx.strokeStyle = "rgba(139, 92, 246, 0.9)";
    this.ctx.lineWidth = 1.5 * this.dpr;
    this.ctx.lineCap = "round";
    this.ctx.lineJoin = "round";
    this.ctx.stroke();
  };
}
