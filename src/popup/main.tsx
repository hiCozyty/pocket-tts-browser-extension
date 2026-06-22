import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { PRESET_VOICES, isPresetVoice } from "@/protocol";
import type { RuntimeConfig } from "@/protocol";
import { clearCache, listCachedAssets } from "@/cache";

const STORAGE_KEY = "pocket_tts_config";

const DEFAULT_CONFIG: RuntimeConfig = {
  wasmBase: chrome.runtime.getURL("public/wasm"),
  hfRepo: "kyutai/pocket-tts-without-voice-cloning",
  hfToken: "",
  voice: "alba",
  useCache: true,
};

const styles: Record<string, React.CSSProperties> = {
  root: {
    width: 320,
    padding: 16,
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
    color: "#1f2937",
    background: "#fafafa",
  },
  header: {
    fontSize: 18,
    fontWeight: 700,
    margin: 0,
    marginBottom: 4,
  },
  subheader: {
    fontSize: 12,
    color: "#6b7280",
    margin: 0,
    marginBottom: 16,
  },
  section: {
    marginBottom: 16,
  },
  label: {
    display: "block",
    fontSize: 12,
    fontWeight: 600,
    color: "#374151",
    marginBottom: 4,
  },
  input: {
    width: "100%",
    padding: "6px 8px",
    border: "1px solid #d1d5db",
    borderRadius: 6,
    fontSize: 13,
    boxSizing: "border-box",
    fontFamily: "inherit",
  },
  select: {
    width: "100%",
    padding: "6px 8px",
    border: "1px solid #d1d5db",
    borderRadius: 6,
    fontSize: 13,
    boxSizing: "border-box",
    background: "white",
  },
  row: {
    display: "flex",
    gap: 8,
    alignItems: "center",
  },
  button: {
    padding: "6px 12px",
    background: "#8b5cf6",
    color: "white",
    border: "none",
    borderRadius: 6,
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 500,
  },
  dangerButton: {
    padding: "6px 12px",
    background: "#fee2e2",
    color: "#dc2626",
    border: "1px solid #fecaca",
    borderRadius: 6,
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 500,
  },
  cacheItem: {
    display: "flex",
    justifyContent: "space-between",
    padding: "4px 0",
    fontSize: 11,
    color: "#6b7280",
    borderBottom: "1px solid #f3f4f6",
  },
  help: {
    fontSize: 11,
    color: "#9ca3af",
    marginTop: 4,
    lineHeight: 1.4,
  },
  checkboxRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 13,
  },
};

interface CachedAssetInfo {
  key: string;
  size: number;
  contentType: string;
  cachedAt: number;
}

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};

const Popup = () => {
  const [config, setConfig] = useState<RuntimeConfig>(DEFAULT_CONFIG);
  const [saved, setSaved] = useState(false);
  const [cache, setCache] = useState<CachedAssetInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        const result = await chrome.storage.local.get(STORAGE_KEY);
        const stored = result[STORAGE_KEY] as Partial<RuntimeConfig> | undefined;
        if (stored) {
          setConfig({ ...DEFAULT_CONFIG, ...stored });
        }
      } catch (err) {
        console.warn("Failed to load config", err);
      }

      try {
        const assets = await listCachedAssets();
        setCache(
          assets.map((a) => ({
            key: a.key,
            size: a.size,
            contentType: a.contentType,
            cachedAt: a.cachedAt,
          })),
        );
      } catch (err) {
        console.warn("Failed to list cache", err);
      }

      setLoading(false);
    })();
  }, []);

  const save = async (next: RuntimeConfig) => {
    setConfig(next);
    setSaved(false);
    try {
      await chrome.storage.local.set({ [STORAGE_KEY]: next });
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (err) {
      console.error("Failed to save config", err);
    }
  };

  const onClearCache = async () => {
    try {
      await clearCache();
      setCache([]);
    } catch (err) {
      console.error("Failed to clear cache", err);
    }
  };

  if (loading) {
    return (
      <div style={styles.root}>
        <p style={styles.subheader}>Loading…</p>
      </div>
    );
  }

  return (
    <div style={styles.root}>
      <h1 style={styles.header}>Pocket TTS</h1>
      <p style={styles.subheader}>
        Highlight text on any page and click the floating button to hear it.
      </p>

      <div style={styles.section}>
        <label style={styles.label}>Voice</label>
        <select
          style={styles.select}
          value={config.voice}
          onChange={(e) => save({ ...config, voice: e.target.value })}
        >
          {PRESET_VOICES.map((v) => (
            <option key={v} value={v}>
              {v.charAt(0).toUpperCase() + v.slice(1)}
            </option>
          ))}
        </select>
        <p style={styles.help}>
          Preset voices. Voice cloning from a WAV file is supported via the API
          endpoint.
        </p>
      </div>

      <div style={styles.section}>
        <label style={styles.label}>HuggingFace Repository</label>
        <input
          style={styles.input}
          value={config.hfRepo}
          onChange={(e) => save({ ...config, hfRepo: e.target.value })}
        />
        <p style={styles.help}>
          Repository to fetch model weights and voice embeddings from.
        </p>
      </div>

      <div style={styles.section}>
        <label style={styles.label}>HuggingFace Token (optional)</label>
        <input
          style={styles.input}
          type="password"
          value={config.hfToken}
          onChange={(e) => save({ ...config, hfToken: e.target.value })}
          placeholder="hf_…"
        />
        <p style={styles.help}>Only required for private/gated repositories.</p>
      </div>

      <div style={styles.section}>
        <label style={styles.checkboxRow}>
          <input
            type="checkbox"
            checked={config.useCache}
            onChange={(e) => save({ ...config, useCache: e.target.checked })}
          />
          Cache model weights in IndexedDB
        </label>
        <p style={styles.help}>
          When enabled, model weights are downloaded once and reused on
          subsequent uses. Disable to force re-download.
        </p>
      </div>

      <div style={styles.section}>
        <div style={{ ...styles.row, justifyContent: "space-between" }}>
          <span style={styles.label}>Cached assets</span>
          {cache.length > 0 && (
            <button style={styles.dangerButton} onClick={onClearCache}>
              Clear cache
            </button>
          )}
        </div>
        {cache.length === 0 ? (
          <p style={styles.help}>Nothing cached yet. Highlight some text to get started.</p>
        ) : (
          cache.map((a) => (
            <div key={a.key} style={styles.cacheItem}>
              <span>{a.key}</span>
              <span>{formatBytes(a.size)}</span>
            </div>
          ))
        )}
      </div>

      {saved && <p style={{ ...styles.help, color: "#059669" }}>Saved.</p>}

      {config.voice && !isPresetVoice(config.voice) && (
        <p style={{ ...styles.help, color: "#dc2626" }}>
          Invalid voice selected. Please pick one of the presets.
        </p>
      )}
    </div>
  );
};

const rootEl = document.getElementById("root");
if (rootEl) {
  createRoot(rootEl).render(<Popup />);
}
