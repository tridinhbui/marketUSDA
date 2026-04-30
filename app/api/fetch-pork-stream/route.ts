import { fetchPorkDateRange } from "@/lib/fetch-pork-range";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

type StreamPart =
  | { type: "log"; t: string; message: string }
  | {
      type: "done";
      tab: "pork";
      startDate: string;
      endDate: string;
      generatedAt: string;
      rows: unknown[];
    }
  | { type: "error"; error: string };

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const start = (searchParams.get("start") ?? "").trim();
  const end = (searchParams.get("end") ?? "").trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    return new Response(
      JSON.stringify({
        error: "Query parameters start and end must be calendar dates in YYYY-MM-DD format.",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }
  if (start > end) {
    return new Response(JSON.stringify({ error: "start must be on or before end." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const encoder = new TextEncoder();
  const send = (obj: StreamPart) => encoder.encode(JSON.stringify(obj) + "\n");

  const stream = new ReadableStream({
    async start(controller) {
      try {
        controller.enqueue(send({ type: "log", t: new Date().toISOString(), message: `Start pull for ${start} -> ${end}` }));
        const { rows } = await fetchPorkDateRange(start, end, (entry) => {
          controller.enqueue(send({ type: "log", t: entry.t, message: entry.message }));
        });
        const generatedAt = new Date().toISOString();
        controller.enqueue(
          send({
            type: "done",
            tab: "pork",
            startDate: start,
            endDate: end,
            generatedAt,
            rows,
          })
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        controller.enqueue(send({ type: "error", error: msg }));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
