import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Image, Modal, Pressable, RefreshControl, SectionList, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { collection, getDocs, limit, orderBy, query } from 'firebase/firestore';
import { auth, db } from '../config/firebase';
import { appTheme, componentMetrics } from '../theme/tokens';
import { getReportTrustLabel, getReportVoteMeta, loadUserReportVotes, toggleReportVote } from '../utils/reportVotes';

const BUSY_TAGS = ['Full', 'Busy', 'Moderate', 'Available', 'Empty'];
const ONE_HR = 60 * 60 * 1000;
const LIKE_VALUE = 1;
const DISLIKE_VALUE = -1;
const REPORTS_HISTORY_LIMIT = 200;
const REPORT_CARD_MEDIA_HEIGHT = 86;

const toTimestampMs = (value) => {
  if (value == null) return 0;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value instanceof Date) return value.getTime();
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (typeof value?.seconds === 'number') {
    return value.seconds * 1000 + Math.floor((value.nanoseconds || 0) / 1e6);
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

const fmtDate = (ts) => {
  if (!ts) return '';
  const d = new Date(toTimestampMs(ts));
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const getReportCreatedAt = (report) => report?.createdAt ?? report?.clientCreatedAt ?? null;

const getReportImageUri = (report) => report?.photoUrl || report?.imgUri || null;

const BusyDots = ({ lvl, compact = false }) => (
  <View style={[st.dotsRow, compact && st.dotsRowCompact]}>
    {[1, 2, 3, 4, 5].map((v) => (
      <View key={v} style={[st.dot, v <= lvl && st.dotFill]} />
    ))}
    <Text style={[st.dotLbl, compact && st.dotLblCompact]}>{BUSY_TAGS[lvl - 1]}</Text>
  </View>
);

export default function HistoryScreen() {
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [bigImg, setBigImg] = useState(null);
  const [userVotes, setUserVotes] = useState({});
  const [pendingVotes, setPendingVotes] = useState({});
  const currentUser = auth.currentUser;

  const pull = useCallback(async () => {
    try {
      const reportsQuery = query(
        collection(db, 'reports'),
        orderBy('createdAt', 'desc'),
        limit(REPORTS_HISTORY_LIMIT)
      );
      const [snap, voteMap] = await Promise.all([
        getDocs(reportsQuery),
        loadUserReportVotes(currentUser?.uid),
      ]);
      const rows = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => toTimestampMs(getReportCreatedAt(b)) - toTimestampMs(getReportCreatedAt(a)));
      setItems(rows);
      setUserVotes(voteMap);
    } catch (_e) {
      setItems([]);
      setUserVotes({});
    } finally {
      setBusy(false);
    }
  }, [currentUser?.uid]);

  useEffect(() => { pull(); }, [pull]);

  const sections = useMemo(() => {
    const cutoff = Date.now() - ONE_HR;
    const recent = items.filter((r) => toTimestampMs(getReportCreatedAt(r)) > cutoff);
    const past = items.filter((r) => toTimestampMs(getReportCreatedAt(r)) <= cutoff);
    const out = [];
    if (recent.length > 0) out.push({ title: 'Recent (Active)', data: recent });
    if (past.length > 0) out.push({ title: 'Past', data: past });
    return out;
  }, [items]);

  const handleVote = async (item, nextValue) => {
    if (!currentUser) {
      Alert.alert('Sign in required', 'Please sign in to vote on community reports.');
      return;
    }

    if (item.userId === currentUser.uid) {
      return;
    }

    if (pendingVotes[item.id]) {
      return;
    }

    setPendingVotes((prev) => ({ ...prev, [item.id]: true }));

    try {
      const result = await toggleReportVote({
        reportId: item.id,
        reportOwnerId: item.userId,
        nextValue,
        userId: currentUser.uid,
      });

      setUserVotes((prev) => ({
        ...prev,
        [item.id]: result.currentVote,
      }));
      setItems((prev) =>
        prev.map((entry) =>
          entry.id === item.id
            ? {
              ...entry,
              upvoteCount: result.upvoteCount,
              downvoteCount: result.downvoteCount,
              voteScore: result.voteScore,
              voteWeightMultiplier: result.voteWeightMultiplier,
              voteUpdatedAt: result.voteUpdatedAt,
            }
            : entry
        )
      );
    } catch (error) {
      if (error?.message === 'self_vote_forbidden') {
        Alert.alert('Vote unavailable', 'You cannot vote on your own report.');
      } else {
        Alert.alert('Vote failed', 'Could not update your vote right now.');
      }
    } finally {
      setPendingVotes((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
    }
  };

  const row = ({ item }) => {
    const voteMeta = getReportVoteMeta(item);
    const currentVote = userVotes[item.id] || 0;
    const trustLabel = getReportTrustLabel(item);
    const votingDisabled = !currentUser || item.userId === currentUser?.uid || pendingVotes[item.id];
    const imageUri = getReportImageUri(item);
    const voteControls = (
      <View style={[st.voteRow, !imageUri && st.voteRowCompact]}>
        <Pressable
          accessibilityLabel="Like report"
          accessibilityRole="button"
          disabled={votingDisabled}
          onPress={() => handleVote(item, LIKE_VALUE)}
          style={[
            st.voteBtn,
            !imageUri && st.voteBtnCompact,
            currentVote === LIKE_VALUE && st.voteBtnLiked,
            votingDisabled && st.voteBtnDisabled,
          ]}
        >
          <Ionicons
            color={currentVote === LIKE_VALUE ? appTheme.color.bgCanvas : appTheme.color.textSecondary}
            name={currentVote === LIKE_VALUE ? 'thumbs-up' : 'thumbs-up-outline'}
            size={14}
          />
          <Text
            style={[
              st.voteTxt,
              currentVote === LIKE_VALUE && st.voteTxtActive,
            ]}
          >
            {voteMeta.upvoteCount}
          </Text>
        </Pressable>

        <Pressable
          accessibilityLabel="Dislike report"
          accessibilityRole="button"
          disabled={votingDisabled}
          onPress={() => handleVote(item, DISLIKE_VALUE)}
          style={[
            st.voteBtn,
            !imageUri && st.voteBtnCompact,
            currentVote === DISLIKE_VALUE && st.voteBtnDisliked,
            votingDisabled && st.voteBtnDisabled,
          ]}
        >
          <Ionicons
            color={currentVote === DISLIKE_VALUE ? '#FFFFFF' : appTheme.color.textSecondary}
            name={currentVote === DISLIKE_VALUE ? 'thumbs-down' : 'thumbs-down-outline'}
            size={14}
          />
          <Text
            style={[
              st.voteTxt,
              currentVote === DISLIKE_VALUE && st.voteTxtDisliked,
            ]}
          >
            {voteMeta.downvoteCount}
          </Text>
        </Pressable>

        {trustLabel ? <Text style={[st.trustTag, !imageUri && st.trustTagCompact]}>{trustLabel}</Text> : null}
      </View>
    );

    return (
      <View style={st.card}>
        <View style={[st.cardInner, !imageUri && st.cardInnerNoPhoto]}>
          <View style={[st.cardMain, !imageUri && st.cardMainNoPhoto]}>
            <Text style={[st.lotTxt, !imageUri && st.lotTxtNoPhoto]}>{item.lotName || item.lotId}</Text>
            <Text style={[st.dateTxt, !imageUri && st.dateTxtNoPhoto]}>{fmtDate(getReportCreatedAt(item))}</Text>
            {imageUri ? <BusyDots lvl={item.rating} /> : null}
            {imageUri ? voteControls : null}
          </View>
          {!imageUri ? (
            <View style={st.cardSide}>
              <BusyDots compact lvl={item.rating} />
              {voteControls}
            </View>
          ) : null}
        </View>
        {imageUri ? (
          <Pressable onPress={() => setBigImg(imageUri)}>
            <Image source={{ uri: imageUri }} style={st.thumb} />
          </Pressable>
        ) : null}
      </View>
    );
  };

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
    minHeight: REPORT_CARD_MEDIA_HEIGHT + appTheme.spacing.sm * 2,
  },
  cardInner: { flex: 1 },
  cardInnerNoPhoto: {
    flexDirection: 'row',
    alignItems: 'stretch',
    justifyContent: 'space-between',
    gap: appTheme.spacing.md,
  },
  cardMain: {
    flex: 1,
    minWidth: 0,
    alignSelf: 'stretch',
    justifyContent: 'flex-start',
  },
  cardMainNoPhoto: {
    justifyContent: 'center',
  },
  cardSide: {
    width: 138,
    alignItems: 'flex-end',
    alignSelf: 'stretch',
    justifyContent: 'center',
    gap: appTheme.spacing.sm,
  },
  lotTxt: {
    color: appTheme.color.textPrimary,
    fontSize: appTheme.typography.size.md,
    fontWeight: '700',
  },
  lotTxtNoPhoto: {
    marginBottom: 6,
    lineHeight: 22,
  },
  dateTxt: {
    color: appTheme.color.textSecondary,
    fontSize: appTheme.typography.size.xs,
    marginTop: 2,
    marginBottom: appTheme.spacing.xs,
  },
  dateTxtNoPhoto: {
    marginTop: 0,
    marginBottom: 0,
    lineHeight: 18,
  },
  dotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  dotsRowCompact: {
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
  },
  voteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: appTheme.spacing.sm,
  },
  voteRowCompact: {
    justifyContent: 'flex-end',
    marginTop: 0,
    gap: 6,
  },
  voteBtn: {
    minWidth: 58,
    height: 30,
    borderRadius: 999,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: appTheme.color.borderDefault,
    backgroundColor: appTheme.color.bgElevated,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  voteBtnCompact: {
    minWidth: 54,
    height: 28,
    paddingHorizontal: 8,
  },
  voteBtnLiked: {
    backgroundColor: 'rgba(34, 197, 94, 0.22)',
    borderColor: 'rgba(34, 197, 94, 0.6)',
  },
  voteBtnDisliked: {
    backgroundColor: 'rgba(239, 68, 68, 0.28)',
    borderColor: 'rgba(239, 68, 68, 0.6)',
  },
  voteBtnDisabled: {
    opacity: 0.65,
  },
  voteTxt: {
    color: appTheme.color.textSecondary,
    fontSize: 12,
    fontWeight: '700',
  },
  voteTxtActive: {
    color: appTheme.color.textPrimary,
  },
  voteTxtDisliked: {
    color: '#FFFFFF',
  },
  trustTag: {
    color: appTheme.color.brandGold,
    fontSize: 11,
    fontWeight: '700',
  },
  trustTagCompact: {
    textAlign: 'right',
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
  dotLblCompact: {
    marginLeft: 0,
  },
  thumb: {
    width: 158,
    height: REPORT_CARD_MEDIA_HEIGHT,
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
