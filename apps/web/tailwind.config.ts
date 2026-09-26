import type { Config } from "tailwindcss";

export default {
  // The app stamps light/dark on <html data-theme>, not a `.dark` class.
  // `dark:` utilities (department nav colors) follow that attribute.
  darkMode: ["selector", '[data-theme="dark"]'],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
        display: ["Montserrat", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "Consolas", "monospace"],
      },
      colors: {
        border: "hsl(var(--border))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        "form-field": "hsl(var(--form-field))",
        button: {
          DEFAULT: "hsl(var(--button))",
          foreground: "hsl(var(--button-foreground))",
        },
        card: "hsl(var(--card))",
        destructive: "hsl(var(--destructive))",
        ring: "hsl(var(--ring))",
        // ACCUQUAL QMS Status Color Architecture — compliance/workflow badges.
        success: {
          DEFAULT: "hsl(var(--success))",
          foreground: "hsl(var(--success-foreground))",
        },
        warning: {
          DEFAULT: "hsl(var(--warning))",
          foreground: "hsl(var(--warning-foreground))",
        },
        info: {
          DEFAULT: "hsl(var(--info))",
          foreground: "hsl(var(--info-foreground))",
        },
      },
      borderRadius: {
        lg: "14px",
        md: "10px",
        sm: "8px",
        xl: "14px",
        "2xl": "16px",
      },
    },
  },
  plugins: [],
} satisfies Config;
