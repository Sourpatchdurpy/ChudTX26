/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        pixel: ['"Press Start 2P"', 'monospace', 'cursive'],
        sans: ['"Plus Jakarta Sans"', 'sans-serif'],
      },
      colors: {
        metaDark: '#060B28',
        metaNavy: '#091336',
        metaBlue: '#0066FF',
        metaCyan: '#00E5FF',
        metaCoral: '#FF5376',
      }
    },
  },
  plugins: [],
}
