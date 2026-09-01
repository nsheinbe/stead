import type { Config } from 'tailwindcss'

// Tokens are transcribed from /design/DESIGN_HANDOFF.md. /design is design
// truth and is never edited; this file mirrors it.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        paper: '#FBFAF7',
        ink: '#17201B',
        spruce: { DEFAULT: '#1E4034', deep: '#16332A' },
        brass: { DEFAULT: '#B58B3E', light: '#DDB672', deep: '#8C6A2C' },
        linen: { DEFAULT: '#EFE9DF', tint: '#E8E0CE' },
        // Claim red is reserved for claim and dispute states only.
        claim: '#B3402A',
      },
      fontFamily: {
        display: ['"Ibarra Real Nueva"', 'Georgia', 'serif'],
        sans: ['"Hanken Grotesk"', 'system-ui', 'sans-serif'],
      },
      borderRadius: { card: '16px' },
      boxShadow: { card: '0 1px 3px rgba(23, 32, 27, 0.08)' },
    },
  },
  plugins: [],
} satisfies Config
