export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Plus Jakarta Sans", "Inter", "ui-sans-serif", "system-ui"],
      },
      colors: {
        // Espresso-black surfaces with a maroon accent where Spotify is green.
        ink: "#0D0909",
        surface: "#171010",
        surface2: "#1F1616",
        panel: "#120C0C",
        raised: "#2A1D1D",
        line: "#FFFFFF14",
        accent: "#A32638",   // maroon: play buttons, active states, progress
        accent2: "#C43A4E",  // hover / lighter maroon
        gold: "#D4A056",     // warm secondary for highlights
        cream: "#F5EDE8",    // primary text
        muted: "#B8A9A3",    // secondary text
        dim: "#7A6C67",      // tertiary text
      },
      boxShadow: {
        card: "0 8px 24px rgba(0,0,0,.5)",
        glow: "0 8px 24px -6px rgba(163,38,56,.6)",
      },
    },
  },
  plugins: [],
};
