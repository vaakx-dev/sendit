import { button, div, dynamic_child, header, icon, sig, type ReactiveValue } from "@vaakx-dev/vrui";
import { Moon, Sun } from "lucide";

type Theme = "light" | "dark";

const THEME_STORAGE_KEY = "sendit-theme";
const theme = sig<Theme>(document.documentElement.dataset.theme === "light" ? "light" : "dark");

export function topbar(status: ReactiveValue<string>, statusClass: ReactiveValue<string>): HTMLElement {
  return header(
    { class: "topbar" },
    div({ class: ["status", statusClass] }, status),
    button(
      {
        class: "theme-toggle",
        type: "button",
        "aria-label": "Toggle light or dark theme",
        title: "Toggle theme",
        on_click: toggleTheme,
      },
      dynamic_child(theme, (value) => icon(value === "dark" ? Sun : Moon, 15)),
    ),
  );
}

function toggleTheme(): void {
  const next: Theme = theme.get() === "dark" ? "light" : "dark";
  theme.set(next);
  document.documentElement.dataset.theme = next;
  localStorage.setItem(THEME_STORAGE_KEY, next);
}
