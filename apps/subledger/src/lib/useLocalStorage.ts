import { useEffect, useState } from "react";

/**
 * State that persists to localStorage. MVP persistence layer — the read/write
 * surface (a single key holding JSON) is deliberately small so it can be
 * swapped for a Supabase-backed store later without touching callers.
 */
export function useLocalStorage<T>(key: string, initial: T): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw !== null ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Storage full or unavailable (private mode); keep working in memory.
    }
  }, [key, value]);

  return [value, setValue];
}
