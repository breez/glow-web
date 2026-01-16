/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Core palette - Deep space with electric accents
        spark: {
          // Base backgrounds
          void: '#0a0a0f',      // Deepest background
          dark: '#0f0f18',      // Primary background
          surface: '#151520',   // Card backgrounds
          elevated: '#1a1a28',  // Elevated surfaces
          
          // Borders and subtle elements
          border: '#252535',
          'border-light': '#35354a',
          
          // Primary accent - Electric amber/gold (Bitcoin inspired)
          amber: '#f7931a',
          'amber-light': '#ffb347',
          'amber-glow': 'rgba(247, 147, 26, 0.4)',
          
          // Secondary accent - Electric blue (Lightning inspired)
          electric: '#00d4ff',
          'electric-light': '#7df3ff',
          'electric-glow': 'rgba(0, 212, 255, 0.3)',
          
          // Tertiary - Purple/violet for depth
          violet: '#8b5cf6',
          'violet-light': '#a78bfa',
          'violet-glow': 'rgba(139, 92, 246, 0.3)',
          
          // Semantic colors
          success: '#10b981',
          'success-glow': 'rgba(16, 185, 129, 0.3)',
          error: '#ef4444',
          'error-glow': 'rgba(239, 68, 68, 0.3)',
          warning: '#f59e0b',
          
          // Text
          'text-primary': '#ffffff',
          'text-secondary': 'rgba(255, 255, 255, 0.7)',
          'text-muted': 'rgba(255, 255, 255, 0.4)',
        }
      },
      fontFamily: {
        // Outfit for display/headlines - geometric, modern, bold
        display: ['Outfit', 'system-ui', 'sans-serif'],
        // DM Sans for body text - readable, clean
        sans: ['DM Sans', 'system-ui', 'sans-serif'],
        // JetBrains Mono for code/numbers
        mono: ['JetBrains Mono', 'Consolas', 'monospace'],
      },
      fontSize: {
        // Custom large display sizes
        'display-xl': ['4rem', { lineHeight: '1.1', letterSpacing: '-0.02em' }],
        'display-lg': ['3rem', { lineHeight: '1.1', letterSpacing: '-0.02em' }],
        'display-md': ['2.25rem', { lineHeight: '1.2', letterSpacing: '-0.01em' }],
        'display-sm': ['1.5rem', { lineHeight: '1.3', letterSpacing: '-0.01em' }],
      },
      backgroundImage: {
        // Gradient backgrounds
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'gradient-conic': 'conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))',
        'glow-amber': 'radial-gradient(ellipse at center, rgba(247, 147, 26, 0.15) 0%, transparent 70%)',
        'glow-electric': 'radial-gradient(ellipse at center, rgba(0, 212, 255, 0.1) 0%, transparent 70%)',
        'glow-violet': 'radial-gradient(ellipse at center, rgba(139, 92, 246, 0.1) 0%, transparent 70%)',
        'mesh': 'linear-gradient(135deg, rgba(139, 92, 246, 0.05) 0%, transparent 50%), linear-gradient(225deg, rgba(247, 147, 26, 0.05) 0%, transparent 50%)',
      },
      boxShadow: {
        'glow-amber': '0 0 40px rgba(247, 147, 26, 0.3)',
        'glow-electric': '0 0 40px rgba(0, 212, 255, 0.3)',
        'glow-success': '0 0 30px rgba(16, 185, 129, 0.4)',
        'glow-error': '0 0 30px rgba(239, 68, 68, 0.4)',
        'glass': '0 8px 32px rgba(0, 0, 0, 0.4)',
        'glass-lg': '0 16px 48px rgba(0, 0, 0, 0.5)',
      },
      animation: {
        'pulse-slow': 'pulse 3s ease-in-out infinite',
        'glow-pulse': 'glow-pulse 2s ease-in-out infinite',
        'float': 'float 6s ease-in-out infinite',
        'shimmer': 'shimmer 2s linear infinite',
        'spin-slow': 'spin 3s linear infinite',
        'bounce-subtle': 'bounce-subtle 2s ease-in-out infinite',
      },
      keyframes: {
        'glow-pulse': {
          '0%, 100%': { opacity: '0.6' },
          '50%': { opacity: '1' },
        },
        'float': {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-10px)' },
        },
        'shimmer': {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        'bounce-subtle': {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-5px)' },
        },
      },
      backdropBlur: {
        'xs': '2px',
      },
    },
  },
  plugins: [],
  darkMode: 'class',
}
