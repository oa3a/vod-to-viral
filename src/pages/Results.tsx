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

  // 💥 If user refreshes, send them back
  if (!vodUrl || !vodData) {
    navigate("/");
    return null;
  }

  // --------------------------
  // ⭐ CALL EDGE FUNCTION AS RAW FETCH (SUPABASE SDK CANNOT RETURN BINARY)
  // --------------------------
  const callEdgeFunctionBinary = async (functionName: string, body: Record<string, any>): Promise<ArrayBuffer> => {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;

    if (!supabaseUrl) {
      throw new Error("Missing VITE_SUPABASE_URL in .env");
    }

    const url = `${supabaseUrl}/functions/v1/${functionName}`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Edge Function returned ${response.status}: ${text}`);
    }

    return await response.arrayBuffer(); // <— MP4 comes here
  };

  // --------------------------
  // ⭐ DOWNLOAD CLIP
  // --------------------------
  const handleDownloadClip = async (clip: Clip) => {
    if (downloadingClips.has(clip.id)) {
      toast.info("Already processing this clip");
      return;
    }

    setDownloadingClips((prev) => new Set(prev).add(clip.id));
    toast.loading(`Processing clip ${clip.id}...`, { id: `clip-${clip.id}` });

    try {
      // 1) Ensure we have a working Stream URL
      let streamUrl: string | undefined = vodData.streamUrl;

      if (!streamUrl || !streamUrl.startsWith("http")) {
        const { data: streamData, error } = await supabase.functions.invoke("get-vod-stream", {
          body: { vodId: vodData.vodId },
        });

        if (error || !streamData?.streamUrl) {
          throw new Error("Failed to resolve Twitch VOD stream URL");
        }

        streamUrl = streamData.streamUrl;
        vodData.streamUrl = streamUrl; // cache it
      }

      // 2) CALL process-clip EDGE FUNCTION USING RAW FETCH
      const mp4File: ArrayBuffer = await callEdgeFunctionBinary("process-clip", {
        vodUrl: streamUrl,
        startTime: clip.startTime,
        endTime: clip.endTime,
      });

      if (!mp4File || mp4File.byteLength === 0) {
        throw new Error("FFmpeg returned empty video");
      }

      // 3) Validate MP4 header
      const header = new Uint8Array(mp4File.slice(0, 12));
      const isMP4 =
        (header[4] === 0x66 && header[5] === 0x74 && header[6] === 0x79 && header[7] === 0x70) ||
        (header[8] === 0x66 && header[9] === 0x74 && header[10] === 0x79 && header[11] === 0x70);

      if (!isMP4) throw new Error("Invalid MP4 header returned");

      // 4) Download file
      const blob = new Blob([mp4File], { type: "video/mp4" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");

      const safeTitle = clip.title.replace(/[^a-z0-9_\-]/gi, "_").slice(0, 80);
      a.href = url;
      a.download = `clip-${clip.id}-${safeTitle}.mp4`;

      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      toast.success(`Clip ${clip.id} downloaded`, { id: `clip-${clip.id}` });
    } catch (err: any) {
      toast.error(`Failed to download clip: ${err.message}`, { id: `clip-${clip.id}` });
      console.error("Clip error:", err);
    } finally {
      setDownloadingClips((prev) => {
        const next = new Set(prev);
        next.delete(clip.id);
        return next;
      });
    }
  };

  // --------------------------
  // ⭐ DOWNLOAD ALL
  // --------------------------
  const handleDownloadAll = async () => {
    toast.info("Generating all clips...");
    for (const clip of clips) {
      await handleDownloadClip(clip);
      await new Promise((res) => setTimeout(res, 500));
    }
  };

  // --------------------------
  // ⭐ UI
  // --------------------------
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/50 sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Button variant="ghost" onClick={() => navigate("/")} className="gap-2">
            <ArrowLeft className="w-4 h-4" /> New Generation
          </Button>
          <Button onClick={handleDownloadAll} className="gap-2">
            <Download className="w-4 h-4" /> Download All
          </Button>
        </div>
      </header>

      <div className="container mx-auto px-4 py-12">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold">{clips.length} Viral Clips Ready</h1>
          <p className="text-lg text-muted-foreground">{vodData.title}</p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {clips.map((clip) => (
            <div key={clip.id} className="bg-card p-4 border rounded-xl">
              <h3 className="font-semibold mb-1">{clip.title}</h3>
              <p className="text-xs mb-2">
                {clip.formattedTime} • {clip.duration}s
              </p>

              <Button
                onClick={() => handleDownloadClip(clip)}
                disabled={downloadingClips.has(clip.id)}
                className="w-full gap-2"
              >
                <Download className="w-4 h-4" />
                {downloadingClips.has(clip.id) ? "Processing..." : "Download Clip"}
              </Button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default Results;
