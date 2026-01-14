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
    voiceId: "REPLACE_WITH_EN_VOICE_ID",
    modelId: "eleven_turbo_v2_5",
    outputFormat: "mp3_22050",
    voiceSettings: {
      stability: 0.5,
      similarity_boost: 0.75,
      style: 0,
      use_speaker_boost: true,
    },
  },
  es: {
    voiceId: "Nh2zY9kknu6z4pZy6FhD",
    modelId: "eleven_turbo_v2_5",
    outputFormat: "mp3_22050",
    voiceSettings: {
      stability: 0.5,
      similarity_boost: 0.75,
      style: 0,
      use_speaker_boost: true,
    },
  },

  // 필요할 때 추가
  ja: {
    voiceId: "REPLACE_WITH_JA_VOICE_ID",
    modelId: "eleven_turbo_v2_5",
    outputFormat: "mp3_22050",
  },
  zh: {
    voiceId: "REPLACE_WITH_ZH_VOICE_ID",
    modelId: "eleven_turbo_v2_5",
    outputFormat: "mp3_22050",
  },
  fr: {
    voiceId: "REPLACE_WITH_FR_VOICE_ID",
    modelId: "eleven_turbo_v2_5",
    outputFormat: "mp3_22050",
  },
  ru: {
    voiceId: "REPLACE_WITH_RU_VOICE_ID",
    modelId: "eleven_turbo_v2_5",
    outputFormat: "mp3_22050",
  },
  ar: {
    voiceId: "REPLACE_WITH_AR_VOICE_ID",
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
