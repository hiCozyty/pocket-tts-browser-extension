export interface SerializedFloat32Array {
  __typedarray: "Float32Array";
  data: string; // base64 encoded raw bytes
  length: number;
}

export const serializeFloat32Array = (arr: Float32Array): SerializedFloat32Array => {
  const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  const binary = String.fromCharCode(...bytes);
  return {
    __typedarray: "Float32Array",
    data: btoa(binary),
    length: arr.length,
  };
};

export const deserializeFloat32Array = (env: SerializedFloat32Array): Float32Array => {
  const binary = atob(env.data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Float32Array(bytes.buffer, 0, env.length);
};

export const isSerializedFloat32Array = (v: unknown): v is SerializedFloat32Array => {
  if (typeof v !== "object" || v === null) return false;
  const obj = v as Record<string, unknown>;
  return (
    obj.__typedarray === "Float32Array" &&
    typeof obj.data === "string" &&
    typeof obj.length === "number"
  );
};

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
      wavB64: string;
    }
  | {
      kind: "embedding";
      embeddingB64: string;
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
      chunk: Float32Array | SerializedFloat32Array;
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
  cloneWavB64?: string;
  cloneWavName?: string;
}

export const PRESET_VOICES = [
  "alba",
  "anna",
  "azelma",
  "bill_boerst",
  "caro_davy",
  "charles",
  "cosette",
  "eponine",
  "eve",
  "fantine",
  "george",
  "jane",
  "javert",
  "jean",
  "marius",
  "mary",
  "michael",
  "paul",
  "peter_yearsley",
  "stuart_bell",
  "vera",
] as const;

export type PresetVoice = (typeof PRESET_VOICES)[number];

export const isPresetVoice = (voice: string): voice is PresetVoice => {
  return (PRESET_VOICES as readonly string[]).includes(voice);
};
