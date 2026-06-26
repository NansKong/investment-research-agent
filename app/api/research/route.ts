import { NextRequest } from "next/server";
import { runInvestmentResearch } from "@/lib/agent/graph";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const { company } = await req.json();

  if (!company || typeof company !== "string" || !company.trim()) {
    return new Response(JSON.stringify({ error: "Missing 'company' in request body." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));

      try {
        send({ type: "log", message: `Starting research on "${company.trim()}"` });

        const result = await runInvestmentResearch(company.trim(), (line) => {
          send({ type: "log", message: line });
        });

        send({ type: "result", data: result });
      } catch (err: any) {
        console.error(err);
        send({
          type: "error",
          message:
            err?.message ||
            "Something went wrong while researching this company. Check your API keys and try again.",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache",
      "Transfer-Encoding": "chunked",
    },
  });
}
