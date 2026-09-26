import type { SVGProps } from "react";

type IconName =
  | "home"
  | "grid"
  | "cage"
  | "leaf"
  | "bell"
  | "user"
  | "search"
  | "settings"
  | "chevron"
  | "plus"
  | "edit"
  | "trash"
  | "device"
  | "chart"
  | "warning"
  | "info"
  | "clock"
  | "menu";

interface Props extends SVGProps<SVGSVGElement> {
  name: IconName;
  size?: number;
}

const common = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export default function Icon({ name, size = 20, ...props }: Props) {
  const paths: Record<IconName, React.ReactNode> = {
    home: <><path d="M3 10.8 12 3l9 7.8"/><path d="M5.5 9.5V21h13V9.5"/><path d="M9.2 21v-6.5h5.6V21"/></>,
    grid: <><rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1"/><rect x="14" y="3.5" width="6.5" height="6.5" rx="1"/><rect x="3.5" y="14" width="6.5" height="6.5" rx="1"/><rect x="14" y="14" width="6.5" height="6.5" rx="1"/></>,
    cage: <><path d="M4 4.5h16v15H4z"/><path d="M8 4.5v15M12 4.5v15M16 4.5v15"/><path d="M4 10h16M4 15h16"/></>,
    leaf: <><path d="M20.5 3.5C13 3.8 7 7.3 5.2 13.2c-1.1 3.7 1 6.6 4.1 6.6 6.9 0 10.2-8.1 11.2-16.3Z"/><path d="M4 21c3.6-5.2 7.7-8.8 13.2-11.2"/></>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></>,
    user: <><circle cx="12" cy="7.5" r="3.5"/><path d="M4.5 21a7.5 7.5 0 0 1 15 0"/></>,
    search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4v-.2a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/></>,
    chevron: <path d="m9 18 6-6-6-6"/>,
    plus: <><path d="M12 5v14"/><path d="M5 12h14"/></>,
    edit: <><path d="m4 20 4.2-1 10.4-10.4-3.2-3.2L5 15.8 4 20Z"/><path d="m13.8 7 3.2 3.2"/></>,
    trash: <><path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="m7 7 1 14h8l1-14"/><path d="M10 11v6M14 11v6"/></>,
    device: <><rect x="4" y="3.5" width="16" height="17" rx="2.5"/><path d="M8 7.5h8M8 12h8M9 17h6"/></>,
    chart: <><path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-7"/><path d="M22 20H2"/></>,
    warning: <><path d="M12 3 2.8 20h18.4L12 3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></>,
    info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><path d="M12 7h.01"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    menu: <><path d="M4 7h16M4 12h16M4 17h16"/></>,
  };

  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" {...common} {...props}>
      {paths[name]}
    </svg>
  );
}
