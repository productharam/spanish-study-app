// lib/tts/elevenlabsConfig.ts

export type LanguageCode = "en" | "es" | "ja" | "zh" | "fr" | "ru" | "ar";

export type ElevenLabsTTSConfig = {
  voiceId: string;
  modelId: string;       // 예: "eleven_turbo_v2_5"
  outputFormat: string;  // 예: "mp3_22050"
  voiceSettings?: {
    stability?: number;
    similarity_boost?: number;
    style?: number;
    use_speaker_boost?: boolean;
  };
};

// ✅ 여기만 언어별로 채우면 됨 (en/es는 예시로 비워둠)
// - voiceId는 ElevenLabs에서 언어(혹은 화자)별로 쓰는 Voice ID
// - modelId/outputFormat은 공통으로 두고 필요하면 언어별로 다르게
export const ELEVEN_CONFIG_BY_LANG: Record<string, ElevenLabsTTSConfig> = {
  en: {
    voiceId: "GoGUcAZovo4MFeLxJdZd",
    modelId: "eleven_turbo_v2_5",
    outputFormat: "mp3_22050",
    voiceSettings: {
      stability: 0.5,
      similarity_boost: 0.8,
      style: 0,
      use_speaker_boost: true,
    },
  },
  es: {
    voiceId: "Nh2zY9kknu6z4pZy6FhD",
    modelId: "eleven_turbo_v2_5",
    outputFormat: "mp3_22050",
  },
  ja: {
    voiceId: "aTTiK3YzK3dXETpuDE2h",
    modelId: "eleven_turbo_v2_5",
    outputFormat: "mp3_22050",
        voiceSettings: {
      stability: 0.5,
      similarity_boost: 0.5,
      style: 0,
      use_speaker_boost: true,
    },
  },
  zh: {
    voiceId: "GoGUcAZovo4MFeLxJdZd",
    modelId: "eleven_turbo_v2_5",
    outputFormat: "mp3_22050",
        voiceSettings: {
      stability: 0.4,
      similarity_boost: 0.5,
      style: 0,
      use_speaker_boost: true,
    },
  },
  fr: {
    voiceId: "aTTiK3YzK3dXETpuDE2h",
    modelId: "eleven_turbo_v2_5",
    outputFormat: "mp3_22050",
  },
  ru: {
    voiceId: "aTTiK3YzK3dXETpuDE2h",
    modelId: "eleven_turbo_v2_5",
    outputFormat: "mp3_22050",
  },
  ar: {
    voiceId: "UgBBYS2sOqTuMpoF3BR0",
    modelId: "eleven_turbo_v2_5",
    outputFormat: "mp3_22050",
  },
};

export function normalizeLanguageCode(lang?: string | null) {
  const v = (lang ?? "").trim().toLowerCase();
  if (!v) return "en";
  // e.g. "en-US" → "en"
  const base = v.split("-")[0];
  return base || "en";
}

export function getElevenConfig(language?: string | null): ElevenLabsTTSConfig {
  const code = normalizeLanguageCode(language);
  return ELEVEN_CONFIG_BY_LANG[code] ?? ELEVEN_CONFIG_BY_LANG["en"];
}
