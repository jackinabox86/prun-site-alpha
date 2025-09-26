/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Ensure these folders are bundled with the snapshot route
    outputFileTracingIncludes: {
      'app/api/snapshot/route.ts': [
        'app/**/*',
        'src/**/*',
        '!**/node_modules/**',
        '!**/.next/**',
      ],
    },
  },
};

module.exports = nextConfig;
