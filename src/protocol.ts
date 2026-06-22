export type WasmAssetSource = "local" | "hf" | "manual" | "cache" | null;

export type WasmLoadPhase =
  | "idle"
  | "initializing-runtime"
  | "loading-assets"
  | "compiling-model"
  | "ready"
  | "error";

export interface WasmLoadStatus {
  phase: WasmLoadPhase;
  progress: number;
  message: string;
  source: WasmAssetSource;
  ready: boolean;
  error: string | null;
}

export type WasmWorkerVoiceInput =
  | {
      kind: "preset";
      voice: string;
      hfRepo: string;
      hfToken: string;
    }
  | {
      kind: "wav";
      wavBytes: Uint8Array;
    }
  | {
      kind: "embedding";
      embeddingBytes: Uint8Array;
    };

export type WasmWorkerRequest =
  | {
      kind: "init";
      requestId: number;
      wasmBase: string;
      hfRepo: string;
      hfToken: string;
      useCache: boolean;
    }
  | {
      kind: "prepare_voice";
      requestId: number;
      voice: WasmWorkerVoiceInput;
    }
  | {
      kind: "start_stream";
      requestId: number;
      text: string;
    }
  | {
      kind: "stop";
    };

export type WasmWorkerEvent =
  | {
      kind: "status";
      status: WasmLoadStatus;
    }
  | {
      kind: "rpc_ok";
      requestId: number;
      payload?: {
        sampleRate?: number;
      };
    }
  | {
      kind: "rpc_err";
      requestId: number;
      error: string;
    }
  | {
      kind: "stream_first_chunk";
    }
  | {
      kind: "stream_chunk";
      chunk: Float32Array;
      computeMs: number | null;
      mergedChunks: number | null;
    }
  | {
      kind: "stream_done";
    }
  | {
      kind: "stream_error";
      error: string;
    };

export type EngineState =
  | "idle"
  | "loading"
  | "ready"
  | "buffering"
  | "playing"
  | "finished"
  | "error";

export interface EngineStatus {
  state: EngineState;
  message: string | null;
  loadProgress: number;
  loadPhase: WasmLoadPhase;
  loadSource: WasmAssetSource;
  error: string | null;
  bufferSeconds: number;
}

export interface RuntimeConfig {
  wasmBase: string;
  hfRepo: string;
  hfToken: string;
  voice: string;
  useCache: boolean;
}

export const PRESET_VOICES = [
  "alba",
  "marius",
  "javert",
  "jean",
  "fantine",
  "cosette",
  "eponine",
  "azelma",
] as const;

export type PresetVoice = (typeof PRESET_VOICES)[number];

export const isPresetVoice = (voice: string): voice is PresetVoice => {
  return (PRESET_VOICES as readonly string[]).includes(voice);
};
