import { prisma } from "@/lib/db/client";
import type { Prisma } from "@/app/generated/prisma/client";

/**
 * Kalp atisi ve uyarilar artik Postgres'te (Redis anahtari + listesi yerine).
 * Serverless kurulumda 7/24 acik bir worker yok; "kalp atisi" son cron
 * cagrisinin izidir. Bayatlik esigi ayni kaldi: 120 sn.
 */

const WORKER_HEALTH_KEY = "health:worker:dm";
const WORKER_ALERTS_KEY = "alerts:worker:dm";
const WORKER_HEARTBEAT_TTL_SECONDS = 120;

export interface WorkerHeartbeat {
  status: "running";
  worker: "dm";
  pid: number;
  hostname?: string;
  startedAt?: string;
  /** Vercel bolgesi (VERCEL_REGION) — cron kurulumunda hangi bolgenin
   *  bosalttigini gormek icin; klasik worker'da genelde yok. */
  region?: string;
  checkedAt: string;
}

export interface WorkerHealth {
  healthy: boolean;
  heartbeat: WorkerHeartbeat | null;
  ageMs: number | null;
}

export interface WorkerAlert {
  level: "warning" | "error";
  message: string;
  jobId?: string;
  instagramAccountId?: string;
  commentId?: string;
  createdAt: string;
}

function parseJson<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export async function recordWorkerHeartbeat(
  heartbeat: Omit<WorkerHeartbeat, "checkedAt" | "status" | "worker">
) {
  // Cagiranlar bolgeyi bilmez; serverless'ta ortamdan okunur, yoksa alan yazilmaz.
  const region = heartbeat.region ?? process.env.VERCEL_REGION ?? undefined;
  const payload: WorkerHeartbeat = {
    ...heartbeat,
    ...(region ? { region } : {}),
    status: "running",
    worker: "dm",
    checkedAt: new Date().toISOString(),
  };

  // Prisma'nin Json alani `InputJsonValue` bekliyor; arayuz tipimiz ona
  // dogrudan atanamiyor, bu yuzden acik donusum.
  const json = payload as unknown as Prisma.InputJsonValue;
  await prisma.workerHealth.upsert({
    where: { id: WORKER_HEALTH_KEY },
    create: { id: WORKER_HEALTH_KEY, payload: json },
    update: { payload: json },
  });
}

export async function getWorkerHealth(): Promise<WorkerHealth> {
  const kayit = await prisma.workerHealth.findUnique({
    where: { id: WORKER_HEALTH_KEY },
  });
  // Redis'te TTL kaydi kendiliginden siliyordu; burada bayatligi yasa gore
  // degerlendiriyoruz, yoksa aylar once durmus bir worker "saglikli" gorunur.
  const heartbeat = (kayit?.payload as unknown as WorkerHeartbeat | undefined) ?? null;

  if (!heartbeat) {
    return { healthy: false, heartbeat: null, ageMs: null };
  }

  const ageMs = Date.now() - new Date(heartbeat.checkedAt).getTime();
  return {
    healthy: ageMs <= WORKER_HEARTBEAT_TTL_SECONDS * 1000,
    heartbeat,
    ageMs,
  };
}

export async function recordWorkerAlert(alert: Omit<WorkerAlert, "createdAt">) {
  const payload: WorkerAlert = {
    ...alert,
    createdAt: new Date().toISOString(),
  };

  const kayit = await prisma.workerHealth.findUnique({ where: { id: WORKER_ALERTS_KEY } });
  const mevcut = Array.isArray(kayit?.payload) ? (kayit.payload as unknown as WorkerAlert[]) : [];
  const yeni = [payload, ...mevcut].slice(0, 25) as unknown as Prisma.InputJsonValue;
  await prisma.workerHealth.upsert({
    where: { id: WORKER_ALERTS_KEY },
    create: { id: WORKER_ALERTS_KEY, payload: yeni },
    update: { payload: yeni },
  });
}

export async function getWorkerAlerts(limit = 10): Promise<WorkerAlert[]> {
  const kayit = await prisma.workerHealth.findUnique({ where: { id: WORKER_ALERTS_KEY } });
  const hepsi = Array.isArray(kayit?.payload) ? (kayit.payload as unknown as WorkerAlert[]) : [];
  return hepsi.slice(0, Math.max(0, limit));
}

/**
 * Panelde kirmizi rozet esigi: 3 dakika. `healthy` (120 sn) ile ayni sey
 * DEGIL — o cron'un dogal aralik payi, bu "birisi baksin" siniri.
 */
export const KALP_ATISI_KIRMIZI_MS = 3 * 60_000;

/** Yas bilinmiyorsa (hic kalp atisi yok) da bayat sayilir. */
export function kalpAtisiBayatMi(ageMs: number | null, esikMs = KALP_ATISI_KIRMIZI_MS): boolean {
  return ageMs === null || ageMs > esikMs;
}
