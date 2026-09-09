import { ogKarti, OG_BOYUT, OG_TUR } from "@/lib/og/kart";

export const alt = "DM automation for agencies - OpenReply";
export const size = OG_BOYUT;
export const contentType = OG_TUR;

export default function Image() {
  return ogKarti("For agencies", "Run comment-to-DM for every client from one panel");
}
