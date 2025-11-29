import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Download, ArrowLeft, Star, Clock, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

const Results = () => {
  const location = useLocation();
  const navigate = useNavigate();

  const vodUrl = location.state?.vodUrl;
  const vodData = location.state?.vodData;

  const clips = vodData?.clips || [];
  const [downloadingClips, setDownloadingClips] = useState<Set<number>>(new Set());

  const handleDownloadClip = async (clip: any) => {
    // Prevent double download
    if (downloadingClips.has(clip.id)) {
      toast.info("Clip already processing...");
      return;
    }

    setDownloadingClips((prev) => new Set(prev).add(clip.id));

    try {
      toast.loading(`Processing clip ${clip.id}...`, {
        id: `clip-${clip.id}`,
      });

      // ----------------------------------------
      // 1) Get an ABSOLUTE Twitch Stream URL
      // ----------------------------------------

      let absoluteVodUrl: string;

      if (vodData.vodId === "test" || !vodData.vodId) {
        const currentUrl = new URL(window.location.href);
        absoluteVodUrl = new URL("/assets/sample_vod.mp4", currentUrl.origin).toString();
      } else {
        const { data: streamData, error: streamError } = await supabase.functions.invoke("get-vod-stream", {
          body: { vodId: vodData.vodId },
        });

        if (streamError || !streamData?.streamUrl) {
          throw new Error("Failed to get Twitch stream URL");
        }

        absoluteVodUrl = streamData.streamUrl;
      }

      if (!absoluteVodUrl.startsWith("http")) {
        throw new Error("Invalid absolute VOD URL");
      }

      // ----------------------------------------
      // 2) Request MP4 Clip from Supabase → Railway
      // ----------------------------------------

      const { data, error } = await supabase.functions.invoke("process-clip", {
        body: {
          vodUrl: absoluteVodUrl,
          startTime: clip.startTime,
          endTime: clip.endTime,
        },
      });

      if (error) {
        throw new Error(error.message || "Edge Function failed");
      }

      if (!data) {
        throw new Error("No MP4 data returned");
      }

      // Convert to Blob
      const mp4Blob = data instanceof Blob ? data : new Blob([data], { type: "video/mp4" });

      if (mp4Blob.size < 100) {
        console.log("Invalid blob:", mp4Blob);
        throw new Error("Server returned invalid video data");
      }

      // ----------------------------------------
      // 3) Trigger Browser Download
      // ----------------------------------------

      const url = URL.createObjectURL(mp4Blob);
      const a = document.createElement("a");

      a.href = url;
      a.download = `clip-${clip.id}-${clip.title.replace(/[^a-z0-9]/gi, "_")}.mp4`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      URL.revokeObjectURL(url);

      toast.success(`Clip ${clip.id} downloaded!`, {
        id: `clip-${clip.id}`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown download error";
      toast.error(`Failed: ${message}`, {
        id: `clip-${clip.id}`,
      });
      console.error("Clip download error:", err);
    } finally {
      setDownloadingClips((prev) => {
        const next = new Set(prev);
        next.delete(clip.id);
        return next;
      });
    }
  };

  const handleDownloadAll = async () => {
    toast.info("Processing all clips...");
    for (const clip of clips) {
      await handleDownloadClip(clip);
      await new Promise((r) => setTimeout(r, 800));
    }
  };

  if (!vodUrl || !vodData) {
    navigate("/");
    return null;
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between gap-4">
            <Button variant="ghost" onClick={() => navigate("/")} className="gap-2">
              <ArrowLeft className="w-4 h-4" /> New Generation
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

      {/* RESULTS */}
      <div className="container mx-auto px-4 py-12">
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-success/10 border border-success/20 mb-4">
            <TrendingUp className="w-4 h-4 text-success" />
            <span className="text-sm font-medium text-success">Generation Complete</span>
          </div>

          <h1 className="text-4xl md:text-5xl font-bold mb-3">Your Viral Clips Are Ready</h1>
          <p className="text-lg text-muted-foreground mb-2">{vodData.title}</p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-7xl mx-auto">
          {clips.map((clip, index) => (
            <div
              key={clip.id}
              className="bg-card border border-border rounded-xl overflow-hidden hover:border-primary/50"
            >
              <div className="relative aspect-[9/16] bg-muted overflow-hidden">
                <img
                  src={vodData.thumbnail.replace("%{width}", "400").replace("%{height}", "700")}
                  className="w-full h-full object-cover"
                />
                <div className="absolute bottom-3 left-3 px-2 py-1 bg-black/50 text-white text-xs rounded">
                  {clip.duration}s
                </div>
              </div>

              <div className="p-4">
                <h3 className="font-semibold mb-2">{clip.title}</h3>
                <Button
                  className="w-full bg-gradient-to-r from-primary to-secondary"
                  disabled={downloadingClips.has(clip.id)}
                  onClick={() => handleDownloadClip(clip)}
                >
                  <Download className="w-4 h-4 mr-2" />
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
