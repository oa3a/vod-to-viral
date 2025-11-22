import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Download, ArrowLeft, Star, Clock, TrendingUp } from "lucide-react";
import { toast } from "sonner";

const Results = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const vodUrl = location.state?.vodUrl;

  // Mock data for generated clips
  const clips = [
    {
      id: 1,
      title: "Epic Pentakill Moment",
      duration: "0:18",
      viralScore: 95,
      thumbnail: "https://images.unsplash.com/photo-1542751371-adc38448a05e?w=400&h=700&fit=crop",
    },
    {
      id: 2,
      title: "Insane 1v4 Clutch",
      duration: "0:24",
      viralScore: 92,
      thumbnail: "https://images.unsplash.com/photo-1552820728-8b83bb6b773f?w=400&h=700&fit=crop",
    },
    {
      id: 3,
      title: "Perfect Timing Jump Scare",
      duration: "0:12",
      viralScore: 88,
      thumbnail: "https://images.unsplash.com/photo-1538481199705-c710c4e965fc?w=400&h=700&fit=crop",
    },
    {
      id: 4,
      title: "Chat Goes Wild",
      duration: "0:15",
      viralScore: 85,
      thumbnail: "https://images.unsplash.com/photo-1511512578047-dfb367046420?w=400&h=700&fit=crop",
    },
    {
      id: 5,
      title: "Unexpected Victory",
      duration: "0:21",
      viralScore: 82,
      thumbnail: "https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=400&h=700&fit=crop",
    },
    {
      id: 6,
      title: "Funny Rage Moment",
      duration: "0:16",
      viralScore: 79,
      thumbnail: "https://images.unsplash.com/photo-1556438758-8d49568ce18e?w=400&h=700&fit=crop",
    },
  ];

  const [downloadUrls, setDownloadUrls] = useState<Record<number, string>>({});

  useEffect(() => {
    let createdUrls: string[] = [];

    const prepareDownloadUrls = async () => {
      try {
        // In a real app, each clip would have its own video source (base64/ArrayBuffer).
        // For the MVP, we use a local demo mp4 file and create Blob URLs from it.
        const response = await fetch("/videos/demo-clip.mp4");
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        createdUrls.push(url);

        const urlsMap: Record<number, string> = {};
        for (const clip of clips) {
          urlsMap[clip.id] = url;
        }

        setDownloadUrls(urlsMap);
      } catch (error) {
        console.error("Failed to prepare clip download URLs", error);
        toast.error("Failed to prepare clip downloads. Please refresh and try again.");
      }
    };

    prepareDownloadUrls();

    return () => {
      createdUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  const downloadClip = (clipId: number, title: string) => {
    const url = downloadUrls[clipId];

    if (!url) {
      toast.error("Clip is still preparing. Please try again in a moment.");
      return;
    }

    const safeTitle = title.replace(/[^a-z0-9]+/gi, "_").toLowerCase();
    const a = document.createElement("a");
    a.href = url;
    a.download = `${safeTitle}_clip_${clipId}.mp4`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    toast.success(`Downloading: ${title}`);
  };

  const handleDownloadAll = () => {
    if (Object.keys(downloadUrls).length === 0) {
      toast.error("Clips are still preparing. Please try again in a moment.");
      return;
    }

    toast.success("Starting downloads for all clips...");

    clips.forEach((clip, index) => {
      setTimeout(() => {
        downloadClip(clip.id, clip.title);
      }, index * 500);
    });
  };

  if (!vodUrl) {
    navigate("/");
    return null;
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <Button
              variant="ghost"
              onClick={() => navigate("/")}
              className="gap-2"
            >
              <ArrowLeft className="w-4 h-4" />
              New Generation
            </Button>
            <Button
              onClick={handleDownloadAll}
              className="gap-2 bg-gradient-to-r from-primary to-secondary hover:opacity-90"
            >
              <Download className="w-4 h-4" />
              Download All as ZIP
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
          <h1 className="text-4xl md:text-5xl font-bold mb-3 text-foreground">
            {clips.length} Viral Clips Ready
          </h1>
          <p className="text-lg text-muted-foreground">
            AI-powered detection found the best moments from your VOD
          </p>
        </div>

        {/* Clips Grid */}
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-7xl mx-auto">
          {clips.map((clip, index) => (
            <div
              key={clip.id}
              className="bg-card border border-border rounded-xl overflow-hidden hover:border-primary/50 transition-all group animate-fade-in"
              style={{ animationDelay: `${index * 0.1}s` }}
            >
              {/* Thumbnail */}
              <div className="relative aspect-[9/16] overflow-hidden bg-muted">
                <img
                  src={clip.thumbnail}
                  alt={clip.title}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-background/90 via-background/20 to-transparent" />
                
                {/* Duration Badge */}
                <div className="absolute top-3 right-3 px-2 py-1 rounded-md bg-background/80 backdrop-blur-sm flex items-center gap-1">
                  <Clock className="w-3 h-3 text-foreground" />
                  <span className="text-xs font-medium text-foreground">{clip.duration}</span>
                </div>

                {/* Viral Score Badge */}
                <div className="absolute top-3 left-3 px-2 py-1 rounded-md bg-primary/20 backdrop-blur-sm border border-primary/30 flex items-center gap-1">
                  <Star className="w-3 h-3 text-primary fill-primary" />
                  <span className="text-xs font-bold text-primary">{clip.viralScore}</span>
                </div>
              </div>

              {/* Content */}
              <div className="p-4">
                <h3 className="font-semibold text-foreground mb-3 line-clamp-1">
                  {clip.title}
                </h3>
                <Button
                  asChild
                  className="w-full gap-2 bg-gradient-to-r from-primary to-secondary hover:opacity-90"
                  size="sm"
                >
                  <a
                    href={downloadUrls[clip.id]}
                    download={`${clip.title.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}_clip_${clip.id}.mp4`}
                    onClick={(e) => {
                      e.preventDefault();
                      downloadClip(clip.id, clip.title);
                    }}
                    className="flex items-center justify-center gap-2 w-full"
                  >
                    <Download className="w-4 h-4" />
                    <span>Download Clip</span>
                  </a>
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
