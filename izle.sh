#!/bin/bash
cd ~/openreply
cat > /tmp/izle.ts <<'TS'
import { prisma } from "@/lib/db/client";
async function main() {
  const a = await prisma.automation.findFirstOrThrow({ where: { name: "GTA VI Prompt" } });
  const acilis = new Date("2026-09-02T14:37:25Z");
  const [dm, lead, durum, sonOlay] = await Promise.all([
    prisma.dmLog.count({ where: { automationId: a.id, createdAt: { gte: acilis } } }),
    prisma.lead.count({ where: { automationId: a.id } }),
    prisma.dmLog.groupBy({ by: ["status"], _count: true, where: { automationId: a.id, createdAt: { gte: acilis } } }),
    prisma.operationalEvent.findFirst({ where: { message: { contains: "GTA" } }, orderBy: { createdAt: "desc" }, select: { createdAt: true, message: true } }),
  ]);
  console.log(new Date().toISOString().slice(11,19), `| dmLog: ${dm} | e-posta: ${lead} |`, JSON.stringify(durum), "|", sonOlay?.message?.slice(0,70) ?? "(tarama olayi yok)");
}
main().finally(() => prisma.$disconnect());
TS
for i in $(seq 1 10); do node --env-file=.env --import tsx /tmp/izle.ts; sleep 60; done
