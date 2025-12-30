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
    const handleAuth = async () => {
      try {
        // 1) Supabase가 URL 해시(#access_token=...)를 읽어 세션 세팅
        const { data: sessionRes, error: sessionErr } =
          await supabase.auth.getSession();

        if (sessionErr) throw sessionErr;

        const user = sessionRes.session?.user;
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
          // 조회 오류가 나면 안전하게 로그인 화면으로(또는 에러 페이지)
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
        if (!isAccepted) {
          router.replace("/join/consent");
        } else {
          router.replace("/");
        }
      } catch (e) {
        console.error("Auth callback error:", e);
        router.replace("/login");
      }
    };

    handleAuth();
  }, [router]);

  return <p>로그인 처리 중입니다...</p>;
}
