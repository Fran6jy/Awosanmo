export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui"],
        mono: ["Fira Code", "ui-monospace", "monospace"]
      },
      colors: {
        ink: "#080914",
        panel: "rgba(18, 20, 38, .72)",
        line: "rgba(255,255,255,.12)",
        stream: "#22C55E",
        violet: "#4338CA"
      },
      boxShadow: {
        glass: "0 24px 80px rgba(0,0,0,.35)"
      },
      gridTemplateColumns: {
        24: "repeat(24, minmax(0, 1fr))"
      }
    }
  },
  plugins: []
};
