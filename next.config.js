/** @type {import('next').NextConfig} */
const nextConfig = {
  // Make sure ALL your app/src files are bundled with the snapshot route
  outputFileTracingIncludes: {
    // Add BOTH keys to be safe across TS/JS compilation
    'app/api/snapshot/route.ts': ['app/**/*', 'src/**/*', 'docs/**/*', 'public/data/**/*', '!**/node_modules/**', '!**/.next/**'],
    'app/api/snapshot/route':    ['app/**/*', 'src/**/*', 'docs/**/*', 'public/data/**/*', '!**/node_modules/**', '!**/.next/**'],
    // Include data folder for all API routes that use CSV files
    'app/api/report/route.ts': ['public/data/**/*'],
    'app/api/report/route':    ['public/data/**/*'],
    'app/api/tickers/route.ts': ['public/data/**/*'],
    'app/api/tickers/route':    ['public/data/**/*'],
    'app/api/testcsv/route.ts': ['public/data/**/*'],
    'app/api/testcsv/route':    ['public/data/**/*'],
    'app/api/check-scenario-parity/route.ts': ['public/data/**/*'],
    'app/api/check-scenario-parity/route':    ['public/data/**/*'],
  },
};

module.exports = nextConfig;
