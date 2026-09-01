import NextAuth, { type NextAuthConfig } from "next-auth";
import Nodemailer from "next-auth/providers/nodemailer";
import Resend from "next-auth/providers/resend";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/db/client";
import { ensureWorkspaceForUser, getPrimaryWorkspace } from "@/lib/workspace";
import { isEmailAllowedToSignIn } from "@/lib/env";

type AdapterPrismaClient = Parameters<typeof PrismaAdapter>[0];

const emailFrom = process.env.EMAIL_FROM ?? "OpenReply <login@example.com>";
// Setting EMAIL_SERVER switches magic links to your own SMTP server, for
// self-hosters who do not want a third-party mail service. Resend stays the
// default, so an existing deployment is unaffected.
const smtpServer = process.env.EMAIL_SERVER;

/**
 * Provider id the login form has to sign in with. It differs per transport,
 * so it is derived here rather than hardcoded at the call site.
 */
export const EMAIL_PROVIDER_ID = smtpServer ? "nodemailer" : "resend";

export const authConfig = {
  adapter: PrismaAdapter(prisma as unknown as AdapterPrismaClient),
  providers: [
    smtpServer
      ? Nodemailer({ server: smtpServer, from: emailFrom })
      : Resend({
          apiKey: process.env.RESEND_API_KEY ?? "missing-resend-api-key",
          from: emailFrom,
        }),
  ],
  callbacks: {
    // Runs before the magic link is sent, so a blocked address never receives
    // one, and again when the link is verified.
    async signIn({ user }) {
      return isEmailAllowedToSignIn(user?.email);
    },
    async session({ session, user }) {
      if (session.user) {
        session.user.id = user.id;
      }
      return session;
    },
  },
  events: {
    async createUser({ user }) {
      if (user.id) {
        await ensureWorkspaceForUser(user.id, user.email);
      }
    },
  },
  pages: {
    signIn: "/login",
    verifyRequest: "/verify-request",
  },
  session: {
    strategy: "database",
  },
  trustHost: true,
  secret: process.env.NEXTAUTH_SECRET,
  /**
   * Gerçek giriş hatasını veritabanına yaz.
   *
   * Auth.js istemciye yalnızca sekiz "güvenli" hata tipini gösterir
   * (@auth/core/errors.js:412: CredentialsSignin, OAuthAccountNotLinked,
   * OAuthCallbackError, AccessDenied, Verification, MissingCSRF,
   * AccountNotLinked, WebAuthnVerificationError). Listede olmayan HER hata
   * kullanıcıya `Configuration` diye görünür (@auth/core/index.js:131).
   *
   * Yani ekrandaki "There is a problem with the server configuration" bir
   * teşhis değil, ÇÖP KUTUSU etiketidir: SMTP gönderimi başarısız olduğunda da
   * aynı sayfa çıkar, çünkü `EmailSignInError` (errors.js:333) o listede yok.
   *
   * 2026-09-01'de tam bu yaşandı — kullanıcı bu ekranı gördü, yapılandırmada
   * hiçbir sorun yoktu (env tam, callback uçtan uca çalışıyordu), sunucu logu
   * da dışarıdan okunamadı. Gerçek hatayı buraya yazmak bir daha tahmin
   * etmeyi bitirir; panelde ve denetimde görünür olur.
   */
  logger: {
    error(error: Error) {
      console.error("[auth]", error.name, error.message);
      // Kayıt bir YAN ETKİDİR: yazma başarısız olursa giriş akışını bozma.
      // Uretim derlemesinde sinif adi kucultuluyor ("S"), bu yuzden basliga
      // Auth.js'in KENDI tipini yaziyoruz — okunur ve gruplanabilir olan o.
      const tip = (error as { type?: string }).type ?? "Configuration";
      void prisma.operationalEvent
        .create({
          data: {
            source: "SYSTEM",
            level: "ERROR",
            message: `Giris hatasi: ${tip}`,
            payload: {
              ad: error.name,
              mesaj: error.message,
              kullaniciyaGorunen: tip,
              yigin: error.stack?.slice(0, 900) ?? null,
              // AdapterError/EmailSignInError gibi sarmalayicilar ASIL hatayi
              // `cause` icinde tasir (Prisma/SMTP mesaji). Onsuz kayit "Read
              // more at errors.authjs.dev" der ve teshis edilemez.
              sebep: sebepMetni(error),
            },
          },
        })
        .catch(() => {});
    },
    warn(kod: string) {
      console.warn("[auth]", kod);
    },
    debug() {},
  },
} satisfies NextAuthConfig;

/** Sarmalanmis hatanin kokunu duz metne cevirir (en fazla 3 katman). */
function sebepMetni(error: unknown): string | null {
  const parcalar: string[] = [];
  let cur: unknown = (error as { cause?: unknown })?.cause;
  for (let i = 0; i < 3 && cur; i++) {
    const c = cur as { err?: unknown; message?: string; code?: string; name?: string; cause?: unknown };
    const inner = (c.err ?? c) as { message?: string; code?: string; name?: string; cause?: unknown };
    const parca = [inner.name, inner.code, inner.message].filter(Boolean).join(" ");
    if (parca) parcalar.push(parca.slice(0, 400));
    cur = inner.cause ?? (c.err ? (c.err as { cause?: unknown }).cause : undefined);
  }
  return parcalar.length ? parcalar.join(" <- ") : null;
}

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);

export async function getCurrentUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}

export async function getCurrentWorkspaceId(): Promise<string | null> {
  const userId = await getCurrentUserId();
  if (!userId) return null;

  const workspace = await getPrimaryWorkspace(userId);
  if (workspace) return workspace.id;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });

  const createdWorkspace = await ensureWorkspaceForUser(userId, user?.email);
  return createdWorkspace.id;
}
