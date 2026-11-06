"use client";

export function requestIdleTask(callback: () => void, timeout = 2000) {
  const browserWindow =
    typeof window === "undefined"
      ? null
      : (window as Window & typeof globalThis);

  if (!browserWindow) {
    return () => undefined;
  }

  if (typeof browserWindow.requestIdleCallback === "function") {
    const handle = browserWindow.requestIdleCallback(callback, { timeout });
    return () => browserWindow.cancelIdleCallback(handle);
  }

  const handle = globalThis.setTimeout(callback, timeout);
  return () => globalThis.clearTimeout(handle);
}

export function waitForIdle(timeout = 2000): Promise<void> {
  return new Promise((resolve) => {
    requestIdleTask(resolve, timeout);
  });
}
