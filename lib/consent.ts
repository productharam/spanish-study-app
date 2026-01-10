// lib/consent.ts
export const TERMS_VERSION = "2026-01-05";
export const PRIVACY_VERSION = "2025-12-30";
export const COLLECTION_VERSION = "2025-12-30";

type ConsentLike = {
  terms_version: string | null;
  privacy_version: string | null;
  collection_version: string | null;
  // (profiles로 마이그레이션 후 쓰게 될 키)
  consented_at?: string | null;
  // (user_consents 테이블에서 쓰고 있을 수 있는 키)
  accepted_at?: string | null;
};

export function isConsentAccepted(c: ConsentLike | null | undefined) {
  if (!c) return false;

  // consented_at/accepted_at 중 하나라도 존재하는 구조면 "null 아닌지"까지 체크
  const hasAtKey = "consented_at" in c || "accepted_at" in c;
  if (hasAtKey) {
    const at = (c.consented_at ?? c.accepted_at) ?? null;
    if (!at) return false;
  }

  return (
    c.terms_version === TERMS_VERSION &&
    c.privacy_version === PRIVACY_VERSION &&
    c.collection_version === COLLECTION_VERSION
  );
}
