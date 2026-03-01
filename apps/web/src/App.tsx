import { useRef } from "react";
import { createWsClient } from "./lib/wsClient";

export default function App() {
  const wsRef = useRef(createWsClient(import.meta.env.VITE_WS_URL ?? "ws://localhost:4000/ws"));
  void wsRef;

  return (
    <div>
      <h1>Reflex Arena</h1>
    </div>
  );
}
