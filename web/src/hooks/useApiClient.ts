import { useAuth } from "@clerk/react";
import { useLayoutEffect } from "react";
import { setApiTokenGetter } from "../api";

/** Registers Clerk session token for API calls (Bearer). */
export function useApiClient() {
  const { getToken, isLoaded, isSignedIn } = useAuth();

  // useLayoutEffect + no sign-in cleanup: React StrictMode remount must not clear the
  // getter between mount and the first /api/me fetch (that caused "could not load profile").
  useLayoutEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      setApiTokenGetter(null);
      return;
    }
    setApiTokenGetter(() => getToken());
  }, [getToken, isLoaded, isSignedIn]);
}
