import { ogKarti, OG_BOYUT, OG_TUR } from "@/lib/og/kart";

export const alt = "Comment LINK automation - OpenReply";
export const size = OG_BOYUT;
export const contentType = OG_TUR;

export default function Image() {
  return ogKarti("How it works", "Turn a keyword comment into a tracked link in DM");
}
