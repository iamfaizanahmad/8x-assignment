import { redirect } from "next/navigation";

/** People open Minutes to see what's owed, not to browse recordings. */
export default function Home() {
  redirect("/open-items");
}
