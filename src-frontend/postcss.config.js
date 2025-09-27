module.exports = {
  plugins: {
    'postcss-import': {},
    'tailwindcss/nesting': 'postcss-nesting',
    'cssnano': {
      preset: 'default'
    },
    tailwindcss: {},
    autoprefixer: {},
  }
}