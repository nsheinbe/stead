/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: "#FBFAF7",
        ink: "#17201B",
        spruce: {
          DEFAULT: "#1E4034",
          deep: "#16332A",
        },
        brass: {
          DEFAULT: "#B58B3E",
          light: "#DDB672",
          deep: "#8C6A2C",
        },
        linen: {
          DEFAULT: "#EFE9DF",
          tint: "#E8E0CE",
        },
        claim: "#B3402A",
      },
      fontFamily: {
        display: ["Ibarra Real Nueva", "Georgia", "serif"],
        ui: ["Hanken Grotesk", "system-ui", "sans-serif"],
        money: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      borderRadius: {
        card: "16px",
      },
      boxShadow: {
        card: "0 1px 2px rgba(23,32,27,.05), 0 8px 22px rgba(23,32,27,.07)",
      },
    },
  },
  plugins: [],
};
