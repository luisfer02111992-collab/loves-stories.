/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: "#EDE7DE",
        paperRaised: "#F7F3EC",
        ink: "#2B1E2E",
        inkSoft: "#5B4E5E",
        line: "#D9D0C2",
        brass: "#9C7A3C",
        brassDark: "#7A5F2D",
        garnet: "#7A2540",
        garnetSoft: "#F4E3E6",
        sage: "#4F6F52",
        sageSoft: "#E4EBE1",
        gold: "#B7791F",
        goldSoft: "#F6EAD2",
      },
      fontFamily: {
        serif: ["'Iowan Old Style'", "Georgia", "serif"],
        cursive: ["'Dancing Script'", "'Segoe Script'", "cursive"],
      },
    },
  },
  plugins: [],
};
