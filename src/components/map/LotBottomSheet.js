import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { STATUS_META } from '../../constants/statusStyle';
import { appTheme, componentMetrics } from '../../theme/tokens';
import { isEveningTime } from '../../utils/engine';
import PrimaryButton from '../common/PrimaryButton';

const formatUpdatedAt = (timestamp) => {
  if (!timestamp) {
    return null;
  }
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const clampScore = (value) => Math.max(0, Math.min(100, Math.round(value ?? 50)));

const scoreColor = (score) => {
  if (score > 75) return appTheme.color.status.EMPTY;
  if (score > 50) return appTheme.color.status.NORMAL;
  if (score > 25) return appTheme.color.status.CROWDED;
  return appTheme.color.status.FULL;
};

export default function LotBottomSheet({
  visible,
  lot,
  predictedStatus,
  canReport = true,
  reportDisabledMessage = '',
  timelineScores = [],
  onClose,
  onNavigate,
  onReport,
}) {
  if (!visible || !lot) {
    return null;
  }

  const status = predictedStatus?.status || lot.lastStatus;
  const statusMeta = STATUS_META[status];
  const clampedScore = clampScore(predictedStatus?.score);
  const dayTotal = (lot.generalSpaces || 0) + (lot.reservedSpaces || 0) + (lot.shortTermSpaces || 0);
  const eveningTotal = (lot.eveningGeneralSpaces || 0) + (lot.eveningShortTermSpaces || 0);
  const dayEst = Math.round((dayTotal * clampedScore) / 100);
  const eveEst = Math.round((eveningTotal * clampedScore) / 100);
  const eveningNow = isEveningTime();
  const activePeriodLabel = eveningNow ? 'Evening' : 'Day';
  const activeEst = eveningNow ? eveEst : dayEst;
  const activeTotal = eveningNow ? eveningTotal : dayTotal;
  const updatedAt = predictedStatus?.updatedAt || lot.lastStatusAt;
  const updatedSource = predictedStatus?.updatedBy || (lot.lastStatusAt ? 'Crowd' : null);
  const updatedText = updatedAt && updatedSource ? `${updatedSource} ${formatUpdatedAt(updatedAt)}` : null;

  return (
    <View style={styles.container}>
      <View style={styles.handle} />
      <View style={styles.headerRow}>
        <View style={styles.headerMain}>
          <Text numberOfLines={1} style={styles.name}>
            {lot.name}
          </Text>
          <Text numberOfLines={1} style={styles.address}>
            {lot.address}
          </Text>
        </View>
        <Pressable accessibilityLabel="Close lot details" onPress={onClose} style={styles.closeButton}>
          <Text style={styles.closeText}>Close</Text>
        </Pressable>
      </View>

      <View style={styles.metaRow}>
        <View style={[styles.pill, { backgroundColor: statusMeta.color }]}>
          <Text style={styles.pillText}>{statusMeta.label}</Text>
        </View>
        {updatedText ? (
          <View style={styles.pillMuted}>
            <Text style={styles.pillMutedText}>Updated {updatedText}</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.scoreSection}>
        <View style={styles.scoreHeadingRow}>
          <Text style={styles.scoreHeading}>Predicted score</Text>
          <Text style={styles.scoreValue}>{clampedScore}/100</Text>
        </View>
        <View style={styles.scoreTrack}>
          <Svg height="10" style={StyleSheet.absoluteFill} width="100%">
            <Defs>
              <LinearGradient id="scoreGrad" x1="0%" x2="100%" y1="0%" y2="0%">
                <Stop offset="0%" stopColor={appTheme.color.status.FULL} />
                <Stop offset="50%" stopColor={appTheme.color.status.CROWDED} />
                <Stop offset="100%" stopColor={appTheme.color.status.EMPTY} />
              </LinearGradient>
            </Defs>
            <Rect fill="url(#scoreGrad)" height="10" rx="5" ry="5" width="100%" x="0" y="0" />
          </Svg>
          <View
            style={[
              styles.scorePointer,
              {
                left: `${clampedScore}%`,
                backgroundColor: scoreColor(clampedScore),
              },
            ]}
          />
        </View>
        <View style={styles.scoreCaptionRow}>
          <Text style={styles.scoreCaption}>Packed</Text>
          <Text style={styles.scoreCaption}>More Available</Text>
        </View>
      </View>

      <View style={styles.infoGrid}>
        <View style={styles.infoItem}>
          <Text style={styles.infoLabel}>Day Total</Text>
          <Text style={styles.infoValue}>{dayTotal}</Text>
          <Text style={styles.infoSubText}>
            {eveningNow ? 'Est. available: inactive now' : `Est. available: ~${dayEst}`}
          </Text>
        </View>
        <View style={styles.infoItem}>
          <Text style={styles.infoLabel}>Evening Total</Text>
          <Text style={styles.infoValue}>{eveningTotal}</Text>
          <Text style={styles.infoSubText}>
            {eveningNow ? `Est. available: ~${eveEst}` : 'Est. available: inactive now'}
          </Text>
        </View>
      </View>
      <Text style={styles.periodLine}>
        Est. available now ({activePeriodLabel}): ~{activeEst}/{activeTotal}
      </Text>

      <Text style={styles.detailLine}>
        General {lot.generalSpaces || 0} / Reserved {lot.reservedSpaces || 0} / Short-term {lot.shortTermSpaces || 0}
      </Text>
      <Text style={styles.detailLine}>
        Evening General {lot.eveningGeneralSpaces || 0} / Evening Short-term {lot.eveningShortTermSpaces || 0}
      </Text>

      {timelineScores.length > 0 ? (
        <View style={styles.timelineSection}>
          <Text style={styles.timelineTitle}>24h Predicted Availability</Text>
          <View style={styles.timelineBars}>
            {timelineScores.map((score, index) => (
              <View key={`timeline-${index}`} style={styles.timelineSlot}>
                <View
                  style={[
                    styles.timelineBar,
                    {
                      height: Math.max(6, Math.round((score / 100) * 34)),
                      backgroundColor: scoreColor(score),
                    },
                  ]}
                />
              </View>
            ))}
          </View>
          <View style={styles.timelineLabelRow}>
            <Text style={styles.timelineLabel}>00:00</Text>
            <Text style={styles.timelineLabel}>12:00</Text>
            <Text style={styles.timelineLabel}>23:00</Text>
          </View>
        </View>
      ) : null}

      <View style={styles.actionRow}>
        <PrimaryButton accessibilityLabel="Navigate to lot" label="Navigate" onPress={onNavigate} style={styles.actionPrimary} />
        <Pressable
          accessibilityLabel="Report lot status"
          disabled={!canReport}
          onPress={onReport}
          style={[styles.actionSecondary, !canReport && styles.actionSecondaryDisabled]}
        >
          <Text style={styles.actionSecondaryText}>Report Status</Text>
        </Pressable>
      </View>
      {!canReport && reportDisabledMessage ? <Text style={styles.reportHint}>{reportDisabledMessage}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: appTheme.color.bgElevated,
    borderTopLeftRadius: appTheme.radius.xl,
    borderTopRightRadius: appTheme.radius.xl,
    borderWidth: 1,
    borderColor: appTheme.color.borderDefault,
    paddingTop: appTheme.spacing.sm,
    paddingHorizontal: componentMetrics.horizontalPadding,
    paddingBottom: componentMetrics.bottomSafePadding + appTheme.spacing.sm,
  },
  handle: {
    alignSelf: 'center',
    width: 42,
    height: 4,
    borderRadius: appTheme.radius.sm,
    backgroundColor: appTheme.color.textSecondary,
    opacity: 0.45,
    marginBottom: appTheme.spacing.md,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: appTheme.spacing.sm,
    gap: appTheme.spacing.sm,
  },
  headerMain: {
    flex: 1,
  },
  name: {
    color: appTheme.color.textPrimary,
    fontSize: appTheme.typography.size.lg,
    fontWeight: '700',
  },
  address: {
    color: appTheme.color.textSecondary,
    fontSize: appTheme.typography.size.sm,
    marginTop: 2,
  },
  closeButton: {
    minHeight: componentMetrics.touchTargetMin,
    minWidth: componentMetrics.touchTargetMin,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: appTheme.spacing.sm,
  },
  closeText: {
    color: appTheme.color.textSecondary,
    fontSize: appTheme.typography.size.sm,
    fontWeight: '600',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: appTheme.spacing.sm,
    marginBottom: appTheme.spacing.sm,
  },
  pill: {
    borderRadius: appTheme.radius.md,
    paddingHorizontal: appTheme.spacing.sm,
    paddingVertical: 6,
  },
  pillText: {
    color: appTheme.color.bgCanvas,
    fontSize: appTheme.typography.size.xs,
    fontWeight: '700',
  },
  pillMuted: {
    borderRadius: appTheme.radius.md,
    backgroundColor: appTheme.color.bgSurface,
    paddingHorizontal: appTheme.spacing.sm,
    paddingVertical: 6,
  },
  pillMutedText: {
    color: appTheme.color.textSecondary,
    fontSize: appTheme.typography.size.xs,
  },
  scoreSection: {
    marginBottom: appTheme.spacing.md,
  },
  scoreHeadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: appTheme.spacing.xs,
  },
  scoreHeading: {
    color: appTheme.color.textSecondary,
    fontSize: appTheme.typography.size.xs,
  },
  scoreValue: {
    color: appTheme.color.textPrimary,
    fontSize: appTheme.typography.size.sm,
    fontWeight: '700',
  },
  scoreTrack: {
    position: 'relative',
    height: 10,
    borderRadius: 5,
    overflow: 'visible',
  },
  scorePointer: {
    position: 'absolute',
    top: -4,
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    transform: [{ translateX: -9 }],
  },
  scoreCaptionRow: {
    marginTop: appTheme.spacing.xs,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  scoreCaption: {
    color: appTheme.color.textSecondary,
    fontSize: 11,
  },
  infoGrid: {
    flexDirection: 'row',
    gap: appTheme.spacing.sm,
  },
  infoItem: {
    flex: 1,
    borderWidth: 1,
    borderColor: appTheme.color.borderDefault,
    borderRadius: appTheme.radius.md,
    backgroundColor: appTheme.color.bgSurface,
    padding: appTheme.spacing.sm,
  },
  infoLabel: {
    color: appTheme.color.textSecondary,
    fontSize: appTheme.typography.size.xs,
    marginBottom: 2,
  },
  infoValue: {
    color: appTheme.color.textPrimary,
    fontSize: appTheme.typography.size.md,
    fontWeight: '600',
  },
  infoSubText: {
    marginTop: 4,
    color: appTheme.color.textSecondary,
    fontSize: appTheme.typography.size.xs,
  },
  periodLine: {
    marginTop: appTheme.spacing.sm,
    color: appTheme.color.textPrimary,
    fontSize: appTheme.typography.size.sm,
    fontWeight: '600',
  },
  detailLine: {
    marginTop: appTheme.spacing.sm,
    color: appTheme.color.textSecondary,
    fontSize: appTheme.typography.size.xs,
  },
  timelineSection: {
    marginTop: appTheme.spacing.md,
  },
  timelineTitle: {
    color: appTheme.color.textSecondary,
    fontSize: appTheme.typography.size.xs,
    marginBottom: appTheme.spacing.xs,
  },
  timelineBars: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
    height: 36,
    borderWidth: 1,
    borderColor: appTheme.color.borderDefault,
    borderRadius: appTheme.radius.sm,
    backgroundColor: appTheme.color.bgSurface,
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  timelineSlot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  timelineBar: {
    width: 4,
    borderRadius: 3,
  },
  timelineLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  timelineLabel: {
    color: appTheme.color.textSecondary,
    fontSize: 10,
  },
  actionRow: {
    flexDirection: 'row',
    gap: appTheme.spacing.sm,
    marginTop: appTheme.spacing.md,
    alignItems: 'center',
  },
  actionPrimary: {
    flex: 1,
  },
  actionSecondary: {
    minHeight: componentMetrics.primaryButtonHeight,
    borderRadius: appTheme.radius.md,
    borderWidth: 1,
    borderColor: appTheme.color.borderDefault,
    backgroundColor: appTheme.color.bgSurface,
    paddingHorizontal: appTheme.spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionSecondaryDisabled: {
    opacity: 0.5,
  },
  actionSecondaryText: {
    color: appTheme.color.textPrimary,
    fontSize: appTheme.typography.size.sm,
    fontWeight: '600',
  },
  reportHint: {
    marginTop: appTheme.spacing.xs,
    color: appTheme.color.textSecondary,
    fontSize: appTheme.typography.size.xs,
  },
});
