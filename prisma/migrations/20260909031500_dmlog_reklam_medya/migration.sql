-- DmLog'a reklam/organik ayrimini mumkun kilan ham medya kimlikleri.
--
-- Bugune kadar bir yorumun reklamdan mi organik gonderiden mi geldigi
-- HICBIR YERDE saklanmiyordu: bilgi is yukunde (job payload) geliyor ve
-- gonderim sonrasi kayboluyordu. Olcum: son 90 gunde 898 yorum webhook'unun
-- 103'u (%11,5) reklam kopyasi, 2 farkli reklam medyasindan.
--
-- `originalMediaId` DOLU ise yorum bir reklam kopyasindadir (webhook katmani
-- media.id ile esit oldugunda zaten NULL birakiyor). Turetilmis bir `isAd`
-- bayragi yerine ham kimlikler tutuluyor; bayrak siniflandirma kurali
-- degisince bayatlar, kimlikler bayatlamaz.
ALTER TABLE "DmLog" ADD COLUMN "mediaId" TEXT;
ALTER TABLE "DmLog" ADD COLUMN "originalMediaId" TEXT;

-- Kirilim kampanya + tarih araliginda sorgulanacak.
CREATE INDEX "DmLog_automationId_originalMediaId_idx"
  ON "DmLog"("automationId", "originalMediaId");
