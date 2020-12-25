const colors = require('tailwindcss/colors');

const round = (num) =>
  num
    .toFixed(7)
    .replace(/(\.[0-9]+?)0+$/, '$1')
    .replace(/\.0$/, '');
const rem = (px) => `${round(px / 16)}rem`;
const em = (px, base) => `${round(px / base)}em`;

module.exports = {
  purge: {
    content: [
      '../index.html',
      '../_includes/*.html',
      '../_layouts/*.html',
    ],
  },
  darkMode: false, // or 'media' or 'class'
  theme: {
    fontFamily: {
      sans: [
        '"PT Sans"',
        'Helvetica',
        'Arial',
        'sans-serif',
      ],
      serif: [
        '"Abril Fatface"',
        'serif',
      ],
      mono: [
        '"JetBrains Mono"',
        'ui-monospace',
        'SFMono-Regular',
        'Menlo',
        'Monaco',
        'Consolas',
        '"Liberation Mono"',
        '"Courier New"',
        'monospace'
      ]
    },
    extend: {
      colors: {
        gray: colors.warmGray,
      },
      typography: (theme) => {

        return {
          DEFAULT: {
            css: {
              p: {
                marginTop: '0'
              },
              a: {
                color: theme('colors.blue.400'),
                textDecoration: 'none',
              },
              'a:hover': {
                textDecoration: 'underline'
              },

              'code::before, code::after': {
                content: '""'
              },
              code: {
                fontWeight: 'revert',
                color: '#bf616a',
                padding: `${rem(4)} ${rem(8)}`,
                backgroundColor: theme('colors.gray.50'),
                borderRadius: '3px',
              },
              pre: {
                color: theme('colors.gray.800'),
                backgroundColor: theme('colors.gray.50'),
                overflowWrap: 'break-word',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
              },
            }
          },
          small: {
            css: {
              fontSize: rem(16),
              lineHeight: rem(24),

              'h1, h2, h3': {
                marginTop: rem(16),
                marginBottom: rem(8),
              },

              h1: { fontSize: rem(32) },
              h2: { fontSize: rem(24) },
              h3: { fontSize: rem(20) },
              h4: { fontSize: rem(16) },

              code: {
                fontSize: rem(14),
              },
              pre: {
                fontSize: rem(14),
                lineHeight: rem(18),
              },
            },
          },
          large: {
            css: {
              fontSize: rem(20),
              lineHeight: rem(30),

              'h1, h2, h3': {
                marginTop: rem(20),
                marginBottom: rem(10),
              },

              h1: { fontSize: rem(40) },
              h2: { fontSize: rem(30) },
              h3: { fontSize: rem(25) },
              h4: { fontSize: rem(20) },

              code: {
                fontSize: rem(16),
              },
              pre: {
                fontSize: rem(16),
                lineHeight: rem(20),
              },
            }
          },
        };
      }
    },
  },
  variants: {
    extend: {},
  },
  plugins: [
    require('@tailwindcss/typography'),
  ],
}
