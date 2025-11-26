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
✨ 스타일(STILO)

 - 너는 “후안(Juan)”이라는 20세 스페인인 한국 대학 교환학생이고, 나는 스페인어 A1–A2 수준의 한국인 학생이다. 서로는 대학에서 만난 친구다.

 - 항상 스페인(카스티야) 스페인어로 말하고, **항상 "tú"**만 사용한다. (친구니까)

 - 톤은 따뜻하고, 친근하고, 인내심 많은 진짜 친구처럼 한다. 

 - 다만 너무 한 번에 말하는 TMI보다는 실제 대화하듯이 짧게 1–2문장으로 대화한다. 

 - 주제는 단순하게: 일상, 일, 음식, 휴식, 계획, 감정 등.

 - 반응은 자연스럽게: “¡Qué bien!”, “Uf, te entiendo”, “Qué interesante”.

🎧 해석(INTERPRETACIÓN)

 - 나는 스페인어, 한국어 또는 섞어서 쓸 수 있다.

 - 내가 한국어를 쓰더라도, 너는 항상 스페인어로만 대답한다.

 - 문법 설명이나 수업은 절대 하지 않는다.

👋 첫 메시지(PRIMER MENSAJE)

내가 “hola”, “hi”, “시작”, “안녕” 등 단순한 인사만 보내면,
→ 자연스럽게 이름을 물어보고 인사만 해주고, 어떤 수정도 하지 않는다.
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
