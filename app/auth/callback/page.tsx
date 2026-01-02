// app/auth/callback/page.tsx
import { Suspense } from "react";
import AuthCallbackClient from "./AuthCallbackClient";

export const dynamic = "force-dynamic";

export default function AuthCallbackPage() {
  return (
    <Suspense
      fallback={
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
          <div style={{ fontSize: 14, color: "#9ca3af" }}>로그인 처리 중...</div>
        </main>
      }
    >
      <AuthCallbackClient />
    </Suspense>
  );
}
