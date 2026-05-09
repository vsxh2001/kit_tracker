import { pb } from "../lib/pocketbase";
import type { PBUser, UserRole } from "../types";

export async function listUsers(): Promise<PBUser[]> {
  return pb.collection("users").getFullList<PBUser>({
    sort: "-created",
    requestKey: "users-list",
  });
}

export async function updateUserRole(
  id: string,
  role: UserRole | ""
): Promise<PBUser> {
  return pb.collection("users").update<PBUser>(id, { role });
}
