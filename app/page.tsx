// app/page.tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import type { User } from "@supabase/supabase-js";

export default function Home() {
  const [user, setUser] = useState<User | null | undefined>(undefined);

  useEffect(() => {
    const loadUser = async () => {
      const { data } = await supabase.auth.getUser();
      setUser(data.user ?? null);
    };

    loadUser();

    const { data: authListener } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setUser(session?.user ?? null);
      }
    );

    return () => {
      authListener.subscription.unsubscribe();
    };
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setUser(null);
  };

  const isLoading = user === undefined;

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
          display: "flex",
          flexDirection: "column",
          gap: "16px",
          alignItems: "center",
        }}
      >
        <h1
          style={{
            color: "#f9fafb",
            fontSize: "24px",
            marginBottom: "8px",
          }}
        >
          스페인어 대화 연습
        </h1>
        <p
          style={{
            color: "#9ca3af",
            fontSize: "14px",
            marginBottom: "16px",
            textAlign: "center",
          }}
        >
          로그인 없이 가볍게 체험하거나,
          <br />
          로그인 후 대화 기록을 저장할 수 있어요.
        </p>

        {isLoading ? (
          <div style={{ color: "#9ca3af", fontSize: "14px" }}>불러오는 중...</div>
        ) : user ? (
          // ✅ 로그인 된 상태
          <>
            <Link href="/chat">
              <button
                style={{
                  padding: "16px 32px",
                  fontSize: "18px",
                  borderRadius: "12px",
                  border: "none",
                  cursor: "pointer",
                  boxShadow: "0 4px 10px rgba(0,0,0,0.3)",
                  backgroundColor: "#2563eb",
                  color: "#ffffff",
                  minWidth: "220px",
                }}
              >
                들어가기 (Juan과 대화하기)
              </button>
            </Link>

            <button
              onClick={handleLogout}
              style={{
                padding: "10px 20px",
                fontSize: "14px",
                borderRadius: "999px",
                border: "1px solid #4b5563",
                cursor: "pointer",
                backgroundColor: "transparent",
                color: "#e5e7eb",
              }}
            >
              로그아웃
            </button>
          </>
        ) : (
          // ❌ 비로그인 상태
          <>
            <Link href="/chat?mode=guest">
              <button
                style={{
                  padding: "16px 32px",
                  fontSize: "18px",
                  borderRadius: "12px",
                  border: "none",
                  cursor: "pointer",
                  boxShadow: "0 4px 10px rgba(0,0,0,0.3)",
                  backgroundColor: "#22c55e",
                  color: "#ffffff",
                  minWidth: "220px",
                }}
              >
                대화 체험하기
              </button>
            </Link>

            <Link href="/login">
              <button
                style={{
                  padding: "12px 28px",
                  fontSize: "16px",
                  borderRadius: "999px",
                  border: "1px solid #4b5563",
                  cursor: "pointer",
                  backgroundColor: "transparent",
                  color: "#e5e7eb",
                  minWidth: "220px",
                }}
              >
                로그인
              </button>
            </Link>
          </>
        )}
      </div>
    </main>
  );
}
