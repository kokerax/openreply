import { ogKarti, OG_BOYUT, OG_TUR } from "@/lib/og/kart";

export const alt = "OpenReply - Instagram comment-to-DM automation";
export const size = OG_BOYUT;
export const contentType = OG_TUR;

export default function Image() {
  return ogKarti("Open source", "Instagram comment-to-DM automation you can host yourself");
}
