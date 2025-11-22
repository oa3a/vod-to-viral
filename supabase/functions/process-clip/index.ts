import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { encode as encodeBase64 } from "https://deno.land/std@0.168.0/encoding/base64.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { vodUrl, startTime, endTime } = await req.json();

    if (!vodUrl) {
      return new Response(
        JSON.stringify({ error: "vodUrl is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    console.log("process-clip: received request", { vodUrl, startTime, endTime });

    const sourceResponse = await fetch(vodUrl);

    if (!sourceResponse.ok) {
      const body = await sourceResponse.text();
      console.error("process-clip: failed to fetch source", sourceResponse.status, body);
      return new Response(
        JSON.stringify({ error: `Failed to fetch source: ${sourceResponse.status}` }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const contentType = sourceResponse.headers.get("content-type") || "";
    console.log("process-clip: source content-type", contentType);

    if (
      !contentType.includes("video") &&
      !contentType.includes("application/vnd.apple.mpegurl") &&
      !contentType.includes("application/octet-stream")
    ) {
      return new Response(
        JSON.stringify({ error: "Input is not a video — upload MP4 or provide a valid VOD." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const buffer = await sourceResponse.arrayBuffer();
    console.log("process-clip: source buffer size", buffer.byteLength, "bytes");

    const base64 = encodeBase64(buffer);

    return new Response(
      JSON.stringify({
        clipBase64: base64,
        mimeType: "video/mp4",
        note:
          "Server-side processing fallback currently returns the full source without trimming. Client-side ffmpeg handles precise clipping when available.",
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("Error in process-clip:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
