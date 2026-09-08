import pg from "pg";
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const q = async s => (await c.query(s)).rows;
console.log("KAMPANYA public reply ayarlari:");
console.table(await q(`select name,"publicReplyEnabled" acik,"publicReplyMessage" tekil,
 array_length("publicReplyMessages",1) varyant_sayisi from "Automation" order by "createdAt"`));
console.log("\nDM gitti ama YORUM CEVABI yok (kampanyada public reply ACIK olanlar):");
console.table(await q(`select a.name, count(*)::int adet,
  count(*) filter (where d."createdAt" > now() - interval '6 days')::int son_6_gun
  from "DmLog" d join "Automation" a on a.id=d."automationId"
  where d."isBackfill"=false and d.status='SENT' and d."publicReplySentAt" is null and a."publicReplyEnabled"=true
  group by 1`));
console.log("\nyorum cevabi BASARILI olanlar (ornek):", JSON.stringify(await q(`select count(*)::int n from "DmLog" where "publicReplySentAt" is not null`)));
console.log("yorum cevabi hatalari:", JSON.stringify(await q(`select left(coalesce("publicReplyError",'-'),50) h,count(*)::int from "DmLog" where "publicReplyError" is not null group by 1 limit 5`)));
await c.end();
