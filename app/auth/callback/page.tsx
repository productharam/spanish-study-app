"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

const TERMS_VERSION = "2025-12-30";
const PRIVACY_VERSION = "2025-12-30";
const COLLECTION_VERSION = "2025-12-30";

export default function AuthCallbackPage() {
  const router = useRouter();
  const sp = useSearchParams();

  const [status, setStatus] = useState<string>("로그인 처리 중...");

  useEffect(() => {
    const run = async () => {
      try {
        // 1) code 파라미터 확인 (PKCE)
        const code = sp.get("code");
        const errorDesc = sp.get("error_description");
        const error = sp.get("error");

        if (error || errorDesc) {
          console.error("OAuth error:", { error, errorDesc });
          router.replace("/login");
          return;
        }

        if (!code) {
          // 이미 세션이 있으면 그냥 진행
          const { data: sess } = await supabase.auth.getSession();
          if (!sess.session?.user) {
            router.replace("/login");
            return;
          }
        } else {
          // 2) code -> session 교환
          setStatus("세션 생성 중...");
          const { data, error: exErr } = await supabase.auth.exchangeCodeForSession(code);
          if (exErr) throw exErr;

          if (!data.session?.user) {
            router.replace("/login");
            return;
          }
        }

        // 3) 최신 약관 동의 여부 체크
        setStatus("약관 동의 확인 중...");
        const { data: u } = await supabase.auth.getUser();
        const user = u.user;
        if (!user) {
          router.replace("/login");
          return;
        }

        const { data: consent, error: cErr } = await supabase
          .from("user_consents")
          .select("terms_version, privacy_version, collection_version")
          .eq("user_id", user.id)
          .maybeSingle();

        // consent row 없거나, 버전 불일치면 /join/consent
        const ok =
          !!consent &&
          consent.terms_version === TERMS_VERSION &&
          consent.privacy_version === PRIVACY_VERSION &&
          consent.collection_version === COLLECTION_VERSION;

        if (cErr) {
          console.error("consent select error:", cErr);
        }

        if (!ok) {
          router.replace(`/join/consent?next=${encodeURIComponent("/")}`);
          return;
        }

        // 4) 정상: 홈으로
        setStatus("완료! 이동 중...");
        router.replace("/");
      } catch (e) {
        console.error("auth callback error:", e);
        router.replace("/login");
      }
    };

    run();
  }, [router, sp]);

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        backgroundColor: "#000",
        color: "#e5e7eb",
        padding: 16,
      }}
    >
      <div style={{ fontSize: 14, color: "#9ca3af" }}>{status}</div>
    </main>
  );
}
