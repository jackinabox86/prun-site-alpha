"use client";

import { useEffect, useState } from "react";
import { safeGetLocalStorage, safeSetLocalStorage } from "@/lib/storage";

interface UsePersistedSettingsOptions<T> {
  urlParamName?: string;
  updateUrl?: boolean;
  serialize?: (val: T) => string;
  deserialize?: (str: string) => T | null;
}

function defaultSerialize<T>(val: T): string {
  if (typeof val === "boolean") {
    return val.toString();
  }
  return String(val);
}

function defaultDeserialize<T>(str: string, defaultValue: T): T | null {
  if (typeof defaultValue === "boolean") {
    return (str === "true") as T;
  }
  if (typeof defaultValue === "number") {
    const n = Number(str);
    return Number.isFinite(n) ? (n as T) : null;
  }
  return str as T;
}

export function usePersistedSettings<T>(
  settingKey: string,
  defaultValue: T,
  options: UsePersistedSettingsOptions<T> = {}
): [T, (value: T) => void] {
  const {
    urlParamName,
    updateUrl = false,
    serialize = defaultSerialize,
    deserialize = defaultDeserialize,
  } = options;

  // Always start from the default so the client's first render matches the
  // server-rendered HTML (reading localStorage/URL in the initializer causes
  // React hydration mismatches). The real value is applied on mount below.
  const [value, setValue] = useState<T>(defaultValue);

  // On mount, apply the persisted value with priority: URL params →
  // localStorage → default. The URL value applies to this session only — it
  // does NOT overwrite the user's stored setting, so opening a shared link
  // doesn't permanently change their preferences. The setting is persisted
  // only when the user changes it themselves (setPersistedValue).
  useEffect(() => {
    // 1. Check URL parameters (highest priority)
    if (urlParamName) {
      const params = new URLSearchParams(window.location.search);
      const urlValue = params.get(urlParamName);
      if (urlValue !== null) {
        const deserialized = deserialize(urlValue, defaultValue);
        if (deserialized !== null) {
          setValue(deserialized);
          return;
        }
      }
    }

    // 2. Check localStorage
    const storedValue = safeGetLocalStorage<T>(settingKey, defaultValue);
    if (storedValue !== defaultValue) {
      setValue(storedValue);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Custom setter that persists to localStorage and optionally URL
  const setPersistedValue = (newValue: T) => {
    setValue(newValue);

    // Save to localStorage
    safeSetLocalStorage(settingKey, newValue);

    // Optionally update URL
    if (updateUrl && typeof window !== "undefined") {
      const url = new URL(window.location.href);
      const serialized = serialize(newValue);

      if (urlParamName) {
        // For booleans, we handle them specially
        if (typeof newValue === "boolean") {
          if (newValue) {
            url.searchParams.set(urlParamName, "true");
          } else {
            url.searchParams.delete(urlParamName);
          }
        } else {
          url.searchParams.set(urlParamName, serialized);
        }
      }

      window.history.replaceState({}, "", url);
    }
  };

  return [value, setPersistedValue];
}
