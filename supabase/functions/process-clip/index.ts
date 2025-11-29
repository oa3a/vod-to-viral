import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

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

    if (!vodUrl || startTime == null || endTime == null) {
      return new Response(JSON.stringify({ error: "vodUrl, startTime, endTime are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const railwayResponse = await fetch("https://ffmpeg-clip-service-production.up.railway.app/clip", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vodUrl, startTime, endTime }),
    });

    const result = await railwayResponse.json();

    if (!railwayResponse.ok) {
      return new Response(JSON.stringify({ error: "Railway service error", details: result }), {
        status: 502,
        headers: corsHeaders,
      });
    }

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    // SAFE ERROR HANDLING
    const message = err instanceof Error ? err.message : "Unknown error";

    return new Response(JSON.stringify({ error: message }), { status: 500, headers: corsHeaders });
  }
});
