import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sparkles, Zap, Video } from "lucide-react";
import { toast } from "sonner";

const Home = () => {
  const [vodUrl, setVodUrl] = useState("");
  const navigate = useNavigate();

  const handleGenerate = () => {
    if (!vodUrl.trim()) {
      toast.error("Please enter a Twitch VOD URL");
      return;
    }

    if (!vodUrl.includes("twitch.tv")) {
      toast.error("Please enter a valid Twitch VOD URL");
      return;
    }

    // Navigate to progress page
    navigate("/progress", { state: { vodUrl } });
  };

  return (
    <div className="min-h-screen bg-background relative overflow-hidden">
      {/* Gradient background effects */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--gradient-hero),transparent_50%)] opacity-50" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_right,_hsl(189_94%_43%_/_0.1),transparent_50%)]" />
      
      <div className="relative z-10 container mx-auto px-4 py-20">
        {/* Header */}
        <header className="text-center mb-20 animate-fade-in">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-muted border border-primary/20 mb-6">
            <Sparkles className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium text-foreground">AI-Powered Clip Generation</span>
          </div>
          <h1 className="text-5xl md:text-7xl font-bold mb-6 bg-clip-text text-transparent bg-gradient-to-r from-primary via-secondary to-primary">
            Turn Your VODs Into
            <br />
            Viral Clips
          </h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Automatically detect the most hype moments from your Twitch streams and transform them into 
            TikTok, Reels, and Shorts-ready content.
          </p>
        </header>

        {/* Main CTA Section */}
        <div className="max-w-3xl mx-auto mb-20 animate-fade-in" style={{ animationDelay: "0.2s" }}>
          <div className="bg-card border border-border rounded-2xl p-8 shadow-2xl">
            <div className="flex flex-col gap-4">
              <Input
                type="text"
                placeholder="Paste your Twitch VOD link here..."
                value={vodUrl}
                onChange={(e) => setVodUrl(e.target.value)}
                className="h-14 text-lg bg-background border-border focus:border-primary"
                onKeyDown={(e) => e.key === "Enter" && handleGenerate()}
              />
              <Button 
                onClick={handleGenerate}
                size="lg"
                className="h-14 text-lg font-semibold bg-gradient-to-r from-primary to-secondary hover:opacity-90 transition-all animate-pulse-glow"
              >
                <Zap className="w-5 h-5 mr-2" />
                Generate Viral Clips
              </Button>
            </div>
          </div>
        </div>

        {/* Features */}
        <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto animate-fade-in" style={{ animationDelay: "0.4s" }}>
          <div className="bg-card border border-border rounded-xl p-6 hover:border-primary/50 transition-colors">
            <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
              <Sparkles className="w-6 h-6 text-primary" />
            </div>
            <h3 className="text-lg font-semibold mb-2 text-foreground">AI Detection</h3>
            <p className="text-muted-foreground">
              Automatically finds hype moments, killstreaks, and funny events using advanced AI
            </p>
          </div>

          <div className="bg-card border border-border rounded-xl p-6 hover:border-secondary/50 transition-colors">
            <div className="w-12 h-12 rounded-lg bg-secondary/10 flex items-center justify-center mb-4">
              <Video className="w-6 h-6 text-secondary" />
            </div>
            <h3 className="text-lg font-semibold mb-2 text-foreground">Auto-Format</h3>
            <p className="text-muted-foreground">
              Clips are perfectly formatted for TikTok, Reels, and Shorts with captions & effects
            </p>
          </div>

          <div className="bg-card border border-border rounded-xl p-6 hover:border-success/50 transition-colors">
            <div className="w-12 h-12 rounded-lg bg-success/10 flex items-center justify-center mb-4">
              <Zap className="w-6 h-6 text-success" />
            </div>
            <h3 className="text-lg font-semibold mb-2 text-foreground">One-Click Download</h3>
            <p className="text-muted-foreground">
              Download individual clips or export all at once as a ZIP file
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Home;
