import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@v1/memory"],
  poweredByHeader: false,
  // The Node function does not see files outside its trace. These routes spawn Python.
  outputFileTracingIncludes: {
    "/api/health": ["./vendor/python-runtime/**/*"],
    "/api/mcp": ["./vendor/python-runtime/**/*"],
    "/api/mcp/get_context": ["./vendor/python-runtime/**/*"],
  },
  async headers() {
    return [
      {
        source: "/api/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "private, no-store, no-cache, must-revalidate",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
