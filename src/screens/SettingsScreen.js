import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { auth, db } from '../config/firebase';
import { appTheme, componentMetrics } from '../theme/tokens';

export default function SettingsScreen() {
  const [rptCount, setRptCount] = useState(0);

  useEffect(() => {
    if (!auth.currentUser) return;
    const q = query(
      collection(db, 'reports'),
      where('userId', '==', auth.currentUser.uid)
    );
    getDocs(q)
      .then((snap) => setRptCount(snap.size))
      .catch(() => { });
  }, []);

  const user = auth.currentUser;

  return (
    <View style={styles.container}>
      <Text style={styles.header}>Settings</Text>

      <View style={styles.card}>
        <Ionicons name="person-circle-outline" size={40} color={appTheme.color.brandGold} />
        <View style={styles.userInfo}>
          <Text style={styles.email}>{user?.email || 'Not logged in'}</Text>
          <Text style={styles.meta}>{rptCount} report{rptCount !== 1 ? 's' : ''} submitted</Text>
        </View>
      </View>

      <Pressable
        onPress={() => auth.signOut()}
        style={({ pressed }) => [styles.logoutBtn, pressed && styles.logoutPressed]}
      >
        <Ionicons name="log-out-outline" size={20} color="coral" />
        <Text style={styles.logoutText}>Log Out</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: appTheme.color.bgCanvas,
    paddingTop: 60,
    paddingHorizontal: componentMetrics.horizontalPadding,
  },
  header: {
    color: appTheme.color.textPrimary,
    fontSize: appTheme.typography.size.xl,
    fontWeight: '700',
    marginBottom: appTheme.spacing.lg,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: appTheme.color.bgSurface,
    borderRadius: appTheme.radius.md,
    borderWidth: 1,
    borderColor: appTheme.color.borderDefault,
    padding: appTheme.spacing.md,
    gap: appTheme.spacing.md,
    marginBottom: appTheme.spacing.lg,
  },
  userInfo: {
    flex: 1,
  },
  email: {
    color: appTheme.color.textPrimary,
    fontSize: appTheme.typography.size.md,
    fontWeight: '600',
  },
  meta: {
    color: appTheme.color.textSecondary,
    fontSize: appTheme.typography.size.sm,
    marginTop: 2,
  },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: appTheme.spacing.sm,
    backgroundColor: appTheme.color.bgSurface,
    borderRadius: appTheme.radius.md,
    borderWidth: 1,
    padding: appTheme.spacing.md,
  },
  logoutPressed: {
    opacity: 0.8,
  },
  logoutText: {
    color: "coral",
    fontSize: appTheme.typography.size.md,
    fontWeight: '600',
  },
});