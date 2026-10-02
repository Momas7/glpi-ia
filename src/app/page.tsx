import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/server-session";

export default async function Home() {
  redirect((await getCurrentUser()) ? "/tickets" : "/login");
}
