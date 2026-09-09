import pg from "pg";
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const q = async s => (await c.query(s)).rows;
console.log("=== DUNDEN BERI (kurtarma + yorum cevabi calisti mi) ===");
console.table(await q(`select status,count(*)::int adet from "DmLog" where "isBackfill"=false and "updatedAt" > now() - interval '18 hours' group by 1`));
console.log("yorum cevabi gonderilen (18 saat):", (await q(`select count(*)::int n from "DmLog" where "publicReplySentAt" > now() - interval '18 hours'`))[0].n);
console.log("hala cevapsiz (7 gun, aktif+metinli):", (await q(`select count(*)::int n from "DmLog" d join "Automation" a on a.id=d."automationId"
 where d."isBackfill"=false and d.status='SENT' and d."publicReplySentAt" is null and a."publicReplyEnabled"=true and a."isActive"=true
 and d."createdAt" > now() - interval '7 days'`))[0].n);
console.log("kurtarma bekleyen:", (await q(`select count(*)::int n from "DmLog" where status='FAILED' and "isBackfill"=false
 and "createdAt" > now() - interval '6 days' and ("errorMessage" like '%2534025%' or "errorMessage" like '%368%')`))[0].n);
console.log("CITY:", JSON.stringify(await q(`select status,count(distinct "commenterId")::int kisi from "DmLog"
 where "isBackfill"=false and "automationId"=(select id from "Automation" where name='CITY Şehir Promptu') group by 1`)));
console.log("toplanan e-posta:", (await q(`select count(*)::int n from "Lead"`))[0].n);
console.log("kuyruk:", JSON.stringify(await q(`select status,count(*)::int from "QueueJob" group by status`)));
const w=(await q(`select payload from "WorkerHealth"`))[0];
console.log("kalp atisi:", Math.round((Date.now()-new Date(w.payload.checkedAt).getTime())/1000),"sn once");
await c.end();
