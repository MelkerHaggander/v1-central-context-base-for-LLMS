import { redirect } from "next/navigation";

/** Old Swedish path. Kept so the links in Confluence and the handovers still work. */
export default function AnslutPage() {
  redirect("/connect");
}
