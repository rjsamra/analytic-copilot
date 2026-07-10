/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["DM Sans", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
      colors: {
        surface: {
          950: "#070b14",
          900: "#0d1424",
          800: "#131d33",
          700: "#1a2744",
          600: "#243352",
        },
        accent: {
          DEFAULT: "#22d3ee",
          dim: "#0891b2",
          glow: "#67e8f9",
        },
      },
      animation: {
        pulseGlow: "pulseGlow 2s ease-in-out infinite",
        flowDash: "flowDash 1.2s linear infinite",
      },
      keyframes: {
        pulseGlow: {
          "0%, 100%": { boxShadow: "0 0 0 0 rgba(34, 211, 238, 0.35)" },
          "50%": { boxShadow: "0 0 24px 4px rgba(34, 211, 238, 0.15)" },
        },
        flowDash: {
          to: { strokeDashoffset: "-20" },
        },
      },
    },
  },
  plugins: [],
};
