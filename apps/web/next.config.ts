import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      {
        source: '/disputes',
        destination: '/dashboard',
        permanent: true,
      },
      {
        source: '/identity',
        destination: '/dashboard',
        permanent: true,
      },
    ]
  },
};

export default nextConfig;
