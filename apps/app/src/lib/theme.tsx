import { createContext, use, useCallback, useEffect, useState } from "react";

export type Theme = "dark" | "light";

const STORAGE_KEY = "ironcage-theme";

/**
 * Applies the stored theme before first paint. This runs in `<head>` as a
 * blocking script because the alternative — applying the class in an effect —
 * paints the wrong theme first and then corrects it. On a dark-by-default
 * interface that flash is a full-screen white frame.
 *
 * Dark is the default: anything other than an explicit "light" is dark.
 */
export const themeInitScript = `try{document.documentElement.classList.toggle("dark",localStorage.getItem(${JSON.stringify(
  STORAGE_KEY,
)})!=="light")}catch(e){}`;

type ThemeContextValue = {
  readonly theme: Theme;
  readonly setTheme: (theme: Theme) => void;
  readonly toggleTheme: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Dark on the server and on the first client render, matching the SSR'd
  // markup. The effect below reconciles with what the init script actually
  // applied, so hydration never mismatches.
  const [theme, setThemeState] = useState<Theme>("dark");

  useEffect(() => {
    setThemeState(document.documentElement.classList.contains("dark") ? "dark" : "light");
  }, []);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    document.documentElement.classList.toggle("dark", next === "dark");
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // A blocked storage API is not a reason to refuse to change theme; the
      // choice simply does not survive a reload.
    }
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(document.documentElement.classList.contains("dark") ? "light" : "dark");
  }, [setTheme]);

  return <ThemeContext value={{ theme, setTheme, toggleTheme }}>{children}</ThemeContext>;
}

export function useTheme(): ThemeContextValue {
  const context = use(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider.");
  }
  return context;
}
