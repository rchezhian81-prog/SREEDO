import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eef4ff",
          100: "#dbe6fe",
          500: "#3b62f6",
          600: "#2748db",
          700: "#1f38b0",
          900: "#1a2c70",
        },
      },
    },
  },
  plugins: [],
};

export default config;
