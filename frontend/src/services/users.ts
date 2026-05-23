import { pb } from "../lib/pocketbase";
import type { NotificationPrefs, PBUser, UserRole } from "../types";

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

export async function updateUserDenial(
  id: string,
  denial_notes: string
): Promise<PBUser> {
  return pb.collection("users").update<PBUser>(id, {
    role: "denied",
    denial_notes,
  });
}

export async function restoreUser(
  id: string,
  role: UserRole | ""
): Promise<PBUser> {
  return pb.collection("users").update<PBUser>(id, {
    role,
    denial_notes: "",
  });
}

export async function updateUserProfile(
  id: string,
  data: { name?: string; phone?: string; title?: string }
): Promise<PBUser> {
  return pb.collection("users").update<PBUser>(id, data, {
    requestKey: `update-profile-${id}`,
  });
}

export async function getUser(id: string): Promise<PBUser> {
  return pb.collection("users").getOne<PBUser>(id, {
    requestKey: `profile-self-${id}`,
  });
}

export async function updateNotificationPrefs(
  userId: string,
  prefs: NotificationPrefs
): Promise<void> {
  await pb.collection("users").update<PBUser>(
    userId,
    { notification_prefs: JSON.stringify(prefs) },
    { requestKey: `update-notif-prefs-${userId}` }
  );
}

