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

  const [downloading, setDownloading] = useState<Set<string | number>>(new Set());

  if (!vodUrl || !vodData) {
    navigate("/");
    return null;
  }

  // ---------------------------------------------
  // SAFE TIME NORMALIZER (fixes the NaN issue)
  // ---------------------------------------------
  const normalizeSeconds = (value: number) => {
    if (!value || typeof value !== "number" || isNaN(value)) return 0;
    return Math.max(0, Math.floor(value));
  };

  const handleDownloadClip = async (clip: Clip) => {
    if (downloading.has(clip.id)) {
      toast.info("Clip already processing...");
      return;
    }

    setDownloading((prev) => new Set(prev).add(clip.id));
    toast.loading(`Processing clip ${clip.id}...`, { id: `clip-${clip.id}` });

    try {
      // ------------------------------------------------
      // 1) Use streamUrl already prepared in Progress.tsx
      // ------------------------------------------------
      let streamUrl = vodData.streamUrl;

      if (!streamUrl || !streamUrl.startsWith("http")) {
        throw new Error("Invalid or missing stream URL");
      }

      const start = normalizeSeconds(clip.startTime);
      const end = normalizeSeconds(clip.endTime);

      if (end <= start) {
        throw new Error("Invalid clip duration (end <= start)");
      }

      // ------------------------------------------------
      // 2) CALL process-clip (Railway backend)
      // ------------------------------------------------
      const { data, error } = await supabase.functions.invoke("process-clip", {
        body: {
          vodUrl: streamUrl,
          startTime: start,
          endTime: end,
        },
        responseType: "arraybuffer", // ← CRITICAL
      });

      if (error) {
        throw new Error(error.message || "process-clip failed");
      }

      if (!data) {
        throw new Error("Empty response from backend");
      }

      const buffer = data as ArrayBuffer;

      if (buffer.byteLength < 2000) {
        let text = "";
        try {
          text = new TextDecoder().decode(buffer);
        } catch {}
        throw new Error(`Backend returned non-video data: ${text}`);
      }

      // ------------------------------------------------
      // 3) VALIDATE MP4
      // ------------------------------------------------
      const header = new Uint8Array(buffer.slice(4, 8));
      const isMp4 = header[0] === 0x66 && header[1] === 0x74 && header[2] === 0x79 && header[3] === 0x70;

      if (!isMp4) {
        throw new Error("Returned file is not a valid MP4");
      }

      // ------------------------------------------------
      // 4) DOWNLOAD FILE
      // ------------------------------------------------
      const blob = new Blob([buffer], { type: "video/mp4" });
      const url = URL.createObjectURL(blob);

      const a = document.createElement("a");
      const safe = clip.title.replace(/[^a-z0-9_\-]/gi, "_").slice(0, 120);
      a.href = url;
      a.download = `clip-${clip.id}-${safe}.mp4`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      toast.success(`Clip ${clip.id} downloaded!`, { id: `clip-${clip.id}` });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Failed: ${msg}`, { id: `clip-${clip.id}` });
      console.error("Download error:", err);
    } finally {
      setDownloading((prev) => {
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
      await new Promise((r) => setTimeout(r, 600));
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4 flex justify-between">
          <Button variant="ghost" onClick={() => navigate("/")} className="gap-2">
            <ArrowLeft className="w-4 h-4" /> New Generation
          </Button>
          <Button onClick={handleDownloadAll} className="gap-2 bg-gradient-to-r from-primary to-secondary">
            <Download className="w-4 h-4" /> Download All
          </Button>
        </div>
      </header>

      <div className="container mx-auto px-4 py-12">
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-success/10 border border-success/20 mb-4">
            <TrendingUp className="w-4 h-4 text-success" />
            <span className="text-sm font-medium text-success">Generation Complete</span>
          </div>
          <h1 className="text-4xl md:text-5xl font-bold mb-3">{clips.length} Viral Clips Ready</h1>
          <p className="text-lg text-muted-foreground">{vodData.title}</p>
          <p className="text-sm text-muted-foreground">
            Duration: {vodData.duration} • {vodData.userName}
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-7xl mx-auto">
          {clips.map((clip, i) => (
            <div
              key={clip.id}
              className="bg-card border border-border rounded-xl overflow-hidden hover:border-primary/50 transition-all"
              style={{ animationDelay: `${i * 0.06}s` }}
            >
              <div className="relative aspect-[9/16] bg-muted">
                <div className="absolute top-3 right-3 px-2 py-1 bg-background/80 rounded-md flex gap-1">
                  <Clock className="w-3 h-3" />
                  <span className="text-xs">{clip.formattedTime}</span>
                </div>
                <div className="absolute top-3 left-3 px-2 py-1 bg-primary/20 border border-primary/30 rounded-md flex gap-1">
                  <Star className="w-3 h-3 text-primary" />
                  <span className="text-xs font-bold text-primary">{clip.viralScore ?? "—"}</span>
                </div>
              </div>

              <div className="p-4">
                <h3 className="font-semibold mb-1 line-clamp-1">{clip.title}</h3>
                <p className="text-xs text-muted-foreground mb-3">
                  {clip.formattedTime} • {clip.duration}s
                </p>

                <Button
                  onClick={() => handleDownloadClip(clip)}
                  className="w-full gap-2 bg-gradient-to-r from-primary to-secondary"
                  size="sm"
                  disabled={downloading.has(clip.id)}
                >
                  <Download className="w-4 h-4" />
                  {downloading.has(clip.id) ? "Processing..." : "Download Clip"}
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
