import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      { source: "/attest", destination: "/vouch", permanent: false },
      { source: "/openclaw", destination: "/skill.md", permanent: false },
      { source: "/verify/:handle", destination: "/agent/:handle", permanent: false },
      { source: "/@:handle", destination: "/agent/:handle", permanent: false },
    ];
  },
};

export default nextConfig;
