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
    const urlObj = new URL(req.url);
    const playlistUrl = urlObj.searchParams.get("url");

    if (!playlistUrl) {
      return new Response("Missing url", { status: 400, headers: corsHeaders });
    }

    console.log("Rewriting playlist:", playlistUrl);

    // Fetch m3u8 playlist
    const upstream = await fetch(playlistUrl);
    if (!upstream.ok) {
      return new Response(`Failed to fetch upstream: ${upstream.status}`, {
        status: 502,
        headers: corsHeaders,
      });
    }

    const text = await upstream.text();

    // Base URL for relative resolution
    const base = playlistUrl.substring(0, playlistUrl.lastIndexOf("/") + 1);

    const rewritten = text
      .split("\n")
      .map((line) => {
        const trimmed = line.trim();

        // Ignore comments
        if (trimmed.startsWith("#")) return line;

        // Convert relative to absolute segment URL
        if (trimmed && !trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
          return base + trimmed;
        }

        return line;
      })
      .join("\n");

    return new Response(rewritten, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/vnd.apple.mpegurl",
      },
    });
  } catch (err) {
    console.error("rewrite-m3u8 ERROR:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
