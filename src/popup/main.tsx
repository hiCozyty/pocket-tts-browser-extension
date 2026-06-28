import { useEffect, useState, useRef } from "react";
import { createRoot } from "react-dom/client";
import { PRESET_VOICES, isPresetVoice } from "@/protocol";
import type { RuntimeConfig } from "@/protocol";
import { clearCache, listCachedAssets } from "@/cache";

const STORAGE_KEY = "pocket_tts_config";

const DEFAULT_CONFIG: RuntimeConfig = {
  wasmBase: chrome.runtime.getURL("public/wasm"),
  hfRepo: "kyutai/pocket-tts",
  hfToken: "",
  voice: "alba",
  useCache: true,
};

const styles: Record<string, React.CSSProperties> = {
  root: {
    width: 320,
    padding: 16,
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
    color: "var(--foreground)",
    background: "var(--background)",
    borderRadius: "var(--radius)",
    overflow: "hidden",
  },
  header: {
    fontSize: 18,
    fontWeight: 700,
    margin: 0,
    marginBottom: 4,
  },
  subheader: {
    fontSize: 12,
    color: "var(--muted-foreground)",
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
    color: "var(--foreground)",
    marginBottom: 4,
  },
  input: {
    width: "100%",
    padding: "6px 8px",
    border: "1px solid var(--border)",
    borderRadius: 6,
    fontSize: 13,
    boxSizing: "border-box",
    fontFamily: "inherit",
  },
  select: {
    width: "100%",
    padding: "6px 8px",
    border: "1px solid var(--border)",
    borderRadius: 20,
    fontSize: 13,
    boxSizing: "border-box",
    background: "var(--input)",
    color: "var(--foreground)",
  },
  row: {
    display: "flex",
    gap: 8,
    alignItems: "center",
  },
  button: {
    padding: "6px 12px",
    background: "var(--primary)",
    color: "var(--primary-foreground)",
    border: "none",
    borderRadius: 6,
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 500,
  },
  dangerButton: {
    padding: "6px 12px",
    background: "var(--destructive)",
    color: "var(--destructive-foreground)",
    border: "none",
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
    color: "var(--muted-foreground)",
    borderBottom: "1px solid var(--border)",
  },
  help: {
    fontSize: 11,
    color: "var(--muted-foreground)",
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

const Select = ({ value, options, onChange, style }: {
  value: string;
  options: readonly string[];
  onChange: (v: string) => void;
  style?: React.CSSProperties;
}) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={ref} style={{ position: "relative", ...style }}>
      <div
        style={{ ...styles.select, cursor: "pointer", userSelect: "none" }}
        onClick={() => setOpen(!open)}
      >
        {value.charAt(0).toUpperCase() + value.slice(1)}
        <span style={{ float: "right", fontSize: 10 }}>{open ? "▲" : "▼"}</span>
      </div>
      {open && (
        <div
          className="dropdown-list"
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            zIndex: 10,
            marginTop: 2,
            borderRadius: 6,
            border: "1px solid var(--border)",
            background: "var(--background)",
            maxHeight: 180,
            overflowY: "auto",
          }}
        >
          {options.map((opt) => (
            <div
              key={opt}
              style={{
                padding: "6px 8px",
                cursor: "pointer",
                color: opt === value ? "var(--primary-foreground)" : "var(--foreground)",
                background: opt === value ? "var(--primary)" : "transparent",
              }}
              onClick={() => { onChange(opt); setOpen(false); }}
              onMouseEnter={(e) => {
                if (opt !== value) e.currentTarget.style.background = "var(--muted)";
              }}
              onMouseLeave={(e) => {
                if (opt !== value) e.currentTarget.style.background = "transparent";
              }}
            >
              {opt.charAt(0).toUpperCase() + opt.slice(1)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
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
          let migrated = false;
          if (stored.hfRepo && stored.hfRepo.includes("without-voice-cloning")) {
            stored.hfRepo = "kyutai/pocket-tts";
            migrated = true;
          }
          if (stored.useCache === false) {
            stored.useCache = true;
            migrated = true;
          }
          const next = { ...DEFAULT_CONFIG, ...stored, hfRepo: "kyutai/pocket-tts", useCache: true };
          setConfig(next);
          if (migrated) {
            await chrome.storage.local.set({ [STORAGE_KEY]: next });
          }
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

    const onStorageChange = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      if (areaName === "local" && changes[STORAGE_KEY]) {
        setConfig({ ...DEFAULT_CONFIG, ...changes[STORAGE_KEY].newValue });
      }
    };
    chrome.storage.onChanged.addListener(onStorageChange);
    return () => {
      chrome.storage.onChanged.removeListener(onStorageChange);
    };
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
      <h1 style={styles.header}>PocketVoice</h1>
      <p style={styles.subheader}>
        Highlight text on any page and click the floating button to hear it.
      </p>

      <div style={styles.section}>
        <label style={styles.label}>Voice</label>
        <Select
          value={config.voice}
          options={PRESET_VOICES}
          onChange={(v) => save({ ...config, voice: v })}
          style={styles.select}
        />
        <p style={styles.help}>
          Preset voice to use when no clone WAV is provided.
        </p>
      </div>

      <div style={styles.section}>
        <label style={styles.label}>Clone Voice WAV (optional)</label>
        <button
          style={styles.button}
          onClick={async () => {
            try {
              const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
              if (tab?.id) {
                await chrome.tabs.sendMessage(tab.id, { action: "pickCloneWav" });
              }
            } catch {
              // silently ignore — content script may not be loaded on this page
            }
          }}
        >
          Choose WAV file
        </button>
        {config.cloneWavB64 ? (
          <div style={{ ...styles.row, marginTop: 6 }}>
            <span style={styles.help}>{config.cloneWavName || "Clone loaded"}</span>
            <button
              style={{ ...styles.dangerButton, fontSize: 11, padding: "2px 8px" }}
              onClick={() => {
                const next = { ...config };
                delete next.cloneWavB64;
                delete next.cloneWavName;
                void save(next);
              }}
            >
              Clear
            </button>
          </div>
        ) : (
          <p style={styles.help}>
            Optional 5-10s WAV sample for voice cloning.
          </p>
        )}
      </div>

      <div style={styles.section}>
        <label style={styles.label}>
          HuggingFace Token (required)
          <span style={{
            display: "inline-block",
            width: 10,
            height: 10,
            borderRadius: "50%",
            marginLeft: 8,
            verticalAlign: "middle",
            backgroundColor: config.hfToken.trim() ? "#22c55e" : "#ef4444",
          }} />
        </label>
        <input
          style={styles.input}
          type="password"
          value={config.hfToken}
          onChange={(e) => save({ ...config, hfToken: e.target.value })}
          placeholder="hf_…"
        />
        <p style={styles.help}>
          A free HuggingFace token is required to download model weights.
          Get yours at{" "}
            <a
              href="https://huggingface.co/settings/tokens"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "var(--primary)" }}
          >
            hf.co/settings/tokens
          </a>{" "}
          after accepting the terms at{" "}
            <a
              href="https://huggingface.co/kyutai/pocket-tts"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "var(--primary)" }}
          >
            kyutai/pocket-tts
          </a>.
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

      {saved && <p style={{ ...styles.help, color: "var(--primary)" }}>Saved.</p>}

      {config.voice && !isPresetVoice(config.voice) && (
        <p style={{ ...styles.help, color: "var(--destructive)" }}>
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
