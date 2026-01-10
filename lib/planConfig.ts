// /lib/planConfig.ts

export type PlanType = "standard" | "basic" | "pro";

export const PLAN_LIMITS = {
  standard: {
    chat: 30,
    learning: 10,
    tts: 2,
  },
  basic: {
    chat: 200,
    learning: 200,
    tts: 200,
  },
  pro: {
    chat: 200,
    learning: 200,
    tts: 200,
  },
} as const;
