/**
 * Stead design system v1 (redesign-handoff/design/01-DESIGN-SYSTEM.md).
 *
 * Semantic tokens come first. The block marked "legacy aliases" maps the old
 * paper/spruce/brass/linen/claim names onto the new values so routes that have
 * not been migrated yet keep rendering in the new palette; each screen ticket
 * removes its own uses of the old names, and the aliases go when the last one
 * does. Do not add new uses of an alias.
 */
const ui = ["Hanken Grotesk", "Helvetica Neue", "Arial", "system-ui", "sans-serif"];

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "#FFFFFF",
        surface: { DEFAULT: "#F5F7F6", accent: "#E9F1EC" },
        ink: { DEFAULT: "#17201B", secondary: "#53625A" },
        brand: { DEFAULT: "#1E4034", hover: "#16332A" },
        divider: "#DCE2DE",
        control: "#88968F",
        focus: "#276A52",
        danger: { DEFAULT: "#A73528", surface: "#FAEBE8" },
        warning: { DEFAULT: "#78520B", surface: "#FFF1DD" },

        // --- legacy aliases (transitional; see file header) ---------------
        paper: "#FFFFFF",
        spruce: { DEFAULT: "#1E4034", deep: "#16332A" },
        brass: { DEFAULT: "#276A52", light: "#E9F1EC", deep: "#53625A" },
        linen: { DEFAULT: "#F5F7F6", tint: "#DCE2DE" },
        claim: "#A73528",
      },
      fontFamily: {
        sans: ui,
        ui,
        // Legacy names: the serif display face is retired; both resolve to the sans.
        display: ui,
        money: ui,
      },
      fontSize: {
        // Named steps from the design system, in rem so text zoom works.
        metadata: ["0.75rem", { lineHeight: "1.5" }],
        label: ["0.875rem", { lineHeight: "1.45" }],
        body: ["1rem", { lineHeight: "1.55" }],
        "body-lg": ["1.125rem", { lineHeight: "1.6" }],
        "card-title": ["1.25rem", { lineHeight: "1.25", letterSpacing: "-0.01em" }],
        "section-title": ["2rem", { lineHeight: "1.15", letterSpacing: "-0.02em" }],
        "page-title": ["2.5rem", { lineHeight: "1.1", letterSpacing: "-0.03em" }],
        "page-title-lg": ["3.25rem", { lineHeight: "1.08", letterSpacing: "-0.035em" }],
        "hero-sm": ["3rem", { lineHeight: "1.04", letterSpacing: "-0.04em" }],
        "hero-lg": ["5rem", { lineHeight: "1.02", letterSpacing: "-0.045em" }],
      },
      borderRadius: {
        control: "8px",
        card: "12px",
        surface: "16px",
      },
      boxShadow: {
        card: "0 1px 2px rgba(23, 32, 27, 0.06)",
        elevated: "0 8px 24px rgba(23, 32, 27, 0.10)",
        overlay: "0 16px 48px rgba(23, 32, 27, 0.18)",
      },
      maxWidth: {
        content: "1256px",
        narrow: "760px",
        reading: "640px",
      },
      minHeight: {
        control: "48px",
        "control-sm": "40px",
      },
      minWidth: {
        control: "48px",
      },
      transitionDuration: {
        fast: "120ms",
        DEFAULT: "180ms",
      },
      outlineColor: {
        focus: "#276A52",
      },
      ringColor: {
        focus: "#276A52",
      },
    },
  },
  plugins: [],
};
