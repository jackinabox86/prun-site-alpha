export function safeGetLocalStorage<T>(key: string, defaultValue: T): T {
  // SSR safety check
  if (typeof window === "undefined") {
    return defaultValue;
  }

  try {
    const item = window.localStorage.getItem(key);
    if (item === null) {
      return defaultValue;
    }

    // Parse JSON
    const parsed = JSON.parse(item);
    return parsed as T;
  } catch (error) {
    // Handle parse errors or other exceptions
    console.warn(`Error reading localStorage key "${key}":`, error);
    return defaultValue;
  }
}

export function safeSetLocalStorage<T>(key: string, value: T): boolean {
  // SSR safety check
  if (typeof window === "undefined") {
    return false;
  }

  try {
    const serialized = JSON.stringify(value);
    window.localStorage.setItem(key, serialized);
    return true;
  } catch (error) {
    // Handle quota exceeded or other errors
    console.warn(`Error writing to localStorage key "${key}":`, error);
    return false;
  }
}

export function safeRemoveLocalStorage(key: string): void {
  // SSR safety check
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.removeItem(key);
  } catch (error) {
    console.warn(`Error removing localStorage key "${key}":`, error);
  }
}
