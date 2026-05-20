import { useAuth } from "@clerk/react";
import { useEffect } from "react";
import { setApiTokenGetter } from "../api";

/** Registers Clerk session token for API calls (Bearer). */
export function useApiClient() {
  const { getToken, isLoaded, isSignedIn } = useAuth();

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      setApiTokenGetter(null);
      return;
    }
    setApiTokenGetter(() => getToken());
    return () => setApiTokenGetter(null);
  }, [getToken, isLoaded, isSignedIn]);
}
