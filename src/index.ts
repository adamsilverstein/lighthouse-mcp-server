import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const PAGESPEED_API_BASE = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";
const PAGESPEED_API_KEY = process.env.PAGESPEED_API_KEY || ""; // Ensure you set your API key in the environment or enter here.

// Create server instance
const server = new McpServer({
  name: "lighthouse",
  version: "1.0.0",
});

// TypeScript interfaces for PageSpeed API response
interface PageSpeedResponse {
  lighthouseResult?: {
    categories?: {
      performance?: {
        score?: number;
      };
      accessibility?: {
        score?: number;
      };
      "best-practices"?: {
        score?: number;
      };
      seo?: {
        score?: number;
      };
      pwa?: {
        score?: number;
      };
    };
    audits?: {
      [key: string]: {
        id?: string;
        title?: string;
        description?: string;
        score?: number;
        displayValue?: string;
        numericValue?: number;
        details?: any;
      };
    };
  };
  loadingExperience?: {
    metrics?: {
      FIRST_CONTENTFUL_PAINT_MS?: {
        percentile?: number;
        category?: string;
      };
      FIRST_INPUT_DELAY_MS?: {
        percentile?: number;
        category?: string;
      };
    };
    overall_category?: string;
  };
  error?: {
    code?: number;
    message?: string;
  };
}

// Helper function for making PageSpeed API requests
async function makePageSpeedRequest(
  url: string,
  strategy: string = "mobile",
  category: string = "performance",
  apiKey: string = PAGESPEED_API_KEY,
  timeoutMs: number = 150000
): Promise<PageSpeedResponse | null> {
  const apiUrl = `${PAGESPEED_API_BASE}?url=${encodeURIComponent(url)}&strategy=${strategy}&category=${category}&key=${apiKey}`;

  try {
    // Create an AbortController with the specified timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(apiUrl, {
      signal: controller.signal
    });

    // Clear the timeout to prevent memory leaks
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return await response.json() as PageSpeedResponse;
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'AbortError') {
      console.error(`Request timed out after ${timeoutMs/1000} seconds`);
    } else {
      console.error("Error making PageSpeed request:", error);
    }
    return null;
  }
}

// Helper function to format performance metrics
function formatPerformanceMetrics(data: PageSpeedResponse): string {
  if (!data.lighthouseResult?.audits) {
    return "No performance metrics available";
  }

  const audits = data.lighthouseResult.audits;
  const metrics = [
    "first-contentful-paint",
    "largest-contentful-paint",
    "total-blocking-time",
    "cumulative-layout-shift",
    "speed-index",
    "interactive"
  ];

  return metrics
    .filter(metric => audits[metric])
    .map(metric => {
      const audit = audits[metric];
      return `${audit.title || metric}: ${audit.displayValue || "N/A"}`;
    })
    .join("\n");
}

// Helper function to format opportunities
function formatOpportunities(data: PageSpeedResponse): string {
  if (!data.lighthouseResult?.audits) {
    return "No opportunities available";
  }

  const audits = data.lighthouseResult.audits;
  const opportunities = Object.values(audits).filter(
    audit => audit.details?.type === "opportunity" && audit.score !== null && audit.score !== undefined && audit.score < 1
  );

  if (opportunities.length === 0) {
    return "No improvement opportunities found";
  }

  return opportunities
    .map(opp => {
      const savings = opp.displayValue ? ` (${opp.displayValue})` : "";
      return `${opp.title}${savings}`;
    })
    .join("\n");
}

// Register lighthouse tool
server.tool(
  "get-lighthouse-report",
  "Get Lighthouse performance report for a URL",
  {
    url: z.string().url().describe("URL of the webpage to analyze"),
    category: z.enum(["performance", "accessibility", "best-practices", "seo", "pwa"])
      .optional()
      .default("performance")
      .describe("Lighthouse category to include"),
    strategy: z.enum(["mobile", "desktop"])
      .optional()
      .default("mobile")
      .describe("Analysis strategy"),
    timeout: z.number()
      .optional()
      .default(60000)
      .describe("Timeout in milliseconds (default: 60000)"),
  },
  async ({ url, category = "performance", strategy = "mobile", timeout = 60000 }) => {
    // Make API request
    const data = await makePageSpeedRequest(url, strategy, category, PAGESPEED_API_KEY, timeout);

    if (!data) {
      return {
        content: [
          {
            type: "text",
            text: `Failed to retrieve Lighthouse data for ${url}`,
          },
        ],
      };
    }

    if (data.error) {
      return {
        content: [
          {
            type: "text",
            text: `Error: ${data.error.message || "Unknown error"}`,
          },
        ],
      };
    }

    // Extract performance score
    const score = data.lighthouseResult?.categories?.[category]?.score;
    const formattedScore = score !== undefined ? Math.round(score * 100) : "N/A";

    // Format response
    const responseText = [
      `Lighthouse ${category} report for: ${url}`,
      `Strategy: ${strategy}`,
      `Score: ${formattedScore}/100`,
      "",
      "--- Key Metrics ---",
      formatPerformanceMetrics(data),
      "",
      "--- Opportunities for Improvement ---",
      formatOpportunities(data),
    ].join("\n");

    return {
      content: [
        {
          type: "text",
          text: responseText,
        },
      ],
    };
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Lighthouse MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
