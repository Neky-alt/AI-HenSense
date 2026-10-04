import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import AppHeader from "../components/AppHeader";
import { detectionTriggerLabel } from "../utils/detectionDisplay";
import { MONITORING_STATUS_LABEL } from "../config/monitoringStatus";
import { deleteDetectionImage, deleteDetectionRecord, loadDetections, loadDevice } from "../services/detectionService";
import { LOCAL_BACKEND_WRITES } from "../services/apiClient";
import { userMessage } from "../lib/userMessages";
import { useBackendData } from "../hooks/useBackendData";
import BackendStatus from "../components/BackendStatus";

const PAGE_SIZE = 8;

type DeleteAction = {
  type: "image" | "record";
  detectionId: string;
  detectedAt: string;
} | null;

type ToastState = { type: "success" | "error"; message: string } | null;

function formatRowTime(iso: string) {
  return new Date(iso).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function DeviceHistory() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [deleteAction, setDeleteAction] = useState<DeleteAction>(null);
  const [toast, setToast] = useState<ToastState>(null);
  const [deleting, setDeleting] = useState(false);
  const deviceRequest = useBackendData(loadDevice, id);
  const historyRequest = useBackendData(loadDetections, id);
  const device = deviceRequest.data;
  const detections = historyRequest.data ?? [];
  const loading = deviceRequest.loading || historyRequest.loading;

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const error = deviceRequest.error || historyRequest.error;
  if (loading || error) return <div className="app"><AppHeader /><main className="dashboard"><button className="back-button" onClick={() => navigate(`/devices/${id}`)}>← Back</button><BackendStatus loading={loading} error={error} retry={() => { deviceRequest.retry(); historyRequest.retry(); }} /></main></div>;

  if (!device || !id) {
    return (
      <div className="app">
        <AppHeader />
        <main className="dashboard">
          <button className="back-button" onClick={() => navigate("/")}>← Back</button>
          <p>Device not found.</p>
        </main>
      </div>
    );
  }

  const totalPages = Math.max(1, Math.ceil(detections.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageItems = detections.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const requestDeleteImage = (detectionId: string, detectedAt: string) => {
    setDeleteAction({ type: "image", detectionId, detectedAt });
  };

  const requestDeleteRecord = (detectionId: string, detectedAt: string) => {
    setDeleteAction({ type: "record", detectionId, detectedAt });
  };

  const confirmDelete = async () => {
    if (!deleteAction || deleting) return;
    setDeleting(true);
    try {
      if (deleteAction.type === "image") {
        await deleteDetectionImage(device.device_id, deleteAction.detectionId);
        setToast({ type: "success", message: "Detection image deleted." });
      } else {
        await deleteDetectionRecord(device.device_id, deleteAction.detectionId);
        setToast({ type: "success", message: "Detection record deleted." });
      }
      setDeleteAction(null);
      historyRequest.retry();
    } catch (err) {
      setToast({ type: "error", message: userMessage(err, "Unable to delete. Please try again.") });
      setDeleteAction(null);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="app">
      <AppHeader />
      <main className="dashboard device-history-page">
        <button className="back-button" onClick={() => navigate(`/devices/${device.device_id}`)}>← Back to {device.device_name}</button>
        <div className="monitoring-page-header device-history-heading">
          <div>
            <h1>Detection History</h1>
            <p>{device.device_name} · {device.device_code}</p>
          </div>
        </div>

        <section className="recent-detection-section full-history-section">
          <div className="recent-detection-header">
            <div>
              <h2>All Detection Records</h2>
              <p>{detections.length} detection{detections.length === 1 ? "" : "s"} recorded.</p>
            </div>
          </div>

          {pageItems.length > 0 ? (
            <div className="recent-detection-list">
              {pageItems.map((detection) => (
                <div key={detection.detection_id} className="detection-row history-management-row">
                  <span>{formatRowTime(detection.detected_at)}<br /><small>{detectionTriggerLabel(detection.trigger_type)}</small></span>
                  <span className={`detection-classification detection-${detection.monitoring_status}`}>
                    {MONITORING_STATUS_LABEL[detection.monitoring_status]}
                  </span>
                  <span>Normal {detection.normal_count} / Low {detection.low_count} / Total {detection.total_count}</span>
                  <div className="history-row-actions">
                    <Link
                      to={`/devices/${device.device_id}/detections/${detection.detection_id}`}
                      className="history-action-link"
                    >
                      View
                    </Link>
                    {detection.screenshot_url ? (
                      LOCAL_BACKEND_WRITES && <button
                        type="button"
                        className="history-action-button"
                        onClick={() => requestDeleteImage(detection.detection_id, detection.detected_at)}
                      >
                        Delete image
                      </button>
                    ) : (
                      <span className="history-image-missing">Image unavailable</span>
                    )}
                    {LOCAL_BACKEND_WRITES && <button
                      type="button"
                      className="history-action-button danger"
                      onClick={() => requestDeleteRecord(detection.detection_id, detection.detected_at)}
                    >
                      Delete record
                    </button>}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state compact-empty-state">
              <h3>No detection records</h3>
              <p>This device does not have any historical detections yet.</p>
            </div>
          )}

          {totalPages > 1 && (
            <div className="dd-pagination">
              <button className="dd-page-link" disabled={currentPage === 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</button>
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((n) => (
                <button key={n} className={n === currentPage ? "dd-page-number active" : "dd-page-number"} onClick={() => setPage(n)}>{n}</button>
              ))}
              <button className="dd-page-link" disabled={currentPage === totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>Next</button>
            </div>
          )}
        </section>

        {toast && <div className={`settings-toast ${toast.type}`}>{toast.message}</div>}

        {deleteAction && (
          <div className="modal-overlay">
            <div className="system-modal" role="dialog" aria-modal="true">
              <div className="delete-icon">!</div>
              <h2>{deleteAction.type === "image" ? "Delete Detection Image?" : "Delete Detection Record?"}</h2>
              <p>
                {deleteAction.type === "image"
                  ? "This permanently removes the original and annotated images, on this system and in the cloud. Counts, ratios, status and timestamp stay in Detection History."
                  : "This removes the record from Detection History and permanently deletes its images, on this system and in the cloud."}
              </p>
              <div className="modal-device-info">
                <span>Detection time</span>
                <strong>{formatRowTime(deleteAction.detectedAt)}</strong>
                <small>{device.device_name}</small>
              </div>
              <div className="delete-modal-actions">
                <button className="secondary-button" onClick={() => setDeleteAction(null)} disabled={deleting}>Cancel</button>
                <button className="danger-button" onClick={confirmDelete} disabled={deleting}>
                  {deleting ? "Deleting…" : deleteAction.type === "image" ? "Delete Image" : "Delete Record"}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
