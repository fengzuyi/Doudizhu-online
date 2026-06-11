export type AppTheme = "classic" | "pixel";

const THEME_STORAGE_KEY = "doudizhu:theme";

export function readStoredTheme(): AppTheme {
  try {
    return localStorage.getItem(THEME_STORAGE_KEY) === "pixel" ? "pixel" : "classic";
  } catch {
    return "classic";
  }
}

export function persistTheme(theme: AppTheme) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Local storage can be unavailable in private or restricted browser modes.
  }
}

export function applyThemeToDocument(theme: AppTheme) {
  if (theme === "pixel") {
    document.documentElement.dataset.theme = "pixel";
  } else {
    delete document.documentElement.dataset.theme;
  }
}
