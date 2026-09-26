import type { ReactNode } from "react";
import InfoTooltip from "./InfoTooltip";
import Icon from "./Icon";

type SummaryTone = "neutral" | "normal" | "warning" | "offline" | "low" | "highlight";
type SummaryIcon = "device" | "chart" | "warning" | "info";

interface Props {
  title: string;
  value: ReactNode;
  tooltip: string;
  description?: string;
  valueClassName?: string;
  onClick?: () => void;
  tone?: SummaryTone;
  icon?: SummaryIcon;
  footer?: string;
}

export default function SummaryCard({
  title,
  value,
  tooltip,
  description,
  valueClassName,
  onClick,
  tone = "neutral",
  icon = "info",
  footer,
}: Props) {
  const content = (
    <>
      <div className={`summary-icon summary-icon-${tone}`}>
        <Icon name={icon} size={22} />
      </div>

      <div className="summary-card-body">
        <div className="summary-card-title-row">
          <h3>{title}</h3>
          <InfoTooltip label={tooltip} />
        </div>
        <strong className={valueClassName}>{value}</strong>
        {description && <span className="card-note">{description}</span>}
        {footer && <span className="summary-footer-note">{footer}</span>}
      </div>
    </>
  );

  const className = `summary-card summary-card-${tone}${
    onClick ? " summary-card-clickable" : ""
  }`;

  if (onClick) {
    return (
      <button className={className} onClick={onClick}>
        {content}
      </button>
    );
  }

  return <div className={className}>{content}</div>;
}
