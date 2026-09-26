import AuthorizedImage from './AuthorizedImage';
import { useState } from "react";

interface Props { src: string; fallbackSrc?: string; alt: string; className: string; }

function ImageContent({ src, fallbackSrc, alt, className }: Props) {
  const [primaryFailed, setPrimaryFailed] = useState(false);
  const activeSrc = primaryFailed || !src ? fallbackSrc : src;
  const [failed, setFailed] = useState(false);
  const detailed = className === "dd-screenshot-image";
  if (!activeSrc || failed) return (
    <div className="detection-image-removed" role="status" style={detailed ? undefined : { minHeight: 0, padding: 12 }}>
      <strong>Detection image unavailable</strong>
      {detailed && <span>{failed ? "The stored image could not be loaded." : "No stored image is available for this result."} The structured detection record is retained.</span>}
    </div>
  );
  return <AuthorizedImage src={activeSrc} alt={alt} className={className} onError={() => {
    if (!primaryFailed && src && fallbackSrc && src !== fallbackSrc) setPrimaryFailed(true);
    else setFailed(true);
  }} />;
}

export default function DetectionImage(props: Props) {
  return <ImageContent key={JSON.stringify([props.src, props.fallbackSrc])} {...props} />;
}
