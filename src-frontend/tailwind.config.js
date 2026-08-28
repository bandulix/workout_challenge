/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  safelist: [
    "animate-squad-orbit",
    "animate-squad-orbit-slow",
    "animate-squad-orbit-fast",
    "animate-squad-orbit-ccw",
    "animate-squad-orbit-tilt",
    "animate-squad-orbit-swing",
    "animate-squad-pip-wave",
    "animate-squad-hop",
    "animate-float-slow",
  ],
  theme: {
    extend: {
      colors: {
        // Signature "volt" accent - the Drill Instructor's whistle.
        volt: {
          100: '#f4ffc4',
          200: '#eaff8a',
          300: '#e1ff5c',
          400: '#d7ff3e',
          500: '#b8e62e',
          600: '#93b819',
          700: '#6f8f0f',
        },
        // Night charcoal for dark mode (neutral, not olive). Volt stays
        // the only green in the night UI so it actually pops.
        ink: {
          950: '#0b0b0c',
          900: '#101012',
          850: '#141416',
          800: '#1c1c20',
          700: '#2a2a32',
          600: '#3c3c46',
        },
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'Helvetica', 'Arial', 'sans-serif'],
        display: ['"Archivo Black"', 'Inter', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        '4xl': '2rem',
      },
      boxShadow: {
        'glow-volt': '0 0 24px rgba(215, 255, 62, 0.35)',
        'glow-volt-lg': '0 0 48px rgba(215, 255, 62, 0.45)',
        'card-dark': '0 8px 32px rgba(0, 0, 0, 0.45)',
        'card': '0 4px 24px rgba(11, 11, 12, 0.08)',
      },
      keyframes: {
        'slide-up': {
          '0%': { transform: 'translateY(16px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        'dock-expand': {
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'pop-in': {
          '0%': { transform: 'scale(0.92)', opacity: '0' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        'pulse-ring': {
          '0%': { boxShadow: '0 0 0 0 var(--pulse-ring-color, rgba(215, 255, 62, 0.55))' },
          '70%': { boxShadow: '0 0 0 14px transparent' },
          '100%': { boxShadow: '0 0 0 0 transparent' },
        },
        'float-slow': {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-6px)' },
        },
        'blink-caret': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0' },
        },
        'nav-rise': {
          '0%': { transform: 'translateY(110%)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        'volt-breathe': {
          '0%, 100%': { opacity: '0.35', transform: 'scale(1)' },
          '50%': { opacity: '0.8', transform: 'scale(1.08)' },
        },
        'squad-orbit': {
          '0%': { transform: 'rotate(0deg)' },
          '100%': { transform: 'rotate(360deg)' },
        },
        'squad-orbit-ccw': {
          '0%': { transform: 'rotate(0deg)' },
          '100%': { transform: 'rotate(-360deg)' },
        },
        'squad-orbit-tilt': {
          '0%': { transform: 'rotateX(58deg) rotateZ(0deg)' },
          '100%': { transform: 'rotateX(58deg) rotateZ(360deg)' },
        },
        'squad-orbit-swing': {
          '0%, 100%': { transform: 'rotate(-55deg)' },
          '50%': { transform: 'rotate(55deg)' },
        },
        'squad-pip-wave': {
          '0%, 100%': { transform: 'scale(1)', opacity: '0.4' },
          '40%': { transform: 'scale(1.65)', opacity: '1' },
        },
        'squad-hop': {
          '0%, 100%': { transform: 'translateY(0) scale(1)' },
          '50%': { transform: 'translateY(-3px) scale(1.2)' },
        },
        'kenburns': {
          '0%': { transform: 'scale(1) translate3d(0,0,0)' },
          '100%': { transform: 'scale(1.12) translate3d(0,-2%,0)' },
        },
      },
      animation: {
        'slide-up': 'slide-up 0.35s cubic-bezier(0.22, 1, 0.36, 1) both',
        'dock-expand': 'dock-expand 0.32s cubic-bezier(0.22, 1, 0.36, 1) both',
        'pop-in': 'pop-in 0.25s cubic-bezier(0.22, 1, 0.36, 1) both',
        'pulse-ring': 'pulse-ring 2.2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'float-slow': 'float-slow 4s ease-in-out infinite',
        'blink-caret': 'blink-caret 1s step-end infinite',
        'nav-rise': 'nav-rise 0.55s cubic-bezier(0.22, 1, 0.36, 1) both',
        'volt-breathe': 'volt-breathe 3.2s ease-in-out infinite',
        'kenburns': 'kenburns 28s ease-in-out infinite alternate',
        'squad-orbit-slow': 'squad-orbit 28s linear infinite',
        'squad-orbit': 'squad-orbit 16s linear infinite',
        'squad-orbit-fast': 'squad-orbit 9s linear infinite',
        'squad-orbit-ccw': 'squad-orbit-ccw 18s linear infinite',
        'squad-orbit-tilt': 'squad-orbit-tilt 14s linear infinite',
        'squad-orbit-swing': 'squad-orbit-swing 4.6s ease-in-out infinite',
        'squad-pip-wave': 'squad-pip-wave 1.6s ease-in-out infinite',
        'squad-hop': 'squad-hop 1.1s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
