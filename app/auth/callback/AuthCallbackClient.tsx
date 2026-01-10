// app/auth/callback/AuthCallbackClient.tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { isConsentAccepted } from "@/lib/consent";



export default function AuthCallbackClient() {
  const router = useRouter();
  const sp = useSearchParams();
  const [status, setStatus] = useState("로그인 처리 중...");

  useEffect(() => {
    const run = async () => {
      try {
        const code = sp.get("code");
        const errorDesc = sp.get("error_description");
        const error = sp.get("error");

        if (error || errorDesc) {
          console.error("OAuth error:", { error, errorDesc });
          router.replace("/login");
          return;
        }

        if (code) {
          setStatus("세션 생성 중...");
          const { data, error: exErr } = await supabase.auth.exchangeCodeForSession(code);
          if (exErr) throw exErr;
          if (!data.session?.user) {
            router.replace("/login");
            return;
          }
        } else {
          const { data: sess } = await supabase.auth.getSession();
          if (!sess.session?.user) {
            router.replace("/login");
            return;
          }
        }

        setStatus("약관 동의 확인 중...");
        const { data: u } = await supabase.auth.getUser();
        const user = u.user;
        if (!user) {
          router.replace("/login");
          return;
        }

        const { data: consent } = await supabase
  .from("profiles")
  .select("terms_version, privacy_version, collection_version, consented_at")
  .eq("user_id", user.id)
  .maybeSingle();


          const ok = isConsentAccepted(consent);

          
        if (!ok) {
          router.replace(`/join/consent?next=${encodeURIComponent("/")}`);
          return;
        }

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
