import { useState } from "react";
import DetectionImage from "./DetectionImage";

interface Props { original: string; annotated?: string; detectedAt: string; }

// Parent keys this component by Detection ID so navigation resets to Annotated.
export default function DetectionMedia({ original, annotated, detectedAt }: Props) {
  const [selected, setSelected] = useState<"original" | "annotated">(annotated ? "annotated" : "original");
  const isAnnotated = selected === "annotated" && Boolean(annotated);
  return <div>
    {annotated && <div className="dd-prev-next-row" role="group" aria-label="Detection image view">
      <button className="dd-nav-button" aria-pressed={!isAnnotated} onClick={() => setSelected("original")}>Original</button>
      <button className="dd-nav-button" aria-pressed={isAnnotated} onClick={() => setSelected("annotated")}>Annotated</button>
    </div>}
    <div className="dd-screenshot-box">
      <DetectionImage src={isAnnotated ? annotated! : original} alt={`${isAnnotated ? "Annotated" : "Original"} detection image at ${detectedAt}`} className="dd-screenshot-image" />
    </div>
    {isAnnotated && <p className="dd-confidence-note">Green: Normal · Red: Low · p(Normal) is a model classification probability, not a verified laying probability or calibrated confidence.</p>}
  </div>;
}
