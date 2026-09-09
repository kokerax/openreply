import { ogKarti, OG_BOYUT, OG_TUR } from "@/lib/og/kart";

export const alt = "Manychat alternative - OpenReply";
export const size = OG_BOYUT;
export const contentType = OG_TUR;

export default function Image() {
  return ogKarti("Comparison", "A focused Manychat alternative for comment-to-DM");
}
