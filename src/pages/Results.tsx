import React, { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Download, ArrowLeft } from "lucide-react";
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

  // If user refreshes, send them back
  if (!vodUrl || !vodData) {
    navigate("/");
    return null;
  }

  // Call process-clip edge function using Supabase SDK
  const callProcessClip = async (vodUrl: string, startTime: number, endTime: number): Promise<ArrayBuffer> => {
    // Validate inputs
    if (!vodUrl || !vodUrl.startsWith("http")) {
      throw new Error(`Invalid vodUrl: ${vodUrl}`);
    }

    if (!vodUrl.endsWith(".m3u8")) {
      throw new Error(`vodUrl must end with .m3u8, received: ${vodUrl}`);
    }

    if (typeof startTime !== "number" || typeof endTime !== "number") {
      throw new Error(`Invalid times: startTime=${startTime}, endTime=${endTime}`);
    }

    if (endTime <= startTime) {
      throw new Error(`Invalid time range: startTime=${startTime}, endTime=${endTime}`);
    }

    console.log("Results: calling process-clip with payload:", { vodUrl, startTime, endTime });

    const { data, error } = await supabase.functions.invoke("process-clip", {
      body: { vodUrl, startTime, endTime },
    });

    console.log("Results: process-clip response received");

    if (error) {
      console.error("Results: process-clip error:", error);
      throw new Error(`Edge function failed: ${error.message}`);
    }

    if (!data) {
      throw new Error("No data received from process-clip");
    }

    // Supabase SDK returns binary data as Blob, convert to ArrayBuffer
    let arrayBuffer: ArrayBuffer;
    if (data instanceof Blob) {
      arrayBuffer = await data.arrayBuffer();
    } else if (data instanceof ArrayBuffer) {
      arrayBuffer = data;
    } else {
      throw new Error(`Unexpected response type: ${typeof data}`);
    }

    console.log("Results: received MP4 arrayBuffer, size:", arrayBuffer.byteLength);
    return arrayBuffer;
  };

  // Download individual clip
  const handleDownloadClip = async (clip: Clip) => {
    if (downloadingClips.has(clip.id)) {
      toast.info("Already processing this clip");
      return;
    }

    setDownloadingClips((prev) => new Set(prev).add(clip.id));
    toast.loading(`Processing clip ${clip.id}...`, { id: `clip-${clip.id}` });

    try {
      // 1) Ensure we have a working stream URL (absolute, ends with .m3u8)
      let streamUrl: string | undefined = vodData.streamUrl;

      if (!streamUrl || !streamUrl.startsWith("http") || !streamUrl.endsWith(".m3u8")) {
        console.log("Results: stream URL not cached or invalid, calling get-vod-stream...");
        const { data: streamData, error } = await supabase.functions.invoke("get-vod-stream", {
          body: { vodId: vodData.vodId },
        });

        if (error || !streamData?.streamUrl) {
          console.error("Results: get-vod-stream error:", error);
          throw new Error("Failed to resolve Twitch VOD stream URL");
        }

        streamUrl = streamData.streamUrl;
        
        // Validate the resolved URL
        if (!streamUrl.startsWith("http") || !streamUrl.endsWith(".m3u8")) {
          throw new Error(`Invalid stream URL format: ${streamUrl}`);
        }
        
        vodData.streamUrl = streamUrl; // cache it
        console.log("Results: resolved and validated stream URL:", streamUrl);
      }

      // 2) Call process-clip to get MP4
      console.log("Results: calling process-clip with streamUrl:", streamUrl);
      const mp4Buffer = await callProcessClip(streamUrl, clip.startTime, clip.endTime);

      if (!mp4Buffer || mp4Buffer.byteLength === 0) {
        throw new Error("Received empty video file");
      }

      console.log("Results: validating MP4 header...");
      // 3) Validate MP4 header (ftyp box)
      const header = new Uint8Array(mp4Buffer.slice(0, 12));
      const isFtyp =
        (header[4] === 0x66 && header[5] === 0x74 && header[6] === 0x79 && header[7] === 0x70) ||
        (header[8] === 0x66 && header[9] === 0x74 && header[10] === 0x79 && header[11] === 0x70);

      if (!isFtyp) {
        const headerHex = Array.from(header)
          .map((b) => b.toString(16).padStart(2, "0"))
          .join(" ");
        console.warn("Results: invalid MP4 header:", headerHex);
        throw new Error("Invalid MP4 file received");
      }

      console.log("Results: valid MP4 header detected, creating download...");

      // 4) Download file
      const blob = new Blob([mp4Buffer], { type: "video/mp4" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");

      const safeTitle = clip.title.replace(/[^a-z0-9_\-]/gi, "_").slice(0, 80);
      a.href = url;
      a.download = `clip-${clip.id}-${safeTitle}.mp4`;

      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      toast.success(`Clip ${clip.id} downloaded successfully`, { id: `clip-${clip.id}` });
    } catch (err: any) {
      console.error("Results: clip download error:", err);
      toast.error(`Failed to download clip: ${err.message}`, { id: `clip-${clip.id}` });
    } finally {
      setDownloadingClips((prev) => {
        const next = new Set(prev);
        next.delete(clip.id);
        return next;
      });
    }
  };

  // Download all clips sequentially
  const handleDownloadAll = async () => {
    toast.info("Generating all clips...");
    for (const clip of clips) {
      await handleDownloadClip(clip);
      await new Promise((res) => setTimeout(res, 1000));
    }
    toast.success("All clips processed");
  };

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
          <h1 className="text-4xl font-bold mb-2">{clips.length} Viral Clips Ready</h1>
          <p className="text-lg text-muted-foreground">{vodData.title}</p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {clips.map((clip) => (
            <div key={clip.id} className="bg-card p-6 border rounded-xl hover:border-primary/50 transition-colors">
              <h3 className="font-semibold text-lg mb-2">{clip.title}</h3>
              <p className="text-sm text-muted-foreground mb-4">
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
