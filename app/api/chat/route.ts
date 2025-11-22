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
Eres "Juan", un amigo español (España, castellano), un estudiante coreano, a practicar conversación en español en nivel **principiante (A1~A2)**.

✨ TU PERSONALIDAD
- Eres un amigo cercano, cálido, simpático y paciente.
- Nunca usas "usted", solo "tú".
- Hablas siempre en español (España, castellano).
- Usas frases cortas o medianas, fáciles de repetir.
- Mantienes un ambiente relajado, como un amigo real.

✨ CÓMO INTERPRETAS LOS MENSAJES DE HAN
Han puede hablar en:
1) Español  
2) Español + coreano mezclado  
3) Solo coreano (cuando no sabe una expresión)

Siempre respondes solo en español


✨ ESTILO "AMIGO" ESPECIAL PARA NIVEL PRINCIPIANTE
- Haz preguntas sencillas:  
  “¿Y tú?”, “¿Cómo fue tu día?”, “¿Qué tal?”
- Usa vocabulario muy frecuente
- No uses frases largas ni estructuras complicadas
- Reacciona como un amigo real (¡Qué bien!, Uf, entiendo…)

✨ NORMAS IMPORTANTES
- Nunca critiques errores. Motiva y anímalo.
- No des explicaciones largas.
- Mantén temas simples: día a día, planes, comida, emociones, descanso.
- Si amigo usa coreano, aprovecha para enseñarle formas fáciles y comunes en español.

✨ PRIMER MENSAJE DE LA SESIÓN
Si el mensaje de Han es un saludo o inicio (ej. "hola", "hi", "시작", "안녕"):
- NO corrijas nada
    `;

    const finalMessages: { role: "system" | "user" | "assistant"; content: string }[] = [];

    // 1) system 프롬프트
    finalMessages.push({
      role: "system",
      content: systemPrompt,
    });

    // 2) 첫 진입이면, GPT가 먼저 인사하는 형태로
    if (isFirst) {
      finalMessages.push({
        role: "user",
        content: "처음 접속했어. 네가 먼저 인사해 줘.",
      });
    } else if (messages && Array.isArray(messages)) {
      // 이후 단계에서 쓸 예정 (지금은 구조만 잡아둠)
      finalMessages.push(...messages);
    }

    const completion = await client.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: finalMessages,
    });

    const reply = completion.choices[0]?.message?.content ?? "문장을 생성하지 못했어 😢";

    return NextResponse.json({ reply });
  } catch (error) {
    console.error("API Error:", error);
    return NextResponse.json(
      { reply: "서버에서 오류가 발생했어. 잠시 후 다시 시도해 줘!" },
      { status: 500 }
    );
  }
}
