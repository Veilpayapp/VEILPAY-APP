type ClipboardModule = {
  getStringAsync: () => Promise<string>;
  setStringAsync: (value: string) => Promise<void>;
};

let cachedClipboardModule: ClipboardModule | null | undefined;

function getClipboardModule(): ClipboardModule | null {
  if (cachedClipboardModule !== undefined) {
    return cachedClipboardModule;
  }

  try {
    const clipboard = require('expo-clipboard') as ClipboardModule;
    if (
      typeof clipboard.getStringAsync === 'function'
      && typeof clipboard.setStringAsync === 'function'
    ) {
      cachedClipboardModule = clipboard;
      return cachedClipboardModule;
    }
  } catch {
    // expo-clipboard is unavailable in this runtime.
  }

  cachedClipboardModule = null;
  return null;
}

export async function getClipboardString(): Promise<string> {
  const clipboard = getClipboardModule();
  if (!clipboard) {
    return '';
  }

  try {
    return await clipboard.getStringAsync();
  } catch {
    return '';
  }
}

export async function setClipboardString(value: string): Promise<boolean> {
  const clipboard = getClipboardModule();
  if (!clipboard) {
    return false;
  }

  try {
    await clipboard.setStringAsync(value);
    return true;
  } catch {
    return false;
  }
}
