import { useEffect, useState } from 'react';
import { Alert } from 'react-native';

import AppScreen from '../../components/AppScreen';
import {
  InfoNote,
  OptionRow,
  SaveButton,
  SettingsBack,
  SettingsCard,
  SettingsHeader,
  TextField,
  ToggleRow,
  UnitField,
} from '../../components/SettingsUI';

import {
  getMonitoringSettings,
  saveMonitoringSettings,
} from '../../services/settingsService';

import type { MonitoringSettings } from '../../types/settings';

type Unit = 'minutes' | 'hours';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

const formatInterval = (
  minutes: number,
  unit: Unit
) =>
  unit === 'minutes'
    ? String(minutes)
    : String(Number((minutes / 60).toFixed(2)));

export default function CageSettings() {
  const [settings, setSettings] =
    useState<MonitoringSettings | null>(null);

  const [unit, setUnit] =
    useState<Unit>('minutes');

  const [interval, setInterval] =
    useState('');

  const [times, setTimes] =
    useState('');

  const [threshold, setThreshold] =
    useState('');

  const [start, setStart] =
    useState('');

  const [end, setEnd] =
    useState('');

  const [loadError, setLoadError] =
    useState(false);

  const [saving, setSaving] =
    useState(false);

  const [reload, setReload] =
    useState(0);

  useEffect(() => {
    let active = true;

    setLoadError(false);

    getMonitoringSettings('caged')
      .then((s) => {
        if (!active) {
          return;
        }

        setSettings(s);

        setInterval(
          String(
            s.detection_interval_minutes ?? 30
          )
        );

        setTimes(
          (s.scheduled_times ?? []).join(', ')
        );

        setThreshold(
          String(
            Math.round(
              (
                s.cage_warning_low_ratio_threshold ??
                0.6
              ) * 100
            )
          )
        );

        setStart(
          s.monitoring_start_time ?? ''
        );

        setEnd(
          s.monitoring_end_time ?? ''
        );
      })
      .catch(() => {
        if (active) {
          setLoadError(true);
        }
      });

    return () => {
      active = false;
    };
  }, [reload]);

  if (loadError) {
    return (
      <AppScreen>
        <SettingsBack />

        <SettingsHeader
          title="Cage Monitoring Settings"
          subtitle="Unable to load monitoring settings. Check your connection and try again."
        />

        <SaveButton
          label="Retry"
          onPress={() =>
            setReload((v) => v + 1)
          }
        />
      </AppScreen>
    );
  }

  if (!settings) {
    return (
      <AppScreen>
        <SettingsBack />

        <SettingsHeader
          title="Cage Monitoring Settings"
          subtitle="Loading, please wait..."
        />
      </AppScreen>
    );
  }

  const updateSettings = (
    patch: Partial<MonitoringSettings>
  ) => {
    setSettings((current) =>
      current
        ? {
            ...current,
            ...patch,
          }
        : current
    );
  };

  const changeUnit = (next: Unit) => {
    const parsed = Number(interval);

    if (
      interval.trim() &&
      Number.isFinite(parsed)
    ) {
      const minutes =
        parsed *
        (unit === 'hours' ? 60 : 1);

      setInterval(
        next === unit
          ? interval
          : formatInterval(
              minutes,
              next
            )
      );
    }

    setUnit(next);
  };

  const save = async () => {
    if (saving) {
      return;
    }

    if (
      !HHMM.test(start) ||
      !HHMM.test(end)
    ) {
      Alert.alert(
        'Invalid time',
        'Use a valid 24-hour HH:MM monitoring window.'
      );

      return;
    }

    const numericThreshold =
      Number(threshold);

    if (
      !/^\d+(?:\.\d{1,2})?$/.test(
        threshold.trim()
      ) ||
      numericThreshold < 0 ||
      numericThreshold > 100
    ) {
      Alert.alert(
        'Invalid threshold',
        'Enter a Low-production threshold from 0 to 100%.'
      );

      return;
    }

    let frequency =
      settings.detection_interval_minutes;

    let scheduled =
      settings.scheduled_times;

    if (
      settings.detection_mode ===
      'interval'
    ) {
      if (
        !/^\d+(?:\.\d{1,2})?$/.test(
          interval.trim()
        ) ||
        Number(interval) <= 0
      ) {
        Alert.alert(
          'Invalid interval',
          'Enter a positive detection interval.'
        );

        return;
      }

      frequency = Math.round(
        Number(interval) *
          (unit === 'hours' ? 60 : 1)
      );

      if (!frequency) {
        Alert.alert(
          'Invalid interval',
          'Choose an interval of at least one minute.'
        );

        return;
      }
    } else {
      scheduled = times
        .split(/[\n,]+/)
        .map((x) => x.trim())
        .filter(Boolean);

      if (
        !scheduled.length ||
        scheduled.some(
          (x) => !HHMM.test(x)
        )
      ) {
        Alert.alert(
          'Invalid schedule',
          'Enter one or more times in HH:MM format, separated by commas.'
        );

        return;
      }

      scheduled = [
        ...new Set(scheduled),
      ];
    }

    setSaving(true);

    try {
      const saved =
        await saveMonitoringSettings({
          ...settings,
          monitoring_start_time:
            start,
          monitoring_end_time:
            end,
          detection_interval_minutes:
            frequency,
          scheduled_times:
            scheduled,
          cage_warning_low_ratio_threshold:
            numericThreshold / 100,
        });

      setSettings(saved);

      Alert.alert(
        'Saved',
        'Cage monitoring settings have been saved.'
      );
    } catch {
      Alert.alert(
        'Save failed',
        'Unable to save monitoring settings. Check your connection and try again.'
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppScreen>
      <SettingsBack />

      <SettingsHeader
        title="Cage Monitoring Settings"
        subtitle="Capture and AI inference form one scheduled task. Configure the schedule and Warning threshold."
      />

      <SettingsCard
        title="Capture & Detection Schedule"
        icon="time-outline"
        subtitle="A scheduled check captures the current frame, runs AI and saves one formal result."
      >
        <ToggleRow
          title="Monitoring Enabled"
          subtitle="Stops new automatic detections when off. Existing History remains; manual detection works while the device is online."
          value={
            settings.monitoring_enabled
          }
          onValueChange={(
            monitoring_enabled
          ) =>
            updateSettings({
              monitoring_enabled,
            })
          }
        />

        <OptionRow
          label="Fixed Interval"
          selected={
            settings.detection_mode ===
            'interval'
          }
          onPress={() =>
            updateSettings({
              detection_mode:
                'interval',
            })
          }
        />

        <OptionRow
          label="Scheduled Times"
          selected={
            settings.detection_mode ===
            'scheduled'
          }
          onPress={() =>
            updateSettings({
              detection_mode:
                'scheduled',
            })
          }
        />

        {settings.detection_mode ===
        'interval' ? (
          <UnitField
            label="Monitoring Frequency"
            value={interval}
            onChangeText={(value) =>
              setInterval(
                value.replace(
                  /[^\d.]/g,
                  ''
                )
              )
            }
            unit={unit}
            onUnitChange={changeUnit}
          />
        ) : (
          <TextField
            label="Scheduled Times"
            value={times}
            onChangeText={setTimes}
            placeholder="09:00, 12:00, 17:00"
            suffix="HH:MM"
            keyboardType="default"
          />
        )}

        <TextField
          label="Monitoring Window · Start"
          value={start}
          onChangeText={setStart}
          suffix="HH:MM"
          keyboardType="default"
        />

        <TextField
          label="Monitoring Window · End"
          value={end}
          onChangeText={setEnd}
          suffix="HH:MM"
          keyboardType="default"
        />

        <InfoNote>
          Scheduled times and the
          monitoring window use farm
          local time when the backend
          is connected.
        </InfoNote>
      </SettingsCard>

      <SettingsCard
        title="Warning Rule"
        icon="warning-outline"
        subtitle="Two consecutive formal Cage detections must meet or exceed the threshold."
      >
        <TextField
          label="Low-production Warning Threshold"
          value={threshold}
          onChangeText={(value) =>
            setThreshold(
              value.replace(
                /[^\d.]/g,
                ''
              )
            )
          }
          suffix="%"
        />

        <InfoNote tone="red">
          Current rule:
          Low-production Ratio ≥{' '}
          {threshold || '—'}% for two
          consecutive formal detections
          → Warning.
        </InfoNote>

        <InfoNote>
          Monitoring Status is Normal
          or Warning. Alerts are created
          and resolved automatically by
          the system.
        </InfoNote>
      </SettingsCard>

      <SaveButton
        onPress={save}
        saving={saving}
      />
    </AppScreen>
  );
}