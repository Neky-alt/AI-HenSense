import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface Props {
  label: string;
}

type TooltipPosition = {
  left: number;
  top: number;
  placement: "above" | "below";
};

const TOOLTIP_WIDTH = 320;
const VIEWPORT_GAP = 12;
const ANCHOR_GAP = 10;

export default function InfoTooltip({ label }: Props) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<TooltipPosition | null>(null);

  const updatePosition = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;

    const rect = anchor.getBoundingClientRect();
    const width = Math.min(TOOLTIP_WIDTH, window.innerWidth - VIEWPORT_GAP * 2);
    const preferredLeft = rect.left + rect.width / 2 - width / 2;
    const left = Math.min(
      Math.max(preferredLeft, VIEWPORT_GAP),
      Math.max(VIEWPORT_GAP, window.innerWidth - width - VIEWPORT_GAP)
    );

    const estimatedHeight = 118;
    const hasRoomAbove = rect.top >= estimatedHeight + ANCHOR_GAP + VIEWPORT_GAP;
    const placement = hasRoomAbove ? "above" : "below";
    const top = placement === "above"
      ? rect.top - ANCHOR_GAP
      : rect.bottom + ANCHOR_GAP;

    setPosition({ left, top, placement });
  }, []);

  useEffect(() => {
    if (!open) return;
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, updatePosition]);

  const show = () => {
    updatePosition();
    setOpen(true);
  };

  const hide = () => setOpen(false);

  return (
    <>
      <span
        ref={anchorRef}
        className="info-tooltip"
        tabIndex={0}
        aria-label={label}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
      >
        <span className="info-tooltip-icon" aria-hidden="true">ⓘ</span>
      </span>

      {open && position && createPortal(
        <span
          className={`info-tooltip-content info-tooltip-portal info-tooltip-${position.placement}`}
          role="tooltip"
          style={{
            left: position.left,
            top: position.top,
            width: `min(${TOOLTIP_WIDTH}px, calc(100vw - ${VIEWPORT_GAP * 2}px))`,
          }}
        >
          {label}
        </span>,
        document.body
      )}
    </>
  );
}
