export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Plus Jakarta Sans", "Inter", "ui-sans-serif", "system-ui"],
        mono: ["Fira Code", "ui-monospace", "monospace"]
      },
      colors: {
        // Dark premium surface system.
        ink: "#07070C",
        surface: "#12121A",
        surface2: "#171722",
        panel: "#0E0E16",
        line: "#FFFFFF14", // 8% white — hairline borders on dark
        // Accents
        stream: "#22C55E", // play / progress / success
        accent: "#6366F1", // primary indigo
        accent2: "#818CF8",
        violet: "#8B5CF6"
      },
      boxShadow: {
        glass: "0 24px 60px -24px rgba(0,0,0,.7)",
        glow: "0 8px 24px -8px rgba(99,102,241,.7)"
      },
      gridTemplateColumns: {
        24: "repeat(24, minmax(0, 1fr))"
      }
    }
  },
  plugins: []
};
