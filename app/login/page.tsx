// app/login/page.tsx
"use client";

import { supabase } from "@/lib/supabaseClient";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function LoginPage() {
  const router = useRouter();

  // 🔥 KakaoTalk / Instagram / Facebook 인앱 브라우저 감지
  useEffect(() => {
    const ua = navigator.userAgent.toLowerCase();
    const isInApp =
      ua.includes("kakao") ||
      ua.includes("instagram") ||
      ua.includes("fb") ||
      ua.includes("facebook");

    if (isInApp) {
      alert(
        "Google 로그인이 차단되는 환경입니다.\nChrome 또는 Safari에서 다시 열어주세요!"
      );
    }
  }, []);

  const loginWithGoogle = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    if (error) {
      console.error("Google 로그인 에러:", error);
      alert("로그인 중 문제가 발생했어요. 잠시 후 다시 시도해주세요.");
    }
  };

  const goHome = () => {
    router.push("/");
  };

  return (
    <main
      style={{
        height: "100vh",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        backgroundColor: "#000000",
      }}
    >
      <div
        style={{
          backgroundColor: "#111827",
          padding: "32px 40px",
          borderRadius: "16px",
          boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
          minWidth: "320px",
          textAlign: "center",
        }}
      >
        <h1
          style={{
            fontSize: "22px",
            marginBottom: "16px",
            color: "#f9fafb",
          }}
        >
          말하면서 배우는 언어 챗봇
        </h1>
        <p
          style={{
            fontSize: "14px",
            color: "#9ca3af",
            marginBottom: "24px",
          }}
        >
          로그인하고
          <br />
          대화를 이어서 할 수 있어요.
        </p>

        <button
          onClick={loginWithGoogle}
          style={{
            width: "100%",
            padding: "12px 16px",
            borderRadius: "999px",
            border: "none",
            cursor: "pointer",
            fontSize: "15px",
            fontWeight: 500,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "8px",
            backgroundColor: "#ffffff",
            color: "#111827",
            marginBottom: "12px",
          }}
        >
          <span
            style={{
              width: "18px",
              height: "18px",
              borderRadius: "4px",
              background: "#ea4335",
              display: "inline-block",
            }}
          />
          Google로 로그인
        </button>

        <button
          onClick={goHome}
          style={{
            width: "100%",
            padding: "10px 16px",
            borderRadius: "999px",
            border: "1px solid #4b5563",
            cursor: "pointer",
            fontSize: "14px",
            color: "#e5e7eb",
            backgroundColor: "transparent",
            marginTop: "4px",
          }}
        >
          홈으로 돌아가기
        </button>
      </div>
    </main>
  );
}
