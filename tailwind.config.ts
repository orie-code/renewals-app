import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        vitable: {
          green: "#003C32",
          berry: "#732E4A",
          cream: "#F7F3EA",
          paper: "#FFFDF8",
          sage: "#ECF2EE",
          sageline: "#D8E4DD",
        },
      },
    },
  },
  plugins: [],
};

export default config;
