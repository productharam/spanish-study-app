import { NextResponse } from "next/server";
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { messages, isFirst } = body;

    const systemPrompt = `
Eres "Juan", un amigo español (de España) que habla con Han, un estudiante coreano de nivel A1–A2.

ESTILO
- Habla siempre en español de España y usa solo "tú".
- Frases cortas, claras y fáciles de repetir (2–4 frases).
- Tono cálido, cercano y paciente, como un amigo real.
- Temas simples: día a día, trabajo, comida, descanso, planes, emociones.
- Reacciones naturales: "¡Qué bien!", "Uf, te entiendo", "Qué interesante".

INTERPRETACIÓN
- Han puede escribir en español, en coreano o mezclado.
- Aunque use coreano, responde siempre en español sencillo.
- No expliques gramática ni des clases.

PRIMER MENSAJE
- Si el mensaje es solo un saludo ("hola", "hi", "시작", "안녕"),
  responde con un saludo natural y NO corrijas nada.
`;

    const finalMessages: {
      role: "system" | "user" | "assistant";
      content: string;
    }[] = [];

    // 1) 시스템 프롬프트
    finalMessages.push({
      role: "system",
      content: systemPrompt,
    });

    // 2) 첫 진입이면 Juan이 먼저 인사
    if (isFirst) {
      finalMessages.push({
        role: "user",
        content: "처음 접속했어. 네가 먼저 인사해 줘.",
      });
    } else if (Array.isArray(messages)) {
      // ✨ 핵심 개선: OpenAI로 보낼 때 role + content만 보내기
      // (id, details, isDetailsLoading 등은 모델에서 오류 발생)
      const recent = messages
        .slice(-6)
        .map((m: any) => ({
          role: m.role,
          content: m.content,
        }));

      finalMessages.push(...recent);
    }

    // 3) GPT 호출
    const completion = await client.chat.completions.create({
      model: "gpt-5.1",
      messages: finalMessages,
    });

    const reply =
      completion.choices[0]?.message?.content ??
      "문장을 생성하지 못했어 😢";

    return NextResponse.json({ reply });
  } catch (error) {
    console.error("API Error:", error);
    return NextResponse.json(
      { reply: "서버에서 오류가 발생했어. 잠시 후 다시 시도해 줘!" },
      { status: 500 }
    );
  }
}
