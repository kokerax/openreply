import pg from "pg";
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
console.log((await c.query(`select column_name,is_nullable,column_default from information_schema.columns where table_name='DmLog' order by ordinal_position`)).rows.map(r=>`${r.column_name}${r.is_nullable==='NO'?'*':''}`).join(", "));
console.log("\nMEVCUT MUHUR ORNEGI (isBackfill=true sayisi):", (await c.query(`select count(*) from "DmLog" where "isBackfill"=true`)).rows[0].count);
console.log("status degerleri:", JSON.stringify((await c.query(`select status,count(*) from "DmLog" group by status`)).rows));
await c.end();
