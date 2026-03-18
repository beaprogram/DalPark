import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { STATUS_META } from '../../constants/statusStyle';
import { appTheme, componentMetrics } from '../../theme/tokens';
import PrimaryButton from '../common/PrimaryButton';

const formatUpdatedAt = (timestamp) => {
  if (!timestamp) {
    return 'Unknown';
  }
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

export default function LotBottomSheet({ visible, lot, predictedStatus, onClose, onNavigate, onReport }) {
  if (!visible || !lot) {
    return null;
  }

  const status = predictedStatus?.status || lot.lastStatus;
  const statusMeta = STATUS_META[status];
  const dayTotal = (lot.generalSpaces || 0) + (lot.reservedSpaces || 0) + (lot.shortTermSpaces || 0);
  const eveningTotal = (lot.eveningGeneralSpaces || 0) + (lot.eveningShortTermSpaces || 0);
  const pct = (predictedStatus?.score ?? 50) / 100;
  const dayEst = Math.round(dayTotal * pct);
  const eveEst = Math.round(eveningTotal * pct);

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
        <View style={styles.pillMuted}>
          <Text style={styles.pillMutedText}>Updated {formatUpdatedAt(lot.lastStatusAt)}</Text>
        </View>
      </View>

      <View style={styles.infoGrid}>
        <View style={styles.infoItem}>
          <Text style={styles.infoLabel}>Day Total</Text>
          <Text style={styles.infoValue}>~{dayEst}/{dayTotal}</Text>
        </View>
        <View style={styles.infoItem}>
          <Text style={styles.infoLabel}>Evening Total</Text>
          <Text style={styles.infoValue}>~{eveEst}/{eveningTotal}</Text>
        </View>
      </View>

      <Text style={styles.detailLine}>
        General {lot.generalSpaces || 0} · Reserved {lot.reservedSpaces || 0} · Short-term{' '}
        {lot.shortTermSpaces || 0}
      </Text>

      <View style={styles.actionRow}>
        <PrimaryButton accessibilityLabel="Navigate to lot" label="Navigate" onPress={onNavigate} style={styles.actionPrimary} />
        <Pressable accessibilityLabel="Report lot status" onPress={onReport} style={styles.actionSecondary}>
          <Text style={styles.actionSecondaryText}>Report Status</Text>
        </Pressable>
      </View>
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
    marginBottom: appTheme.spacing.md,
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
  actionRow: {
    flexDirection: 'row',
    gap: appTheme.spacing.sm,
    marginTop: appTheme.spacing.md,
    alignItems: 'center',
  },
  detailLine: {
    marginTop: appTheme.spacing.sm,
    color: appTheme.color.textSecondary,
    fontSize: appTheme.typography.size.xs,
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
  actionSecondaryText: {
    color: appTheme.color.textPrimary,
    fontSize: appTheme.typography.size.sm,
    fontWeight: '600',
  },
});
