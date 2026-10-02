import type { NextConfig } from "next";

const PYTHON_RUNTIME = ["./vendor/python-runtime/**/*"];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // The Node function does not see files outside its trace. These routes spawn Python.
  outputFileTracingIncludes: {
    "/api/health": PYTHON_RUNTIME,
    "/api/mcp": PYTHON_RUNTIME,
    "/api/mcp/get_context": PYTHON_RUNTIME,
    "/api/mcp/save_memory": PYTHON_RUNTIME,
    "/api/mcp/update_memory": PYTHON_RUNTIME,
    "/api/mcp/search_memory": PYTHON_RUNTIME,
    "/api/mcp/lesson_memory": PYTHON_RUNTIME,
    "/api/memories": PYTHON_RUNTIME,
    "/api/memories/[id]": PYTHON_RUNTIME,
    "/api/memories/[id]/versions": PYTHON_RUNTIME,
    "/api/memories/deleted": PYTHON_RUNTIME,
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
