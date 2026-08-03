import { button, div, dynamic_child, header, icon, sig, type ReactiveValue } from "@vaakx-dev/vrui";
import { Moon, Sun } from "lucide";

const theme = sig(read_theme());

export function topbar(
  status: ReactiveValue<string>,
  status_class: ReactiveValue<string>,
): HTMLElement {
  return header(
    { class: "topbar" },
    div({ class: ["status", status_class] }, status),
    button(
      {
        class: "theme-toggle",
        type: "button",
        "aria-label": "Toggle light or dark theme",
        title: "Toggle theme",
        on_click: toggle_theme,
      },
      dynamic_child(theme, (value) => icon(value === "dark" ? Sun : Moon, 15)),
    ),
  );
}

function read_theme(): string {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

function toggle_theme(): void {
  const next = theme.get() === "dark" ? "light" : "dark";
  theme.set(next);
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem("sendit-theme", next);
  } catch {
    // storage unavailable; theme simply won't persist
  }
}
