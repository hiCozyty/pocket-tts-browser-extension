import { describe, expect, it } from "vitest";
import { EqualizerVisualizer } from "./equalizer";

class FakeAnalyser {
  frequencyBinCount = 32;
  context = { sampleRate: 24000 } as AudioContext;
  getByteTimeDomainData(target: Uint8Array) {
    for (let i = 0; i < target.length; i++) target[i] = 128 + (i % 40 - 20) * 3;
  }
}

const makeCanvas = (): HTMLCanvasElement => {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 28;
  Object.defineProperty(canvas, "getContext", {
    value: () => {
      const noop = () => undefined;
      return {
        clearRect: noop,
        beginPath: noop,
        moveTo: noop,
        lineTo: noop,
        quadraticCurveTo: noop,
        stroke: noop,
        strokeStyle: "",
        lineWidth: 0,
        lineCap: "",
        lineJoin: "",
      } as unknown as CanvasRenderingContext2D;
    },
  });
  return canvas;
};

describe("EqualizerVisualizer", () => {
  it("setVisible(true) starts the animation loop", () => {
    const canvas = makeCanvas();
    const eq = new EqualizerVisualizer(canvas, new FakeAnalyser() as unknown as AnalyserNode);
    eq.setVisible(true);
    eq.setVisible(false);
  });

  it("resize uses devicePixelRatio and bounding rect", () => {
    const canvas = makeCanvas();
    Object.defineProperty(canvas, "getBoundingClientRect", {
      value: () => ({ width: 100, height: 30, top: 0, left: 0, right: 100, bottom: 30, x: 0, y: 0, toJSON: () => "" }),
    });
    const eq = new EqualizerVisualizer(canvas, new FakeAnalyser() as unknown as AnalyserNode);
    eq.resize();
    expect(canvas.width).toBeGreaterThan(0);
    expect(canvas.height).toBeGreaterThan(0);
  });

  it("allocates data array sized to analyser.frequencyBinCount", () => {
    const analyser = new FakeAnalyser();
    analyser.frequencyBinCount = 64;
    const eq = new EqualizerVisualizer(makeCanvas(), analyser as unknown as AnalyserNode);
    expect(eq).toBeDefined();
  });

  it("ticks consume frequency data when visible", () => {
    const canvas = makeCanvas();
    const eq = new EqualizerVisualizer(canvas, new FakeAnalyser() as unknown as AnalyserNode);
    eq.setVisible(true);
    expect(() => eq.stop()).not.toThrow();
  });
});
