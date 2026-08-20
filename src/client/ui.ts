import { button, div, dynamic_child as dynamicChild, header, icon, sig, type ReactiveValue } from "@vaakx-dev/vrui";
import { Moon, Sun } from "lucide";

const theme = sig(readTheme());

export function topbar(
  status: ReactiveValue<string>,
  statusClass: ReactiveValue<string>,
): HTMLElement {
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
      dynamicChild(theme, (value) => icon(value === "dark" ? Sun : Moon, 15)),
    ),
  );
}

function readTheme(): string {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

function toggleTheme(): void {
  const next = theme.get() === "dark" ? "light" : "dark";
  theme.set(next);
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem("sendit-theme", next);
  } catch {
    // storage unavailable; theme simply won't persist
  }
}
