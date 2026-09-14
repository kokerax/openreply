import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Kampanya uclarini panele girmeden (script / Claude) yonetmek icin Bearer
 * API anahtari.
 *
 * Anahtar `OPENREPLY_API_USER_EMAIL` kullanicisi ADINA calisir; rol
 * denetimleri (canManageWorkspace) oturum yolundaki gibi aynen uygulanir.
 * Iki env'den biri eksikse yol tamamen kapalidir — guvenli varsayilan.
 *
 * Yalnizca `Authorization` basligi kabul edilir: `?key=` URL'de loglara ve
 * gecmise duser.
 */
export function apiAnahtariGecerli(authorization: string | null): boolean {
  const beklenen = process.env.OPENREPLY_API_KEY;
  if (!beklenen || !process.env.OPENREPLY_API_USER_EMAIL) return false;
  if (!authorization?.startsWith("Bearer ")) return false;
  const verilen = authorization.slice("Bearer ".length);
  if (!verilen) return false;
  // Uzunluk sizdirmamak icin iki tarafi da hash'le, sabit zamanli karsilastir.
  const a = createHash("sha256").update(verilen).digest();
  const b = createHash("sha256").update(beklenen).digest();
  return timingSafeEqual(a, b);
}

export function apiKullaniciEpostasi(): string | null {
  const eposta = process.env.OPENREPLY_API_USER_EMAIL?.trim().toLowerCase();
  return eposta || null;
}
