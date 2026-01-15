import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServerClient";

const TTS_BUCKET = "tts-audio";

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
        if (item.metadata) out.push(fullPath);
        else queue.push(fullPath);
      }

      offset += data.length;
      if (data.length < limit) break;
    }
  }

  return out;
}

async function removeAllTtsUnderSession(sessionId: string) {
  const bucket = supabaseServer.storage.from(TTS_BUCKET);

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

      if (rmErr) console.error("[TTS_CLEANUP] remove error:", rmErr);
    }
  }

  const after = await collectAllFilePaths(sessionId);
  console.log("[TTS_CLEANUP] after delete:", { sessionId, remaining: after.length });
}

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

    if (!token) {
      return NextResponse.json({ ok: false, error: "Missing token" }, { status: 401 });
    }

    // 1) 토큰으로 현재 유저 확인
    const { data: userData, error: userErr } = await supabaseServer.auth.getUser(token);
    if (userErr || !userData?.user) {
      return NextResponse.json({ ok: false, error: "Invalid token" }, { status: 401 });
    }
    const userId = userData.user.id;

    // 2) ✅ Storage 삭제 (tts-audio / sessionId 아래 전부 재귀 삭제)
    const { data: sessions, error: sessionErr } = await supabaseServer
      .from("chat_sessions")
      .select("id")
      .eq("user_id", userId);

    if (sessionErr) {
      return NextResponse.json({ ok: false, error: sessionErr.message }, { status: 500 });
    }

    if (sessions?.length) {
      for (const s of sessions) {
        try {
          await removeAllTtsUnderSession(s.id);
        } catch (e) {
          console.error("[TTS_CLEANUP] session cleanup error:", { sessionId: s.id, e });
        }
      }
    }

    // 3) DB 삭제 (RPC)
    const { error: rpcErr } = await supabaseServer.rpc("delete_user_data", {
      p_user_id: userId,
    });
    if (rpcErr) {
      return NextResponse.json({ ok: false, error: rpcErr.message }, { status: 500 });
    }

    // 4) Auth 계정 삭제
    const { error: delAuthErr } = await supabaseServer.auth.admin.deleteUser(userId);
    if (delAuthErr) {
      return NextResponse.json({ ok: false, error: delAuthErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
