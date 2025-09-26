/** @type {import('next').NextConfig} */
const nextConfig = {
  // Make sure ALL your app/src files are bundled with the snapshot route
  outputFileTracingIncludes: {
    // Add BOTH keys to be safe across TS/JS compilation
    'app/api/snapshot/route.ts': ['app/**/*', 'src/**/*', 'docs/**/*', '!**/node_modules/**', '!**/.next/**'],
    'app/api/snapshot/route':    ['app/**/*', 'src/**/*', 'docs/**/*', '!**/node_modules/**', '!**/.next/**'],
  },
};

module.exports = nextConfig;
