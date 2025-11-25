// app/chat/page.tsx
import { Suspense } from "react";
import ChatWindow from "./components/ChatWindow";

export const dynamic = "force-dynamic"; // (선택) /chat을 CSR로 강제

export default function ChatPage() {
  return (
    <div
      style={{
        height: "100vh",
        width: "100%",
        backgroundColor: "#111",
        color: "white",
        padding: "20px",
      }}
    >
      <Suspense fallback={<div>채팅 화면을 불러오는 중입니다...</div>}>
        <ChatWindow />
      </Suspense>
    </div>
  );
}
