import ChatWindow from "./components/ChatWindow";

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
      <ChatWindow />
    </div>
  );
}
