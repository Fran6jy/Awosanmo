export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Plus Jakarta Sans", "Inter", "ui-sans-serif", "system-ui"],
        mono: ["Fira Code", "ui-monospace", "monospace"]
      },
      colors: {
        ink: "#0F172A",
        panel: "#FFFFFF",
        line: "#E2E8F0",
        stream: "#16A34A",
        violet: "#4F46E5"
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
