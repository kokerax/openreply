import pg from "pg";
import { decryptToken } from "@/lib/meta/oauth";
async function main() {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const token = decryptToken((await c.query(`select "accessToken" from "InstagramAccount" limit 1`)).rows[0].accessToken);
  const j: any = await (await fetch(`https://graph.instagram.com/v25.0/me/media?fields=id,timestamp,comments_count,permalink&limit=1&access_token=${token}`)).json();
  const m = j.data[0];
  console.log(`POST ${m.permalink} | ${((Date.now()-new Date(m.timestamp).getTime())/60000).toFixed(0)} dk once | IG yorum sayaci: ${m.comments_count}`);
  const yorum: any = await (await fetch(`https://graph.instagram.com/v25.0/${m.id}/comments?fields=id,text,from,timestamp&limit=25&access_token=${token}`)).json();
  console.log(`API'den okunan yorum: ${(yorum.data ?? []).length}`, yorum.error ? "HATA:"+yorum.error.message : "");
  for (const y of (yorum.data ?? []).slice(0,8)) console.log(`   @${y.from?.username} "${(y.text??"").slice(0,20)}"`);
  const d = (await c.query(`select a.name, d.status, count(*)::int adet, max(d."createdAt") son from "DmLog" d join "Automation" a on a.id=d."automationId"
    where d."isBackfill"=false and d."createdAt" > now() - interval '30 minutes' group by 1,2`)).rows;
  console.log("SON 30 DK DmLog:", d.length ? JSON.stringify(d) : "(hic)");
  const w = (await c.query(`select payload from "WorkerHealth"`)).rows[0];
  console.log("kalp atisi:", Math.round((Date.now()-new Date(w.payload.checkedAt).getTime())/1000), "sn once");
  await c.end();
}
main().catch(e => { console.error("HATA:", e.message); process.exit(1); });
