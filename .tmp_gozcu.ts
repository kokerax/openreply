import pg from "pg";
import { decryptToken } from "@/lib/meta/oauth";
import fs from "node:fs";

const OUT = "/tmp/claude-501/-Users-alikoker/af86df01-d8f2-4e53-94f7-963dc332ab4a/scratchpad/gozcu.log";
const log = (s: string) => { const l = `${new Date().toISOString().slice(11,19)} ${s}`; console.log(l); fs.appendFileSync(OUT, l + "\n"); };

async function main() {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const token = decryptToken((await c.query(`select "accessToken" from "InstagramAccount" limit 1`)).rows[0].accessToken);
  const cityId = (await c.query(`select id from "Automation" where name='CITY Şehir Promptu'`)).rows[0].id;
  const mid = (await (await fetch(`https://graph.instagram.com/v25.0/me/media?fields=id&limit=1&access_token=${token}`)).json() as any).data[0].id;
  log(`gozcu basladi | post=${mid}`);

  let oncekiYorum = -1, ilkDmGorüldü = false;
  for (let i = 0; i < 40; i++) {           // 40 x 45sn = 30 dk
    const y: any = await (await fetch(`https://graph.instagram.com/v25.0/${mid}/comments?fields=id&limit=50&access_token=${token}`)).json();
    const yorumSayisi = (y.data ?? []).length;
    const d = (await c.query(
      `select status, count(*)::int adet, max(left(coalesce("errorMessage",''),60)) hata from "DmLog"
       where "automationId"=$1 and "isBackfill"=false group by status`, [cityId])).rows;
    const toplam = d.reduce((a, r) => a + r.adet, 0);

    if (yorumSayisi !== oncekiYorum || toplam > 0) {
      log(`yorum=${yorumSayisi} | CITY DmLog=${JSON.stringify(d)}`);
      oncekiYorum = yorumSayisi;
    }
    const sent = d.find(r => r.status === "SENT");
    const failed = d.find(r => r.status === "FAILED");
    if (sent && !ilkDmGorüldü) { log(`✅ ILK DM GITTI (${sent.adet} adet) — blok kalkmis, akis calisiyor`); ilkDmGorüldü = true; }
    if (failed) { log(`❌ BASARISIZ ${failed.adet} adet: ${failed.hata}`); break; }
    if (sent && sent.adet >= 3) { log(`✅ ${sent.adet} DM basariyla gitti, gozcu duruyor`); break; }
    await new Promise(r => setTimeout(r, 45000));
  }
  log("gozcu bitti");
  await c.end();
}
main().catch(e => { log("GOZCU HATASI: " + e.message); process.exit(1); });
