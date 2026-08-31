import { NextResponse, type NextRequest } from "next/server";

const PROTECTED_PREFIXES = ["/dashboard", "/automations", "/logs", "/settings"];

function hasSessionCookie(request: NextRequest): boolean {
  return (
    request.cookies.has("authjs.session-token") ||
    request.cookies.has("__Secure-authjs.session-token") ||
    request.cookies.has("next-auth.session-token") ||
    request.cookies.has("__Secure-next-auth.session-token")
  );
}

export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
  const isLogin = pathname === "/login";
  const isAuthenticated = hasSessionCookie(request);

  if (isProtected && !isAuthenticated) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Buradan /dashboard'a yonlendirme YAPILMAZ — bilerek.
  //
  // `hasSessionCookie` yalnizca cerezin VAR olduguna bakar, gecerli oldugana
  // degil; dogrulamayi veritabanina karsi dashboard layout'u yapar. Ikisi
  // celiskiye dustugunde sonsuz dongu olusur: bayat bir oturum cerezi tasiyan
  // tarayici /dashboard'a alinir, layout oturumu bulamayip /login'e atar,
  // burasi cerezi gorup yine /dashboard'a yollar. Tarayici
  // ERR_TOO_MANY_REDIRECTS ile BEYAZ SAYFA gosterir.
  //
  // 2026-09-01'de tam bu yasandi: eski kurulumdan kalan cerez, ayni
  // NEXTAUTH_SECRET tasindigi icin yeni kuruluma gonderilmeye devam etti ve
  // panel hic acilmadi. Olculdu: 8 yonlendirme, /dashboard'a geri donuyor.
  //
  // Bu yonlendirme zaten bir guvenlik denetimi degil, yalnizca kolayliktir.
  // Kaldirilinca en fazla su olur: girisli bir kullanici /login'e giderse
  // formu gorur. Dongu ise imkansiz hale gelir.
  void isLogin;

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/automations/:path*",
    "/logs/:path*",
    "/settings/:path*",
    "/login",
  ],
};
