const STORAGE_KEY = "kit_tracker_onboarding_v1";

export function hasSeenOnboarding(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "done";
  } catch {
    return false;
  }
}

export function markOnboardingDone(): void {
  try {
    localStorage.setItem(STORAGE_KEY, "done");
  } catch {
    // ignore — storage quota or private mode
  }
}
