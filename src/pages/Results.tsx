import React, { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Download, ArrowLeft, Star, Clock, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

type Clip = {
  id: number | string;
  title: string;
  startTime: number;
  endTime: number;
  formattedTime?: string;
  duration?: number;
  viralScore?: number | string;
};

const Results: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const vodUrl = (location.state as any)?.vodUrl;
  const vodData = (location.state as any)?.vodData;
  const clips: Clip[] = vodData?.clips ?? [];

  const [downloadingClips, setDownloadingClips] = useState<Set<string | number>>(new Set());

  if (!vodUrl || !vodData) {
    navigate("/");
    return null;
  }

  // ⭐ Fetch Edge Function URLs from the client
  const SUPABASE_URL =
    supabase?.functions?._url || supabase?.functions?._getEndpoint ? supabase.functions._getEndpoint("") : "";

  const PROCESS_CLIP_URL = `${SUPABASE_URL}/process-clip`;
  const GET_STREAM_URL = `${SUPABASE_URL}/get-vod-stream`;

  const handleDownloadClip = async (clip: Clip) => {
    if (downloadingClips.has(clip.id)) {
      toast.info("This clip is already processing");
      return;
    }

    setDownloadingClips((prev) => new Set(prev).add(clip.id));
    toast.loading(`Processing clip ${clip.id}...`, { id: `clip-${clip.id}` });

    try {
      let streamUrl: string | undefined = vodData.streamUrl;

      // ⭐ If missing, request fresh VOD stream URL
      if (!streamUrl) {
        const resp = await fetch(GET_STREAM_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ vodId: vodData.vodId }),
        });

        if (!resp.ok) throw new Error("Failed to fetch VOD stream URL");

        const json = await resp.json();
        if (!json.streamUrl) throw new Error("Edge Function returned no streamUrl");

        streamUrl = json.streamUrl;
        vodData.streamUrl = streamUrl; // cache for future clips
      }

      if (!streamUrl.startsWith("http")) {
        throw new Error("Invalid stream URL returned");
      }

      // ⭐ REAL BINARY REQUEST (IMPORTANT)
      const backendResp = await fetch(PROCESS_CLIP_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vodUrl: streamUrl,
          startTime: clip.startTime,
          endTime: clip.endTime,
        }),
      });

      if (!backendResp.ok) {
        const errorText = await backendResp.text();
        throw new Error(`Backend error: ${errorText}`);
      }

      const arrayBuffer = await backendResp.arrayBuffer();

      if (!arrayBuffer || arrayBuffer.byteLength === 0) {
        throw new Error("Empty MP4 returned");
      }

      // Validate MP4 header
      const header = new Uint8Array(arrayBuffer.slice(0, 12));
      const looksLikeMp4 = header[4] === 0x66 && header[5] === 0x74 && header[6] === 0x79 && header[7] === 0x70;

      if (!looksLikeMp4) {
        throw new Error("Returned data is not a valid MP4 file");
      }

      // ⭐ Save file
      const blob = new Blob([arrayBuffer], { type: "video/mp4" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");

      const safeTitle = (clip.title || "clip").replace(/[^a-z0-9_\-]/gi, "_");

      a.href = url;
      a.download = `clip-${clip.id}-${safeTitle}.mp4`;
      document.body.appendChild(a);
      a.click();
      a.remove();

      URL.revokeObjectURL(url);

      toast.success(`Clip ${clip.id} downloaded`, { id: `clip-${clip.id}` });
    } catch (err) {
      console.error("Clip download error:", err);
      toast.error(`Failed: ${err instanceof Error ? err.message : "Unknown error"}`, { id: `clip-${clip.id}` });
    } finally {
      setDownloadingClips((prev) => {
        const next = new Set(prev);
        next.delete(clip.id);
        return next;
      });
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between gap-4">
            <Button variant="ghost" onClick={() => navigate("/")} className="gap-2">
              <ArrowLeft className="w-4 h-4" />
              New Generation
            </Button>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-10">
        <div className="text-center mb-10">
          <TrendingUp className="w-6 h-6 mx-auto text-success mb-3" />
          <h1 className="text-4xl font-bold">{clips.length} Viral Clips Ready</h1>
          <p className="text-lg text-muted-foreground">{vodData.title}</p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-7xl mx-auto">
          {clips.map((clip, i) => (
            <div key={clip.id} className="bg-card border border-border rounded-xl overflow-hidden group">
              <div className="relative aspect-[9/16] bg-muted">
                <Clock className="absolute top-3 right-3 w-4 h-4 text-white" />
                <span className="absolute top-3 right-10 text-xs text-white bg-black/50 px-2 py-1 rounded">
                  {clip.formattedTime}
                </span>
              </div>

              <div className="p-4">
                <h3 className="font-semibold mb-1">{clip.title}</h3>
                <Button
                  onClick={() => handleDownloadClip(clip)}
                  className="w-full gap-2"
                  disabled={downloadingClips.has(clip.id)}
                >
                  <Download className="w-4 h-4" />
                  {downloadingClips.has(clip.id) ? "Processing..." : "Download Clip"}
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default Results;
