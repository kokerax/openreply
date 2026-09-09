import { ogKarti, OG_BOYUT, OG_TUR } from "@/lib/og/kart";

export const alt = "Comment-to-DM templates - OpenReply";
export const size = OG_BOYUT;
export const contentType = OG_TUR;

export default function Image() {
  return ogKarti("Templates", "Comment-to-DM campaign templates you can copy");
}
