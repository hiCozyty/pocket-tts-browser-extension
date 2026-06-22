import { describe, expect, it } from "vitest";
import { isPresetVoice, PRESET_VOICES, type PresetVoice } from "./protocol";

describe("protocol", () => {
  describe("PRESET_VOICES", () => {
    it("contains the expected 21 voices", () => {
      expect(PRESET_VOICES).toEqual([
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
      ]);
    });

    it("has unique entries", () => {
      const set = new Set(PRESET_VOICES);
      expect(set.size).toBe(PRESET_VOICES.length);
    });
  });

  describe("isPresetVoice", () => {
    it.each(PRESET_VOICES)("accepts %s", (voice) => {
      expect(isPresetVoice(voice)).toBe(true);
    });

    it("rejects unknown voice", () => {
      expect(isPresetVoice("unknown")).toBe(false);
    });

    it("rejects empty string", () => {
      expect(isPresetVoice("")).toBe(false);
    });

    it("rejects case-mismatched voice", () => {
      expect(isPresetVoice("Alba")).toBe(false);
      expect(isPresetVoice("ALBA")).toBe(false);
    });

    it("narrows type when true", () => {
      const voice: string = "alba";
      if (isPresetVoice(voice)) {
        const narrowed: PresetVoice = voice;
        expect(narrowed).toBe("alba");
      }
    });
  });
});
