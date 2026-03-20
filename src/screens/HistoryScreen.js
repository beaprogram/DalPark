import React, { useEffect, useMemo, useState } from 'react';
import { Image, Modal, Pressable, RefreshControl, SectionList, StyleSheet, Text, View } from 'react-native';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../config/firebase';
import { appTheme, componentMetrics } from '../theme/tokens';

const BUSY_TAGS = ['Full', 'Busy', 'Moderate', 'Available', 'Empty'];
const ONE_HR = 60 * 60 * 1000;

const fmtDate = (ts) => {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const BusyDots = ({ lvl }) => (
  <View style={st.dotsRow}>
    {[1, 2, 3, 4, 5].map((v) => (
      <View key={v} style={[st.dot, v <= lvl && st.dotFill]} />
    ))}
    <Text style={st.dotLbl}>{BUSY_TAGS[lvl - 1]}</Text>
  </View>
);

export default function HistoryScreen() {
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [bigImg, setBigImg] = useState(null);

  useEffect(() => { pull(); }, []);

  const pull = async () => {
    try {
      const snap = await getDocs(collection(db, 'reports'));
      const rows = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      setItems(rows);
    } catch (_e) {
      setItems([]);
    } finally {
      setBusy(false);
    }
  };

  const sections = useMemo(() => {
    const cutoff = Date.now() - ONE_HR;
    const recent = items.filter((r) => r.createdAt > cutoff);
    const past = items.filter((r) => r.createdAt <= cutoff);
    const out = [];
    if (recent.length > 0) out.push({ title: 'Recent (Active)', data: recent });
    if (past.length > 0) out.push({ title: 'Past', data: past });
    return out;
  }, [items]);

  const row = ({ item }) => (
    <View style={st.card}>
      <View style={st.cardInner}>
        <Text style={st.lotTxt}>{item.lotName || item.lotId}</Text>
        <Text style={st.dateTxt}>{fmtDate(item.createdAt)}</Text>
        <BusyDots lvl={item.rating} />
      </View>
      {item.imgUri ? (
        <Pressable onPress={() => setBigImg(item.imgUri)}>
          <Image source={{ uri: item.imgUri }} style={st.thumb} />
        </Pressable>
      ) : null}
    </View>
  );

  if (busy) {
    return (
      <View style={st.wrap}>
        <Text style={st.noDataTxt}>Loading reports...</Text>
      </View>
    );
  }

  return (
    <View style={st.wrap}>
      <Text style={st.heading}>Community Reports</Text>
      {items.length === 0 ? (
        <View style={st.noData}>
          <Text style={st.noDataTxt}>No reports yet.</Text>
          <Text style={st.noDataSub}>
            Go to the map, pick a lot, and tap "Report Status" to submit your first one.
          </Text>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(i) => i.id}
          renderItem={row}
          renderSectionHeader={({ section }) => (
            <Text style={st.sectionHdr}>{section.title}</Text>
          )}
          contentContainerStyle={st.feed}
          showsVerticalScrollIndicator={false}
          stickySectionHeadersEnabled={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={async () => {
                setRefreshing(true);
                await pull();
                setRefreshing(false);
              }}
              tintColor={appTheme.color.brandGold}
              colors={[appTheme.color.brandGold]}
            />
          }
        />
      )}

      <Modal
        visible={!!bigImg}
        transparent
        animationType="fade"
        onRequestClose={() => setBigImg(null)}
      >
        <Pressable style={st.imgOverlay} onPress={() => setBigImg(null)}>
          {bigImg && <Image source={{ uri: bigImg }} style={st.bigImg} resizeMode="contain" />}
        </Pressable>
      </Modal>
    </View>
  );
}

const st = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: appTheme.color.bgCanvas,
    paddingTop: 60,
  },
  heading: {
    color: appTheme.color.textPrimary,
    fontSize: appTheme.typography.size.xl,
    fontWeight: '700',
    paddingHorizontal: componentMetrics.horizontalPadding,
    marginBottom: appTheme.spacing.md,
  },
  feed: {
    paddingHorizontal: componentMetrics.horizontalPadding,
    paddingBottom: 20,
  },
  sectionHdr: {
    color: appTheme.color.brandGold,
    fontSize: appTheme.typography.size.sm,
    fontWeight: '700',
    marginTop: appTheme.spacing.md,
    marginBottom: appTheme.spacing.xs,
  },
  card: {
    flexDirection: 'row',
    backgroundColor: appTheme.color.bgSurface,
    borderRadius: appTheme.radius.md,
    borderWidth: 1,
    borderColor: appTheme.color.borderDefault,
    padding: appTheme.spacing.sm,
    marginBottom: appTheme.spacing.sm,
  },
  cardInner: { flex: 1 },
  lotTxt: {
    color: appTheme.color.textPrimary,
    fontSize: appTheme.typography.size.md,
    fontWeight: '700',
  },
  dateTxt: {
    color: appTheme.color.textSecondary,
    fontSize: appTheme.typography.size.xs,
    marginTop: 2,
    marginBottom: appTheme.spacing.xs,
  },
  dotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: appTheme.color.bgElevated,
    borderWidth: 1,
    borderColor: appTheme.color.borderDefault,
  },
  dotFill: {
    backgroundColor: appTheme.color.brandGold,
    borderColor: appTheme.color.brandGold,
  },
  dotLbl: {
    color: appTheme.color.textSecondary,
    fontSize: 11,
    marginLeft: 4,
  },
  thumb: {
    width: 70,
    height: 70,
    borderRadius: appTheme.radius.sm,
    marginLeft: appTheme.spacing.sm,
  },
  noData: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: componentMetrics.horizontalPadding,
  },
  noDataTxt: {
    color: appTheme.color.textSecondary,
    fontSize: appTheme.typography.size.md,
    textAlign: 'center',
  },
  noDataSub: {
    color: appTheme.color.textSecondary,
    fontSize: appTheme.typography.size.sm,
    textAlign: 'center',
    marginTop: appTheme.spacing.xs,
  },
  imgOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.9)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  bigImg: {
    width: '90%',
    height: '70%',
  },
});
