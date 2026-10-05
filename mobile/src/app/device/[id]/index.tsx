import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import AppScreen from '../../../components/AppScreen';
import BackendStatus from '../../../components/BackendStatus';
import DetectionHistory from '../../../components/DetectionHistory';
import DevicePhoto from '../../../components/DevicePhoto';
import LatestManualDetection from '../../../components/LatestManualDetection';
import RemoveDeviceSheet from '../../../components/RemoveDeviceSheet';
import {
  ConnectionBadge,
  MonitoringBadge,
} from '../../../components/StatusBadge';
import { COLORS } from '../../../constants/theme';
import { useBackendData } from '../../../hooks/useBackendData';
import {
  getFreeRangeResults,
  runManualDetection,
  withDetection,
} from '../../../services/detectionService';
import { getDeviceById } from '../../../services/deviceStorage';
import { deviceManagementEnabled } from '../../../services/deviceService';
import type { Device } from '../../../types/device';
import { formatRatio } from '../../../utils/ratio';
import { formatDeviceUpdate } from '../../../utils/time';

async function loadDevice(id: string, signal: AbortSignal) {
  const device = await getDeviceById(id, signal);

  const results =
    device.farming_type === 'free_range'
      ? await getFreeRangeResults(id, signal)
      : null;

  return {
    device: results
      ? withDetection(device, results.formal)
      : device,
    manual: results?.manual ?? null,
  };
}

const DETECTION_POLL_INTERVAL_MS = 2000;
const DETECTION_MAX_POLLS = 20;

function wait(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

export default function DeviceDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();

  const state = useBackendData(
    loadDevice,
    String(id)
  );

  const device = state.data?.device;

  const [message, setMessage] = useState('');
  const [requesting, setRequesting] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const canManage = deviceManagementEnabled();

  if (state.loading || state.error) {
    return (
      <AppScreen>
        <Back onPress={() => router.back()} />
        <BackendStatus {...state} />
      </AppScreen>
    );
  }

  if (!device) {
    return (
      <AppScreen>
        <Back onPress={() => router.back()} />
        <Text style={styles.notFound}>
          Device not found.
        </Text>
      </AppScreen>
    );
  }

  // Existing UI meaning:
  // no latest detection data, not actual device connection status.
  const offline = !device.latest_detection_id;

  const free =
    device.farming_type === 'free_range';

  // Actual hardware connection state used for manual detection.
  const deviceOffline =
    device.device_status !== 'online';

const runDetection = async () => {
  if (requesting || deviceOffline) {
    return;
  }

  setRequesting(true);
  setMessage('');

  const previousDetectionId =
    device.latest_detection_id;

  const previousManualId =
    state.data?.manual?.detection_id ?? null;

  try {
    const command = await runManualDetection(
      device.device_id
    );

    setMessage(
      `Detection requested (${command.command_status}). Waiting for result...`
    );

    for (
      let attempt = 0;
      attempt < DETECTION_MAX_POLLS;
      attempt += 1
    ) {
      await wait(
        DETECTION_POLL_INTERVAL_MS
      );

      try {
        const controller =
          new AbortController();

        const latest = await loadDevice(
          device.device_id,
          controller.signal
        );

        const latestDetectionId =
          latest.device.latest_detection_id;

        const latestManualId =
          latest.manual?.detection_id ??
          null;

        const completed = free
          ? Boolean(
              latestManualId &&
                latestManualId !==
                  previousManualId
            )
          : Boolean(
              latestDetectionId &&
                latestDetectionId !==
                  previousDetectionId
            );

        if (completed) {
          setMessage(
            'Detection completed. Refreshing result...'
          );

          state.retry();

          return;
        }
} catch {
  // Ignore temporary polling errors.
}
    }

    setMessage(
      'Detection is taking longer than expected. It may still complete in the background.'
    );
  } catch {
    setMessage(
      'Unable to start detection. Please check the connection and try again.'
    );
  } finally {
    setRequesting(false);
  }
};

  return (
    <AppScreen>
      <Back
        onPress={() =>
          router.replace(
            free
              ? '/free-range'
              : '/cage'
          )
        }
      />

      <View style={styles.titleRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.name}>
            {device.device_name}
          </Text>

          <View style={styles.meta}>
            <Text style={styles.code}>
              {device.device_code}
            </Text>

            <ConnectionBadge
              status={device.device_status}
            />
          </View>
        </View>
      </View>

      <View style={styles.actions}>
        <Pressable
          disabled={
            deviceOffline ||
            requesting
          }
          onPress={runDetection}
          accessibilityHint="Run a manual detection using this device"
          style={[
            styles.primaryBtn,
            {
              opacity:
                deviceOffline ||
                requesting
                  ? 0.45
                  : 1,
            },
          ]}
        >
          <Ionicons
            name="scan-outline"
            size={16}
            color="#fff"
          />

          <Text style={styles.primaryText}>
            {requesting
              ? 'Requesting...'
              : 'Run Detection Now'}
          </Text>
        </Pressable>

        {canManage && (
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              router.push(
                `/device/edit/${device.device_id}`
              )
            }
            style={styles.secondaryBtn}
          >
            <Ionicons
              name="create-outline"
              size={16}
              color={COLORS.primaryDark}
            />

            <Text style={styles.secondaryText}>
              Edit Name
            </Text>
          </Pressable>
        )}
      </View>

      {message ? (
        <View style={styles.message}>
          <Ionicons
            name="checkmark-circle-outline"
            size={16}
            color={COLORS.primaryDark}
          />

          <Text style={styles.messageText}>
            {message}
          </Text>
        </View>
      ) : null}

      {device.latest_detection_id &&
        device.device_status !== 'online' && (
          <Text style={styles.updated}>
            Last Recorded Result
          </Text>
        )}

      {free &&
        !device.latest_detection_id && (
          <Text style={styles.updated}>
            No formal Result Snapshot
          </Text>
        )}

      <View style={{ marginBottom: 12 }}>
        <DevicePhoto
          device={device}
          height={205}
        />
      </View>

      <View style={styles.statPanel}>
        <View style={styles.ratioRow}>
          <Ratio
            label="Normal Ratio"
            value={
              offline
                ? null
                : device.normal_ratio
            }
          />

          <Ratio
            label={
              free
                ? 'Current Snapshot Low Ratio'
                : 'Low-production Ratio'
            }
            value={
              offline
                ? null
                : device.low_ratio
            }
            low
          />
        </View>

        <View style={styles.statusLine}>
          <Text style={styles.label}>
            Monitoring Status
          </Text>

          {offline ? (
            <Text style={styles.noData}>
              No current data
            </Text>
          ) : (
            <MonitoringBadge
              status={
                device.monitoring_status!
              }
            />
          )}
        </View>

        <View style={styles.countRow}>
          {[
            ['Normal', device.normal_count],
            ['Low', device.low_count],
            ['Total', device.total_count],
          ].map(([key, value]) => (
            <View
              key={String(key)}
              style={styles.count}
            >
              <Text
                style={styles.countLabel}
              >
                {key}
              </Text>

              <Text
                style={[
                  styles.countValue,
                  key === 'Low' &&
                    !offline && {
                      color:
                        COLORS.danger,
                    },
                ]}
              >
                {offline
                  ? '--'
                  : value}
              </Text>
            </View>
          ))}
        </View>
      </View>


      <View style={styles.retention}>
        <Ionicons
          name="information-circle-outline"
          size={14}
          color={COLORS.textSecondary}
        />

        <Text style={styles.retentionText}>
          Detection images are kept for 30
          days, then deleted automatically
          on the device and in the cloud.
          Counts and history records are
          kept.
        </Text>
      </View>

      <Text style={styles.updated}>
        Updated{' '}
        {formatDeviceUpdate(
          device.detected_at
        )}
      </Text>

      <LatestManualDetection
        device={device}
        detection={
          state.data?.manual ?? null
        }
      />

      <DetectionHistory
        key={`${device.latest_detection_id ?? 'none'}:${state.data?.manual?.detection_id ?? 'none'}`}
        deviceId={device.device_id}
        farmingType={device.farming_type}
      />

      {canManage && (
        <>
          <Pressable
            accessibilityRole="button"
            onPress={() => setRemoveOpen(true)}
            style={styles.removeBtn}
          >
            <Ionicons
              name="trash-outline"
              size={16}
              color={COLORS.danger}
            />

            <Text style={styles.removeText}>
              Remove Device
            </Text>
          </Pressable>

          <RemoveDeviceSheet
            device={device}
            visible={removeOpen}
            onClose={() => setRemoveOpen(false)}
            onRemoved={(purged) => {
              setRemoveOpen(false);
              router.replace(free ? '/free-range' : '/cage');
              Alert.alert(
                'Device removed',
                purged
                  ? 'The device and all its history have been deleted.'
                  : 'The device has been removed. Its history is kept.'
              );
            }}
          />
        </>
      )}
    </AppScreen>
  );
}

function Back({
  onPress,
}: {
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={styles.back}
    >
      <Ionicons
        name="arrow-back"
        size={18}
        color={COLORS.textSecondary}
      />

      <Text style={styles.backText}>
        Back
      </Text>
    </Pressable>
  );
}

function Ratio({
  label,
  value,
  low = false,
}: {
  label: string;
  value: number | null;
  low?: boolean;
}) {
  return (
    <View style={styles.ratioBox}>
      <Text style={styles.label}>
        {label}
      </Text>

      <Text
        style={[
          styles.ratio,
          {
            color: low
              ? COLORS.danger
              : COLORS.normal,
          },
        ]}
      >
        {formatRatio(value)}
      </Text>

      <View style={styles.track}>
        <View
          style={[
            styles.fill,
            {
              width: `${Math.round(
                (value ?? 0) * 100
              )}%`,
              backgroundColor: low
                ? COLORS.danger
                : COLORS.normal,
            },
          ]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  back: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start',
    paddingVertical: 13,
  },

  backText: {
    fontSize: 10.5,
    fontWeight: '700',
    color: COLORS.textSecondary,
  },

  notFound: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 20,
  },

  titleRow: {
    marginBottom: 12,
  },

  name: {
    fontSize: 21,
    fontWeight: '900',
    color: COLORS.text,
    letterSpacing: -0.6,
  },

  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 6,
  },

  code: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.textSecondary,
    backgroundColor: COLORS.surface,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
  },

  actions: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },

  primaryBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: 11,
    borderRadius: 12,
    backgroundColor: COLORS.primary,
  },

  primaryText: {
    fontSize: 10.5,
    fontWeight: '800',
    color: '#fff',
  },

  secondaryBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: 11,
    borderRadius: 12,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },

  secondaryText: {
    fontSize: 10.5,
    fontWeight: '800',
    color: COLORS.primaryDark,
  },

  retention: {
    flexDirection: 'row',
    gap: 6,
    alignItems: 'flex-start',
    marginTop: 12,
  },

  retentionText: {
    flex: 1,
    fontSize: 9.5,
    lineHeight: 14,
    color: COLORS.textSecondary,
  },

  removeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: 12,
    marginTop: 18,
    marginBottom: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#FAD3D4',
    backgroundColor: '#FFF8F8',
  },

  removeText: {
    fontSize: 11,
    fontWeight: '800',
    color: COLORS.danger,
  },

  message: {
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
    padding: 10,
    borderRadius: 12,
    backgroundColor:
      COLORS.primarySoft,
    marginBottom: 10,
  },

  messageText: {
    fontSize: 10,
    color: COLORS.primaryDark,
    fontWeight: '700',
  },

  statPanel: {
    padding: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },

  ratioRow: {
    flexDirection: 'row',
    gap: 10,
  },

  ratioBox: {
    flex: 1,
    padding: 11,
    borderRadius: 13,
    backgroundColor:
      COLORS.surfaceSoft,
    borderWidth: 1,
    borderColor: COLORS.border,
  },

  label: {
    fontSize: 10,
    color: COLORS.textSecondary,
    fontWeight: '600',
  },

  ratio: {
    fontSize: 22,
    fontWeight: '800',
    marginTop: 4,
  },

  track: {
    height: 5,
    borderRadius: 999,
    backgroundColor: '#EDF2EF',
    overflow: 'hidden',
    marginTop: 7,
  },

  fill: {
    height: '100%',
    borderRadius: 999,
  },

  statusLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent:
      'space-between',
    marginTop: 13,
  },

  noData: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.offline,
    backgroundColor:
      COLORS.offlineSoft,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 999,
  },

  countRow: {
    flexDirection: 'row',
    marginTop: 13,
    paddingTop: 12,
    borderTopWidth: 1,
    borderColor: COLORS.border,
  },

  count: {
    flex: 1,
    alignItems: 'center',
  },

  countLabel: {
    fontSize: 9.5,
    color: COLORS.textSecondary,
  },

  countValue: {
    fontSize: 18,
    fontWeight: '800',
    color: COLORS.text,
    marginTop: 2,
  },

  updated: {
    fontSize: 9.5,
    color: COLORS.textLight,
    marginTop: 9,
  },
});