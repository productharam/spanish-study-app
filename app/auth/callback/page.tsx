"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function AuthCallbackPage() {
  const router = useRouter();

  useEffect(() => {
    // Supabase가 URL 해시(#access_token=...)를 읽어서 세션을 세팅한 뒤
    // 세션이 준비되면 원하는 페이지로 보내기
    const handleAuth = async () => {
      try {
        // 여기서 한 번 세션을 읽어오면,
        // Supabase 쪽에서 해시를 파싱해서 세션을 설정해둠
        await supabase.auth.getSession();

        // 로그인 후 보내고 싶은 페이지로 리다이렉트
        router.replace("/chat");
      } catch (e) {
        console.error("Auth callback error:", e);
        router.replace("/login"); // 실패 시 다시 로그인 페이지 등으로
      }
    };

    handleAuth();
  }, [router]);

  return <p>로그인 처리 중입니다...</p>;
}
