import { Link } from "react-router-dom";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { loadDetections } from "../services/detectionService";
import { useBackendData } from "../hooks/useBackendData";
import BackendStatus from "./BackendStatus";
import { detectionTriggerLabel } from "../utils/detectionDisplay";
import { MONITORING_STATUS_LABEL } from "../config/monitoringStatus";

const RECENT_LIMIT = 5;

function formatChartLabel(iso: string) {
  return new Date(iso).toLocaleString([], {
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatRowTime(iso: string) {
  return new Date(iso).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

interface Props { deviceId: string; }

export default function DetectionHistory({ deviceId }: Props) {
  const request = useBackendData(loadDetections, deviceId);
  const detections = request.data ?? [];
  if (request.loading || request.error) return <section className="dd-history"><h2>Detection History</h2><BackendStatus {...request} /></section>;

  if (detections.length === 0) {
    return <section className="dd-history"><h2>Detection History</h2><p className="dd-empty-note">No detection records yet.</p></section>;
  }

  const chartData = [...detections].reverse().map((d) => ({
    label: formatChartLabel(d.detected_at),
    normal_ratio_percent: d.normal_ratio === null ? null : d.normal_ratio * 100,
    low_ratio_percent: d.low_ratio === null ? null : d.low_ratio * 100,
  }));

  const recentDetections = detections.slice(0, RECENT_LIMIT);

  return (
    <section className="dd-history">
      <h2>Historical Trend</h2>
      <div className="dd-trend-chart">
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
            <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} tick={{ fontSize: 11 }} width={40} />
            <Tooltip formatter={(value, name) => [`${Number(value).toFixed(0)}%`, name === "normal_ratio_percent" ? "Normal Ratio" : "Low-production Ratio"]} />
            <Legend formatter={(value) => value === "normal_ratio_percent" ? "Normal Ratio" : "Low-production Ratio"} />
            <Line type="monotone" dataKey="normal_ratio_percent" stroke="#16a34a" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 6 }} />
            <Line type="monotone" dataKey="low_ratio_percent" stroke="#ef4444" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 6 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="recent-detection-header dd-recent-heading">
        <div>
          <h2>Recent Detections</h2>
          <p>Open a result to review the stored original image and classification counts.</p>
        </div>
        <Link className="text-action" to={`/devices/${deviceId}/history`}>View all history →</Link>
      </div>

      <div className="recent-detection-list">
        {recentDetections.map((detection) => (
          <Link
            key={detection.detection_id}
            to={`/devices/${deviceId}/detections/${detection.detection_id}`}
            className="detection-row clickable detection-row-link"
          >
            <span>{formatRowTime(detection.detected_at)}<br /><small>{detectionTriggerLabel(detection.trigger_type)}</small></span>
            <span className={`detection-classification detection-${detection.monitoring_status}`}>
              {MONITORING_STATUS_LABEL[detection.monitoring_status]}
            </span>
            <span>Normal {detection.normal_count} / Low {detection.low_count} / Total {detection.total_count}</span>
            <span className="detection-row-arrow">View →</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
