import { NextRequest, NextResponse } from "next/server";

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function safeNext(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/renewals";
  return raw;
}

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const password = String(form.get("password") ?? "");
  const next = safeNext(String(form.get("next") ?? "/renewals"));

  const expected = process.env.SHARED_PASSWORD;
  if (!expected) {
    return NextResponse.redirect(
      new URL(
        `/login?error=misconfigured&next=${encodeURIComponent(next)}`,
        req.url,
      ),
      303,
    );
  }
  if (password !== expected) {
    return NextResponse.redirect(
      new URL(
        `/login?error=invalid&next=${encodeURIComponent(next)}`,
        req.url,
      ),
      303,
    );
  }

  const hash = await sha256Hex(expected);
  const res = NextResponse.redirect(new URL(next, req.url), 303);
  res.cookies.set("auth", hash, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });
  return res;
}
