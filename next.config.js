/** @type {import('next').NextConfig} */
const nextConfig = {
  // Make sure ALL your app/src files are bundled with the snapshot route
  outputFileTracingIncludes: {
    // Add BOTH keys to be safe across TS/JS compilation
    'app/api/snapshot/route.ts': ['app/**/*', 'src/**/*', 'docs/**/*', 'data/**/*', '!**/node_modules/**', '!**/.next/**'],
    'app/api/snapshot/route':    ['app/**/*', 'src/**/*', 'docs/**/*', 'data/**/*', '!**/node_modules/**', '!**/.next/**'],
    // Include data folder for all API routes that use CSV files
    'app/api/report/route.ts': ['data/**/*'],
    'app/api/report/route':    ['data/**/*'],
    'app/api/tickers/route.ts': ['data/**/*'],
    'app/api/tickers/route':    ['data/**/*'],
    'app/api/testcsv/route.ts': ['data/**/*'],
    'app/api/testcsv/route':    ['data/**/*'],
    'app/api/check-scenario-parity/route.ts': ['data/**/*'],
    'app/api/check-scenario-parity/route':    ['data/**/*'],
  },
};

module.exports = nextConfig;
