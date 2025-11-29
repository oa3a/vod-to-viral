import React, { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Download, ArrowLeft, Star, Clock, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

type Clip = {
  id: number | string;
  title: string;
  startTime: number; // seconds
  endTime: number; // seconds
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
    // If user refreshed invalid state, go home
    navigate("/");
    return null;
  }

  const handleDownloadClip = async (clip: Clip) => {
    if (downloadingClips.has(clip.id)) {
      toast.info("This clip is already being processed");
      return;
    }

    // Mark as downloading
    setDownloadingClips((prev) => {
      const next = new Set(prev);
      next.add(clip.id);
      return next;
    });

    // Show loading toast
    toast.loading(`Processing clip ${clip.id}...`, { id: `clip-${clip.id}` });

    try {
      // 1) Ensure we have the final absolute Twitch playlist URL
      let streamUrl: string | undefined = (vodData as any)?.streamUrl;

      if (!streamUrl || !streamUrl.startsWith("http")) {
        const { data: streamData, error: streamError } = await supabase.functions.invoke("get-vod-stream", {
          body: { vodId: (vodData as any)?.vodId },
        });

        if (streamError) {
          throw new Error((streamError as any).message ?? "Failed to resolve Twitch VOD stream URL");
        }

        if (!streamData?.streamUrl || typeof (streamData as any).streamUrl !== "string") {
          throw new Error("Backend did not return a valid stream URL");
        }

        streamUrl = (streamData as any).streamUrl as string;
        (vodData as any).streamUrl = streamUrl; // cache for subsequent clips
      }

      if (!streamUrl.startsWith("http://") && !streamUrl.startsWith("https://")) {
        throw new Error("Resolved VOD URL is not a valid absolute URL");
      }

      // 2) Call process-clip edge function (which forwards to Railway) and expect binary
      const functionsClient: any = supabase.functions as any;
      const { data, error } = await functionsClient.invoke("process-clip", {
        body: {
          vodUrl: streamUrl,
          startTime: clip.startTime,
          endTime: clip.endTime,
        },
        responseType: "arraybuffer",
      });

      if (error) {
        throw new Error((error as any).message || "Clip processing backend error");
      }

      if (!data) {
        throw new Error("Received empty response from clip backend");
      }

      const arr = data as ArrayBuffer;

      // Validate bytes > 0
      if (!arr || arr.byteLength === 0) {
        throw new Error("Received empty file from clip backend");
      }

      // Simple MP4 header check (ftyp)
      const header = new Uint8Array(arr.slice(0, 12));
      const looksLikeMp4 =
        (header[4] === 0x66 && header[5] === 0x74 && header[6] === 0x79 && header[7] === 0x70) ||
        (header[8] === 0x66 && header[9] === 0x74 && header[10] === 0x79 && header[11] === 0x70);

      if (!looksLikeMp4) {
        let text = "";
        try {
          text = new TextDecoder().decode(arr);
        } catch (e) {
          text = "";
        }
        throw new Error(text || "Downloaded file is not a valid MP4");
      }

      // Create blob and trigger download
      const mp4Blob = new Blob([arr], { type: "video/mp4" });
      const url = URL.createObjectURL(mp4Blob);
      const a = document.createElement("a");
      a.href = url;
      const safeTitle = (clip.title || "clip").replace(/[^a-z0-9_\-]/gi, "_").slice(0, 120);
      a.download = `clip-${clip.id}-${safeTitle}.mp4`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      toast.success(`Clip ${clip.id} downloaded`, { id: `clip-${clip.id}` });
    } catch (err) {
      console.error("Download error:", err);
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`Failed to download clip: ${message}`, { id: `clip-${clip.id}` });
    } finally {
      // Remove from downloading set
      setDownloadingClips((prev) => {
        const next = new Set(prev);
        next.delete(clip.id);
        return next;
      });
    }
  };

  const handleDownloadAll = async () => {
    toast.info(`Processing ${clips.length} clips...`);
    for (const clip of clips) {
      await handleDownloadClip(clip);
      await new Promise((r) => setTimeout(r, 800));
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between gap-4">
            <Button variant="ghost" onClick={() => navigate("/")} className="gap-2">
              <ArrowLeft className="w-4 h-4" />
              New Generation
            </Button>
            <Button
              onClick={handleDownloadAll}
              className="gap-2 bg-gradient-to-r from-primary to-secondary hover:opacity-90"
            >
              <Download className="w-4 h-4" />
              Download All
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="container mx-auto px-4 py-12">
        {/* Success Message */}
        <div className="text-center mb-12 animate-fade-in">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-success/10 border border-success/20 mb-4">
            <TrendingUp className="w-4 h-4 text-success" />
            <span className="text-sm font-medium text-success">Generation Complete</span>
          </div>
          <h1 className="text-4xl md:text-5xl font-bold mb-3 text-foreground">{clips.length} Viral Clips Ready</h1>
          <p className="text-lg text-muted-foreground mb-2">{vodData.title}</p>
          <p className="text-sm text-muted-foreground">
            Duration: {vodData.duration} • {vodData.userName}
          </p>
        </div>

        {/* Clips Grid */}
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-7xl mx-auto">
          {clips.map((clip, index) => (
            <div
              key={clip.id}
              className="bg-card border border-border rounded-xl overflow-hidden hover:border-primary/50 transition-all group animate-fade-in"
              style={{ animationDelay: `${index * 0.06}s` }}
            >
              <div className="relative aspect-[9/16] overflow-hidden bg-muted">
                {/* Thumbnail fallback */}
                <div className="w-full h-full bg-gradient-to-b from-background to-muted" />
                <div className="absolute top-3 right-3 px-2 py-1 rounded-md bg-background/80 backdrop-blur-sm flex items-center gap-1">
                  <Clock className="w-3 h-3 text-foreground" />
                  <span className="text-xs font-medium text-foreground">{clip.formattedTime}</span>
                </div>
                <div className="absolute top-3 left-3 px-2 py-1 rounded-md bg-primary/20 backdrop-blur-sm border border-primary/30 flex items-center gap-1">
                  <Star className="w-3 h-3 text-primary fill-primary" />
                  <span className="text-xs font-bold text-primary">{clip.viralScore ?? "—"}</span>
                </div>
                <div className="absolute bottom-3 left-3 px-2 py-1 rounded-md bg-background/90 backdrop-blur-sm">
                  <span className="text-xs font-bold text-foreground">{clip.duration}s</span>
                </div>
              </div>

              <div className="p-4">
                <h3 className="font-semibold text-foreground mb-1 line-clamp-1">{clip.title}</h3>
                <p className="text-xs text-muted-foreground mb-3">
                  {clip.formattedTime} • {clip.duration} seconds
                </p>

                <Button
                  onClick={() => handleDownloadClip(clip)}
                  className="w-full gap-2 bg-gradient-to-r from-primary to-secondary hover:opacity-90"
                  size="sm"
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
