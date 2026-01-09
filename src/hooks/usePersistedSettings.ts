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

  // Initialize state with priority: URL params → localStorage → default
  const [value, setValue] = useState<T>(() => {
    // SSR safety
    if (typeof window === "undefined") {
      return defaultValue;
    }

    // 1. Check URL parameters (highest priority)
    if (urlParamName) {
      const params = new URLSearchParams(window.location.search);
      const urlValue = params.get(urlParamName);
      if (urlValue !== null) {
        const deserialized = deserialize(urlValue, defaultValue);
        if (deserialized !== null) {
          return deserialized;
        }
      }
    }

    // 2. Check localStorage
    const storedValue = safeGetLocalStorage<T>(settingKey, defaultValue);
    if (storedValue !== defaultValue) {
      return storedValue;
    }

    // 3. Return default
    return defaultValue;
  });

  // Track if we've checked URL params on mount
  const [urlParamsChecked, setUrlParamsChecked] = useState(false);

  // On mount, read from URL params if provided
  useEffect(() => {
    if (urlParamName && typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const urlValue = params.get(urlParamName);
      if (urlValue !== null) {
        const deserialized = deserialize(urlValue, defaultValue);
        if (deserialized !== null) {
          setValue(deserialized);
          // Save to localStorage
          safeSetLocalStorage(settingKey, deserialized);
        }
      }
    }
    setUrlParamsChecked(true);
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
