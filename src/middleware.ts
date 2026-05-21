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

export async function middleware(req: NextRequest) {
  const pw = process.env.SHARED_PASSWORD;
  if (!pw) {
    // Fail closed when misconfigured.
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("error", "misconfigured");
    url.searchParams.delete("next");
    return NextResponse.redirect(url);
  }

  const expected = await sha256Hex(pw);
  const got = req.cookies.get("auth")?.value;
  if (got === expected) return NextResponse.next();

  const url = req.nextUrl.clone();
  const nextPath = req.nextUrl.pathname + req.nextUrl.search;
  url.pathname = "/login";
  url.search = "";
  url.searchParams.set("next", nextPath);
  return NextResponse.redirect(url);
}

export const config = {
  // Run on every route except /login, the login API, Next internals, and static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|login|api/login).*)"],
};
