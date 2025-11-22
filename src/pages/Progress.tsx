import { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Loader2, CheckCircle2 } from "lucide-react";

const Progress = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const vodUrl = location.state?.vodUrl;

  const [currentStep, setCurrentStep] = useState(0);

  const steps = [
    { label: "Downloading VOD", duration: 2000 },
    { label: "Analyzing audio patterns", duration: 3000 },
    { label: "Detecting hype moments", duration: 2500 },
    { label: "Processing facial expressions", duration: 2000 },
    { label: "Generating clips", duration: 3000 },
    { label: "Adding effects & captions", duration: 2500 },
  ];

  useEffect(() => {
    if (!vodUrl) {
      navigate("/");
      return;
    }

    let timeout: NodeJS.Timeout;

    if (currentStep < steps.length) {
      timeout = setTimeout(() => {
        setCurrentStep((prev) => prev + 1);
      }, steps[currentStep].duration);
    } else {
      // All steps complete, navigate to results
      timeout = setTimeout(() => {
        navigate("/results", { state: { vodUrl } });
      }, 1000);
    }

    return () => clearTimeout(timeout);
  }, [currentStep, vodUrl, navigate]);

  return (
    <div className="min-h-screen bg-background relative overflow-hidden flex items-center justify-center">
      {/* Gradient background effects */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--gradient-hero),transparent_50%)] opacity-50" />
      
      <div className="relative z-10 max-w-2xl w-full mx-auto px-4">
        <div className="bg-card border border-border rounded-2xl p-12 shadow-2xl">
          {/* Header */}
          <div className="text-center mb-12">
            <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-6 animate-pulse-glow">
              <Loader2 className="w-10 h-10 text-primary animate-spin" />
            </div>
            <h2 className="text-3xl font-bold mb-3 text-foreground">
              Creating Your Viral Clips
            </h2>
            <p className="text-muted-foreground">
              This may take a few minutes depending on VOD length
            </p>
          </div>

          {/* Progress Steps */}
          <div className="space-y-4">
            {steps.map((step, index) => {
              const isComplete = index < currentStep;
              const isActive = index === currentStep;

              return (
                <div
                  key={step.label}
                  className={`flex items-center gap-4 p-4 rounded-lg transition-all ${
                    isActive
                      ? "bg-primary/10 border border-primary/30"
                      : isComplete
                      ? "bg-success/5 border border-success/20"
                      : "bg-muted/5 border border-border/50"
                  }`}
                >
                  <div className="flex-shrink-0">
                    {isComplete ? (
                      <CheckCircle2 className="w-6 h-6 text-success" />
                    ) : isActive ? (
                      <Loader2 className="w-6 h-6 text-primary animate-spin" />
                    ) : (
                      <div className="w-6 h-6 rounded-full border-2 border-border" />
                    )}
                  </div>
                  <span
                    className={`font-medium ${
                      isActive
                        ? "text-foreground"
                        : isComplete
                        ? "text-success"
                        : "text-muted-foreground"
                    }`}
                  >
                    {step.label}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Progress Bar */}
          <div className="mt-8">
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-primary to-secondary transition-all duration-500 ease-out"
                style={{
                  width: `${((currentStep + 1) / steps.length) * 100}%`,
                }}
              />
            </div>
            <p className="text-center text-sm text-muted-foreground mt-2">
              {Math.round(((currentStep + 1) / steps.length) * 100)}% Complete
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Progress;
