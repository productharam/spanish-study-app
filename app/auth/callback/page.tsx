"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

const TERMS_VERSION = "2025-12-30";
const PRIVACY_VERSION = "2025-12-30";
const COLLECTION_VERSION = "2025-12-30";

export default function AuthCallbackPage() {
  const router = useRouter();

  useEffect(() => {
    const run = async () => {
      try {
        // 0) PKCE(code) 콜백 대응: code가 있으면 세션 교환
        const url = new URL(window.location.href);
        const code = url.searchParams.get("code");
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;

          // code 파라미터 제거 (깔끔 + 중복 교환 방지)
          url.searchParams.delete("code");
          window.history.replaceState({}, document.title, url.toString());
        }

        // 1) 유저 확인 (getSession보다 getUser가 더 안정적인 편)
        const { data: userRes, error: userErr } = await supabase.auth.getUser();
        if (userErr) throw userErr;

        const user = userRes.user;
        if (!user) {
          router.replace("/login");
          return;
        }

        // 2) 동의 여부 조회
        const { data: consent, error: consentErr } = await supabase
          .from("user_consents")
          .select("terms_version, privacy_version, collection_version")
          .eq("user_id", user.id)
          .maybeSingle();

        if (consentErr) {
          console.error("Consent check error:", consentErr);
          router.replace("/login");
          return;
        }

        const isAccepted =
          !!consent &&
          consent.terms_version === TERMS_VERSION &&
          consent.privacy_version === PRIVACY_VERSION &&
          consent.collection_version === COLLECTION_VERSION;

        // 3) 분기
        router.replace(isAccepted ? "/" : "/join/consent");
      } catch (e) {
        console.error("Auth callback error:", e);
        router.replace("/login");
      }
    };

    run();
  }, [router]);

  return <p>로그인 처리 중입니다...</p>;
}
