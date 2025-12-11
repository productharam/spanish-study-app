"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function AuthCallbackPage() {
  const router = useRouter();

  useEffect(() => {
    const handleAuth = async () => {
      try {
        // Supabase가 URL 해시를 읽어서 세션을 세팅
        await supabase.auth.getSession();

        // ✅ 로그인 후에는 메인(/) 으로만 보낸다
        router.replace("/");
      } catch (e) {
        console.error("Auth callback error:", e);
        router.replace("/login");
      }
    };

    handleAuth();
  }, [router]);

    return <p>로그인 처리 중입니다...</p>;
}
