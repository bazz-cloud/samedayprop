/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          /*
           * HSTS. Browsers ignore it over plain HTTP, so it is safe to send
           * unconditionally; over HTTPS it stops a downgrade on the second
           * visit. Two years with subdomains, which is the preload threshold —
           * submit to the preload list only once the apex and every subdomain
           * genuinely serve HTTPS, because preloading is hard to undo.
           */
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains',
          },
          /* Cross-origin isolation: a payment page should not be embeddable,
             and should not leak window references to anything it opens. */
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'X-DNS-Prefetch-Control', value: 'off' },
        ],
      },
    ];
  },
};

export default nextConfig;
