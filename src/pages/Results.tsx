import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Download, ArrowLeft, Star, Clock, TrendingUp } from "lucide-react";
import { toast } from "sonner";

const Results = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const vodUrl = location.state?.vodUrl;
  const vodData = location.state?.vodData;

  const clips = vodData?.clips || [];
  const [downloadingClips, setDownloadingClips] = useState<Set<number>>(new Set());

  // -------------------------------
  // DIRECT fetch() to Supabase Edge Function
  // -------------------------------
  const callProcessClip = async (vodUrl: string, start: number, end: number) => {
    const edgeUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/process-clip`;

    const res = await fetch(edgeUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({ vodUrl, startTime: start, endTime: end }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Edge function failed: ${text}`);
    }

    const arrayBuffer = await res.arrayBuffer();
    return new Blob([arrayBuffer], { type: "video/mp4" });
  };

  // -------------------------------
  // DOWNLOAD A SINGLE CLIP
  // -------------------------------
  const handleDownloadClip = async (clip: any) => {
    if (downloadingClips.has(clip.id)) {
      toast.info("Already processing this clip");
      return;
    }

    setDownloadingClips(new Set(downloadingClips).add(clip.id));
    toast.loading(`Processing clip ${clip.id}...`, { id: `clip-${clip.id}` });

    try {
      const absoluteVodUrl = vodData.streamUrl || vodData.directUrl || vodUrl;

      const mp4Blob = await callProcessClip(absoluteVodUrl, clip.startTime, clip.endTime);

      if (mp4Blob.size === 0) {
        throw new Error("Received empty video file");
      }

      // Download file
      const url = URL.createObjectURL(mp4Blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `clip-${clip.id}.mp4`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast.success(`Clip ${clip.id} downloaded!`, { id: `clip-${clip.id}` });
    } catch (e: any) {
      toast.error(`Failed: ${e.message}`, { id: `clip-${clip.id}` });
      console.error("Clip download failed:", e);
    } finally {
      setDownloadingClips((prev) => {
        const next = new Set(prev);
        next.delete(clip.id);
        return next;
      });
    }
  };

  const handleDownloadAll = async () => {
    toast.info("Downloading all clips...");
    for (const clip of clips) {
      await handleDownloadClip(clip);
      await new Promise((r) => setTimeout(r, 500));
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
              <ArrowLeft className="w-4 h-4" />
              New Generation
            </Button>
            <Button onClick={handleDownloadAll} className="gap-2 bg-gradient-to-r from-primary to-secondary">
              <Download className="w-4 h-4" />
              Download All
            </Button>
          </div>
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
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-7xl mx-auto">
          {clips.map((clip, index) => (
            <div key={clip.id} className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="relative aspect-[9/16] bg-muted">
                <img src={vodData.thumbnail} className="object-cover w-full h-full" />
                <div className="absolute top-3 left-3 bg-primary/20 px-2 py-1 rounded-md flex items-center gap-1">
                  <Star className="w-3 h-3 text-primary" />
                  <span className="text-xs font-bold text-primary">{clip.viralScore}</span>
                </div>
                <div className="absolute top-3 right-3 px-2 py-1 rounded-md bg-background/80 backdrop-blur-sm">
                  <Clock className="w-3 h-3" />
                  <span className="text-xs font-medium">{clip.formattedTime}</span>
                </div>
              </div>

              <div className="p-4">
                <h3 className="font-semibold mb-1">{clip.title}</h3>
                <p className="text-xs text-muted-foreground mb-3">{clip.duration}s</p>

                <Button
                  onClick={() => handleDownloadClip(clip)}
                  disabled={downloadingClips.has(clip.id)}
                  className="w-full gap-2 bg-gradient-to-r from-primary to-secondary"
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
