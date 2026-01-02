// app/join/consent/page.tsx
import { Suspense } from "react";
import ConsentClient from "./ConsentClient";

export const dynamic = "force-dynamic"; // (선택) 프리렌더 꼬임 방지용 안전장치

export default function ConsentPage() {
  return (
    <Suspense
      fallback={
        <main
          style={{
            minHeight: "100vh",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            backgroundColor: "#000000",
            padding: "24px 16px",
            color: "#9ca3af",
            fontSize: 14,
          }}
        >
          로딩 중...
        </main>
      }
    >
      <ConsentClient />
    </Suspense>
  );
}
