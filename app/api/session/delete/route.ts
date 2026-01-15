import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServerClient";

const TTS_BUCKET = "tts-audio";

// ✅ prefix 아래 모든 파일 경로를 재귀로 수집
async function collectAllFilePaths(prefix: string): Promise<string[]> {
  const bucket = supabaseServer.storage.from(TTS_BUCKET);
  const out: string[] = [];

  const queue: string[] = [prefix];

  while (queue.length) {
    const current = queue.shift()!;

    let offset = 0;
    const limit = 1000;

    while (true) {
      const { data, error } = await bucket.list(current, {
        limit,
        offset,
        sortBy: { column: "name", order: "asc" },
      });

      if (error) {
        console.error("[TTS_CLEANUP] list error:", { current, error });
        break;
      }
      if (!data || data.length === 0) break;

      for (const item of data) {
        const name = item?.name?.trim();
        if (!name) continue;

        const fullPath = `${current}/${name}`;

        // ✅ 파일이면 metadata가 존재하는 경우가 대부분
        if (item.metadata) {
          out.push(fullPath);
        } else {
          // 폴더로 보고 더 들어감 (ex: sessionId/es, sessionId/es/u)
          queue.push(fullPath);
        }
      }

      offset += data.length;
      if (data.length < limit) break;
    }
  }

  return out;
}

async function removeAllTtsUnderSession(sessionId: string) {
  const bucket = supabaseServer.storage.from(TTS_BUCKET);

  // 삭제 전 수집 + 로그
  const before = await collectAllFilePaths(sessionId);
  console.log("[TTS_CLEANUP] before delete:", { sessionId, count: before.length });

  if (before.length) {
    for (let i = 0; i < before.length; i += 1000) {
      const chunk = before.slice(i, i + 1000);
      const { error: rmErr } = await bucket.remove(chunk);

      console.log("[TTS_CLEANUP] remove chunk:", {
        sessionId,
        chunkLen: chunk.length,
        error: rmErr ? String((rmErr as any).message ?? rmErr) : null,
      });

      if (rmErr) {
        // 여기서 멈추면 일부만 지워지고 끝날 수 있어서 일단 계속
        console.error("[TTS_CLEANUP] remove error:", rmErr);
      }
    }
  }

  // 삭제 후 재검증 + 로그
  const after = await collectAllFilePaths(sessionId);
  console.log("[TTS_CLEANUP] after delete:", { sessionId, remaining: after.length });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { sessionId } = body;

    if (!sessionId) {
      return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
    }

    const authHeader = req.headers.get("Authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;

    if (!token) {
      return NextResponse.json({ error: "Missing access token" }, { status: 401 });
    }

    const {
      data: { user },
      error: authError,
    } = await supabaseServer.auth.getUser(token);

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = user.id;

    // 1) 세션 소유 확인
    const { data: session, error: sessionError } = await supabaseServer
      .from("chat_sessions")
      .select("id, user_id")
      .eq("id", sessionId)
      .single();

    if (sessionError || !session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    if (session.user_id !== userId) {
      return NextResponse.json({ error: "Not allowed to delete this session" }, { status: 403 });
    }

    // 2) ✅ Storage TTS 삭제(재귀) + 검증 로그
    try {
      await removeAllTtsUnderSession(sessionId);
    } catch (e) {
      console.error("[TTS_CLEANUP] fatal error:", e);
      // storage 실패해도 DB 삭제는 진행
    }

    // 3) 학습 데이터 삭제
    try {
      const { data: cards, error: cardsError } = await supabaseServer
        .from("learning_cards")
        .select("id")
        .eq("session_id", sessionId)
        .eq("user_id", userId);

      if (cardsError) {
        console.error("learning_cards select error:", cardsError);
      } else if (cards && cards.length > 0) {
        const cardIds = cards.map((c) => c.id);

        const { error: attemptsDeleteError } = await supabaseServer
          .from("learning_attempts")
          .delete()
          .in("learning_card_id", cardIds);

        if (attemptsDeleteError) console.error("learning_attempts delete error:", attemptsDeleteError);

        const { error: cardsDeleteError } = await supabaseServer
          .from("learning_cards")
          .delete()
          .in("id", cardIds);

        if (cardsDeleteError) console.error("learning_cards delete error:", cardsDeleteError);
      }
    } catch (e) {
      console.error("Learning data cleanup error:", e);
    }

    // 4) 세션 삭제 (메시지 CASCADE)
    const { error: deleteError } = await supabaseServer
      .from("chat_sessions")
      .delete()
      .eq("id", sessionId)
      .eq("user_id", userId);

    if (deleteError) {
      return NextResponse.json({ error: deleteError.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
