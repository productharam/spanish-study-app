import Link from "next/link";

export default function Home() {
  return (
    <main
      style={{
        height: "100vh",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        backgroundColor: "#000000",   // ← 배경 색!
      }}
    >
      <Link href="/chat">
        <button
          style={{
            padding: "16px 32px",
            fontSize: "20px",
            borderRadius: "12px",
            border: "none",
            cursor: "pointer",
            boxShadow: "0 4px 10px rgba(0,0,0,0.1)",
            backgroundColor: "#2563eb",
            color: "#ffffff",
          }}
        >
          대화하기
        </button>
      </Link>
    </main>
  );
}
