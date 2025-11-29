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
    const url = new URL(req.url);
    const m3u8Url = url.searchParams.get("url");

    if (!m3u8Url) {
      return new Response("Missing url parameter", {
        status: 400,
        headers: corsHeaders,
      });
    }

    console.log("rewrite-m3u8: fetching m3u8 from:", m3u8Url);

    // Fetch the original m3u8 playlist
    const response = await fetch(m3u8Url);
    
    if (!response.ok) {
      console.error("rewrite-m3u8: failed to fetch m3u8:", response.status);
      return new Response(`Failed to fetch m3u8: ${response.status}`, {
        status: 502,
        headers: corsHeaders,
      });
    }

    const content = await response.text();
    console.log("rewrite-m3u8: fetched m3u8 content, length:", content.length);

    // Parse the base URL from the m3u8 URL (everything before the filename)
    const baseUrl = m3u8Url.substring(0, m3u8Url.lastIndexOf("/") + 1);
    console.log("rewrite-m3u8: base URL:", baseUrl);

    // Rewrite relative URLs to absolute URLs
    const lines = content.split("\n");
    const rewrittenLines = lines.map((line) => {
      const trimmed = line.trim();
      
      // If it's not a comment and doesn't start with http, it's a relative segment URL
      if (trimmed && !trimmed.startsWith("#") && !trimmed.startsWith("http")) {
        const absoluteUrl = baseUrl + trimmed;
        console.log("rewrite-m3u8: rewriting", trimmed, "->", absoluteUrl);
        return absoluteUrl;
      }
      
      return line;
    });

    const rewrittenContent = rewrittenLines.join("\n");
    console.log("rewrite-m3u8: rewritten m3u8, length:", rewrittenContent.length);

    // Return the rewritten m3u8 as text/plain (or application/vnd.apple.mpegurl)
    return new Response(rewrittenContent, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/vnd.apple.mpegurl",
        "Cache-Control": "no-cache",
      },
    });
  } catch (error) {
    console.error("rewrite-m3u8: error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
