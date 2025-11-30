// rewrite-m3u8/index.ts
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
    const m3u8Param = urlObj.searchParams.get("url");
    if (!m3u8Param) {
      console.error("rewrite-m3u8: missing url parameter");
      return new Response("Missing url parameter", { status: 400, headers: corsHeaders });
    }
    const m3u8Url = decodeURIComponent(m3u8Param);

    console.log("rewrite-m3u8: fetching m3u8:", m3u8Url);

    // Validate absolute URL
    if (!m3u8Url.startsWith("http://") && !m3u8Url.startsWith("https://")) {
      console.error("rewrite-m3u8: m3u8 URL is not absolute:", m3u8Url);
      return new Response("m3u8 URL must be absolute", { status: 400, headers: corsHeaders });
    }

    const res = await fetch(m3u8Url);
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      console.error("rewrite-m3u8: failed to fetch playlist:", res.status, txt);
      return new Response(`Failed to fetch m3u8: ${res.status}`, { status: 502, headers: corsHeaders });
    }

    const text = await res.text();
    console.log("rewrite-m3u8: playlist fetched, length:", text.length);

    // Derive base URL for relative segments
    const base = m3u8Url.substring(0, m3u8Url.lastIndexOf("/") + 1);
    console.log("rewrite-m3u8: base URL for segments:", base);

    const lines = text.split("\n");
    let rewrittenCount = 0;

    const out = lines
      .map((line) => {
        const t = line.trim();

        // Keep empty lines and comments as-is
        if (!t || t.startsWith("#")) {
          return line;
        }

        // If already absolute, keep as-is
        if (t.startsWith("http://") || t.startsWith("https://")) {
          return line;
        }

        // Convert any relative path to absolute URL
        const absoluteUrl = base + t;
        rewrittenCount++;
        console.log(`rewrite-m3u8: rewriting "${t}" -> "${absoluteUrl}"`);
        return absoluteUrl;
      })
      .join("\n");

    console.log(`rewrite-m3u8: rewritten ${rewrittenCount} segment URLs to absolute`);
    console.log("rewrite-m3u8: returning rewritten playlist");

    return new Response(out, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/vnd.apple.mpegurl",
        "Cache-Control": "no-cache",
      },
    });
  } catch (err) {
    console.error("rewrite-m3u8: unexpected error:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
