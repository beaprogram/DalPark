import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated, PanResponder, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import MapView, { Circle, Marker, Polygon } from 'react-native-maps';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { STATUS_META } from '../constants/statusStyle';
import { db } from '../config/firebase';
import {
  ACADEMIC_CALENDAR_SIGNALS,
  CAMPUS_LOAD_BUCKETS,
} from '../data/officialPredictionSignals';
import { appTheme, componentMetrics } from '../theme/tokens';
import LotBottomSheet from '../components/map/LotBottomSheet';
import { subscribeLots } from '../utils/lotsFirestore';
import { openNavigationToCoordinate } from '../utils/navigation';
import {
  loadMapPreferences,
  saveLotListVisible,
  saveMapRegion,
  saveSearchQuery,
  saveSelectedLotId,
} from '../utils/mapPreferencesStorage';
import { fetchParkingZones } from '../utils/hrmApi';
import { predictAvailability } from '../utils/engine';
import { resolveAcademicDayType, resolvePredictionSignals } from '../utils/predictionSignals';
import ReportModal from '../components/map/ReportModal';

const INITIAL_REGION = {
  latitude: 44.648,
  longitude: -63.575,
  latitudeDelta: 0.06,
  longitudeDelta: 0.05,
};

const WEATHER_FALLBACK_COORDINATE = {
  latitude: 44.6488,
  longitude: -63.5752,
};
const REPORT_DISTANCE_LIMIT_METERS = 30;
const RECENT_REPORT_WINDOW_MS = 120 * 60 * 1000;
const REPORT_HISTORY_WINDOW_MS = 42 * 24 * 60 * 60 * 1000;
const REPORT_FUTURE_TOLERANCE_MS = 5 * 60 * 1000;
const PREDICTION_TICK_MS = 60 * 1000;
const REPORTS_SUBSCRIPTION_LIMIT = 1000;
const RECOMMENDATION_DISTANCE_WEIGHT = 0.45;
const RECOMMENDATION_AVAILABILITY_WEIGHT = 0.45;
const RECOMMENDATION_CONVENIENCE_WEIGHT = 0.1;
const LOT_LIST_BASE_MAX_HEIGHT = 420;
const LOT_LIST_WITH_SHEET_MAX_HEIGHT = 184;
const LOT_LIST_WITH_SHEET_SMALL_MAX_HEIGHT = 128;
const SMALL_SCREEN_HEIGHT_THRESHOLD = 860;
const SMALL_SCREEN_WIDTH_THRESHOLD = 400;
const ISO_WITH_TIMEZONE_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+\-]\d{2}:\d{2})$/;

// Map open-meteo weather code into short UI text + icon.
const mapWeatherCode = (code) => {
  if (code === 0) {
    return { text: 'Clear', icon: 'sunny-outline' };
  }
  if (code === 1 || code === 2) {
    return { text: 'Partly Cloudy', icon: 'partly-sunny-outline' };
  }
  if (code === 3) {
    return { text: 'Cloudy', icon: 'cloudy-outline' };
  }
  if (code === 45 || code === 48) {
    return { text: 'Fog', icon: 'cloudy-outline' };
  }
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) {
    return { text: 'Rain', icon: 'rainy-outline' };
  }
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) {
    return { text: 'Snow', icon: 'snow-outline' };
  }
  if (code >= 95) {
    return { text: 'Thunderstorm', icon: 'thunderstorm-outline' };
  }
  return { text: 'Weather', icon: 'partly-sunny-outline' };
};

const toRadians = (value) => (value * Math.PI) / 180;

// Small haversine helper, good enough for nearby lot sorting.
const distanceMeters = (from, to) => {
  const earthRadiusMeters = 6371000;
  const dLat = toRadians(to.latitude - from.latitude);
  const dLon = toRadians(to.longitude - from.longitude);
  const lat1 = toRadians(from.latitude);
  const lat2 = toRadians(to.latitude);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);

  return 2 * earthRadiusMeters * Math.asin(Math.sqrt(a));
};

const STATUS_FALLBACK_SCORE = {
  EMPTY: 86,
  NORMAL: 64,
  CROWDED: 42,
  ALMOST_FULL: 22,
  FULL: 8,
  UNKNOWN: 50,
};

const clampToRange = (value, min, max) => Math.max(min, Math.min(max, value));

const getLotRecommendationCapacity = (lot) => {
  const daytimeCapacity =
    Number(lot?.generalSpaces || 0) +
    Number(lot?.shortTermSpaces || 0) +
    Number(lot?.reservedSpaces || 0) * 0.35;
  const eveningCapacity =
    Number(lot?.eveningGeneralSpaces || 0) +
    Number(lot?.eveningShortTermSpaces || 0);

  return Math.max(0, daytimeCapacity, eveningCapacity);
};

const getDistanceScore = (distance) => {
  if (!Number.isFinite(distance)) {
    return 0;
  }

  if (distance <= 80) {
    return 100;
  }

  if (distance <= 250) {
    return Math.round(100 - ((distance - 80) / 170) * 28);
  }

  if (distance <= 650) {
    return Math.round(72 - ((distance - 250) / 400) * 42);
  }

  if (distance <= 1200) {
    return Math.round(30 - ((distance - 650) / 550) * 30);
  }

  return 0;
};

const getAvailabilityScore = (prediction, lot) => {
  if (typeof prediction?.score === 'number' && Number.isFinite(prediction.score)) {
    return clampToRange(Math.round(prediction.score), 0, 100);
  }

  return STATUS_FALLBACK_SCORE[lot?.lastStatus] ?? STATUS_FALLBACK_SCORE.UNKNOWN;
};

const getConvenienceScore = (lot) => {
  const recommendationCapacity = getLotRecommendationCapacity(lot);
  return clampToRange(Math.round((recommendationCapacity / 140) * 100), 18, 100);
};

const getRecommendationScore = ({ distance, availabilityScore, convenienceScore }) =>
  Math.round(
    getDistanceScore(distance) * RECOMMENDATION_DISTANCE_WEIGHT +
      availabilityScore * RECOMMENDATION_AVAILABILITY_WEIGHT +
      convenienceScore * RECOMMENDATION_CONVENIENCE_WEIGHT
  );

const toTimestampMs = (value) => {
  if (value == null) {
    return null;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (value instanceof Date) {
    return value.getTime();
  }

  if (typeof value?.toMillis === 'function') {
    return value.toMillis();
  }

  if (typeof value?.seconds === 'number') {
    return value.seconds * 1000 + Math.floor((value.nanoseconds || 0) / 1e6);
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^\d{10,13}$/.test(trimmed)) {
      const numericTimestamp = Number(trimmed);
      return trimmed.length === 10 ? numericTimestamp * 1000 : numericTimestamp;
    }

    if (!ISO_WITH_TIMEZONE_RE.test(trimmed)) {
      return null;
    }

    const parsed = Date.parse(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
};

const getReportTimestampMs = (report) =>
  toTimestampMs(report?.createdAt) ?? toTimestampMs(report?.clientCreatedAt);

const reportFingerprint = (report) => {
  const createdAt = getReportTimestampMs(report) ?? 'no-time';
  return [
    report?.lotId || 'no-lot',
    report?.userId || 'no-user',
    report?.rating || 'no-rating',
    createdAt,
    report?.photoUrl || report?.photoPath || report?.imgUri || '',
  ].join('::');
};

const groupReportsByLot = (reports, nowMs) => {
  const groupedReports = {};

  reports.forEach((report) => {
    const createdAt = getReportTimestampMs(report);
    if (!createdAt) {
      return;
    }

    const ageMs = nowMs - createdAt;
    if (ageMs < -REPORT_FUTURE_TOLERANCE_MS || ageMs > REPORT_HISTORY_WINDOW_MS || !report?.lotId) {
      return;
    }

    const normalizedReport = { ...report, createdAt };
    if (!groupedReports[report.lotId]) {
      groupedReports[report.lotId] = [];
    }

    groupedReports[report.lotId].push(normalizedReport);
  });

  Object.values(groupedReports).forEach((lotReports) => {
    lotReports.sort((left, right) => (right.createdAt || 0) - (left.createdAt || 0));
  });

  return groupedReports;
};

const mergeReportsForPrediction = (remoteReports = [], localReport, nowMs) => {
  const mergedReports = [...remoteReports];
  if (localReport) {
    mergedReports.unshift({
      ...localReport,
      createdAt: getReportTimestampMs(localReport) ?? localReport.createdAt,
    });
  }

  const seenReports = new Set();
  return mergedReports
    .filter((report) => {
      const createdAt = getReportTimestampMs(report);
      if (!createdAt) {
        return false;
      }

      const ageMs = nowMs - createdAt;
      if (ageMs < -REPORT_FUTURE_TOLERANCE_MS || ageMs > REPORT_HISTORY_WINDOW_MS) {
        return false;
      }

      const fingerprint = reportFingerprint({ ...report, createdAt });
      if (seenReports.has(fingerprint)) {
        return false;
      }

      seenReports.add(fingerprint);
      return true;
    })
    .sort((left, right) => (getReportTimestampMs(right) || 0) - (getReportTimestampMs(left) || 0));
};

const getReportPhotoUri = (report) =>
  report?.photoUrl || report?.imageUrl || report?.imgUri || null;

const enrichReportsForPrediction = (reports, lot, calendarSignals) =>
  reports.map((report) => {
    const reportTimestamp = getReportTimestampMs(report);
    if (!reportTimestamp) {
      return report;
    }

    return {
      ...report,
      createdAt: reportTimestamp,
      derivedAcademicDayType: resolveAcademicDayType({
        date: new Date(reportTimestamp),
        lot,
        calendarSignals,
      }),
    };
  });

export default function MapScreen() {
  const insets = useSafeAreaInsets();
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const mapRef = useRef(null);
  const hasHydratedPreferences = useRef(false);
  const [lots, setLots] = useState([]);
  const [selectedLot, setSelectedLot] = useState(null);
  const [restoredSelectedLotId, setRestoredSelectedLotId] = useState(null);
  const [mapRegion, setMapRegion] = useState(INITIAL_REGION);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLotListVisible, setIsLotListVisible] = useState(true);
  const [userCoordinate, setUserCoordinate] = useState(null);
  const [parkingZones, setParkingZones] = useState([]);
  const [weatherCode, setWeatherCode] = useState(null);
  const [reportModalVisible, setReportModalVisible] = useState(false);
  const [crowdsourceReports, setCrowdsourceReports] = useState({});
  const [predictionNowMs, setPredictionNowMs] = useState(Date.now());
  const [remoteReports, setRemoteReports] = useState([]);
  const [calendarSignals, setCalendarSignals] = useState(ACADEMIC_CALENDAR_SIGNALS);
  const [campusLoadBuckets, setCampusLoadBuckets] = useState(CAMPUS_LOAD_BUCKETS);
  const sheetMaxHeight = Math.min(windowHeight * 0.58, 480);
  const sheetPeekHeight = Math.min(windowHeight * 0.5, 25);
  const sheetMaxOffset = Math.max(sheetMaxHeight - sheetPeekHeight, 0);
  const sheetHiddenOffset = sheetMaxHeight + 40;
  const lotListAnimation = useRef(new Animated.Value(1)).current;
  const sheetTranslateY = useRef(new Animated.Value(sheetHiddenOffset)).current;
  const sheetDragStartRef = useRef(sheetHiddenOffset);
  const pendingSheetOffsetRef = useRef(null);
  const predictionDisplayScoresRef = useRef({});
  const [weather, setWeather] = useState({
    label: 'Loading weather...',
    icon: 'cloudy-outline',
    temperature: '--',
  });
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const isSmallPhoneScreen =
    windowWidth <= SMALL_SCREEN_WIDTH_THRESHOLD || windowHeight <= SMALL_SCREEN_HEIGHT_THRESHOLD;
  const lotListMaxHeight = !selectedLot
    ? LOT_LIST_BASE_MAX_HEIGHT
    : isSmallPhoneScreen
      ? LOT_LIST_WITH_SHEET_SMALL_MAX_HEIGHT
      : LOT_LIST_WITH_SHEET_MAX_HEIGHT;

  useEffect(() => {
    // Lots now come from Firestore with local fallback in service.
    const unsubscribe = subscribeLots((nextLots) => {
      setLots(nextLots);
      setSelectedLot((currentLot) => {
        if (!currentLot) {
          return currentLot;
        }
        return nextLots.find((lot) => lot.id === currentLot.id) || null;
      });
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      setPredictionNowMs(Date.now());
    }, PREDICTION_TICK_MS);

    return () => {
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const reportsQuery = query(
      collection(db, 'reports'),
      orderBy('clientCreatedAt', 'desc'),
      limit(REPORTS_SUBSCRIPTION_LIMIT)
    );

    return onSnapshot(
      reportsQuery,
      (snapshot) => {
        const nextReports = snapshot.docs.map((docSnapshot) => ({
          id: docSnapshot.id,
          ...docSnapshot.data(),
        }));
        setRemoteReports(nextReports);
      },
      () => {
        setRemoteReports([]);
      }
    );
  }, []);

  useEffect(() => {
    const unsubscribeCalendar = onSnapshot(
      collection(db, 'calendarSignals'),
      (snapshot) => {
        if (snapshot.empty) {
          setCalendarSignals(ACADEMIC_CALENDAR_SIGNALS);
          return;
        }

        setCalendarSignals(snapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() })));
      },
      () => {
        setCalendarSignals(ACADEMIC_CALENDAR_SIGNALS);
      }
    );

    const unsubscribeCampusLoad = onSnapshot(
      collection(db, 'campusLoadBuckets'),
      (snapshot) => {
        if (snapshot.empty) {
          setCampusLoadBuckets(CAMPUS_LOAD_BUCKETS);
          return;
        }

        setCampusLoadBuckets(
          snapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
        );
      },
      () => {
        setCampusLoadBuckets(CAMPUS_LOAD_BUCKETS);
      }
    );

    return () => {
      unsubscribeCalendar();
      unsubscribeCampusLoad();
    };
  }, []);

  useEffect(() => {
    // Restore the last map state on app open.
    let isActive = true;

    const hydratePreferences = async () => {
      const preferences = await loadMapPreferences();
      if (!isActive) {
        return;
      }

      if (preferences.mapRegion) {
        setMapRegion(preferences.mapRegion);
        requestAnimationFrame(() => {
          mapRef.current?.animateToRegion(preferences.mapRegion, 0);
        });
      }

      if (preferences.searchQuery) {
        setSearchQuery(preferences.searchQuery);
      }

      if (typeof preferences.lotListVisible === 'boolean') {
        setIsLotListVisible(preferences.lotListVisible);
      }

      if (preferences.selectedLotId) {
        setRestoredSelectedLotId(preferences.selectedLotId);
      }

      hasHydratedPreferences.current = true;
    };

    void hydratePreferences();

    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    if (!restoredSelectedLotId || lots.length === 0) {
      return;
    }

    const restoredLot = lots.find((lot) => lot.id === restoredSelectedLotId) || null;
    setSelectedLot(restoredLot);
    setRestoredSelectedLotId(null);
  }, [lots, restoredSelectedLotId]);

  const selectedLotDistanceMeters = useMemo(() => {
    if (!selectedLot || !userCoordinate) {
      return null;
    }
    return distanceMeters(userCoordinate, selectedLot.coordinate);
  }, [selectedLot, userCoordinate]);

  const nearestLot = useMemo(() => {
    if (!userCoordinate || lots.length === 0) {
      return null;
    }

    return lots.reduce((currentNearest, lot) => {
      if (!currentNearest) {
        return lot;
      }

      const currentDistance = distanceMeters(userCoordinate, currentNearest.coordinate);
      const nextDistance = distanceMeters(userCoordinate, lot.coordinate);
      return nextDistance < currentDistance ? lot : currentNearest;
    }, null);
  }, [userCoordinate, lots]);

  const canReportSelectedLot =
    selectedLotDistanceMeters !== null && selectedLotDistanceMeters <= REPORT_DISTANCE_LIMIT_METERS;

  const reportDisabledMessage = useMemo(() => {
    if (!selectedLot) {
      return '';
    }
    if (!userCoordinate) {
      return 'Enable location to report.';
    }
    if (selectedLotDistanceMeters === null) {
      return '';
    }
    if (selectedLotDistanceMeters > REPORT_DISTANCE_LIMIT_METERS) {
      return `Get closer to report (${Math.round(selectedLotDistanceMeters)}m away).`;
    }
    return '';
  }, [selectedLot, userCoordinate, selectedLotDistanceMeters]);

  const zoomDelta = Math.max(mapRegion.latitudeDelta, mapRegion.longitudeDelta);
  // Keep map clean when zoomed out. Show labels only when zoomed out enough.
  const hideParkingMarkersWhenZoomedOut = zoomDelta > 0.022;
  const showZoneLabels = zoomDelta >= 0.028;

  const firestoreReportsByLot = useMemo(
    () => groupReportsByLot(remoteReports, predictionNowMs),
    [remoteReports, predictionNowMs]
  );

  const lotPredictions = useMemo(() => {
    const predictions = {};
    const engineUpdatedAt = predictionNowMs;
    const predictionDate = new Date(predictionNowMs);

    lots.forEach((lot) => {
      const mergedReports = mergeReportsForPrediction(
        firestoreReportsByLot[lot.id] || [],
        crowdsourceReports[lot.id],
        predictionNowMs
      );
      const reportsForLot = enrichReportsForPrediction(mergedReports, lot, calendarSignals);
      const signalContext = resolvePredictionSignals({
        date: predictionDate,
        lot,
        calendarSignals,
        campusLoadBuckets,
      });
      const previousDisplayScore = predictionDisplayScoresRef.current[lot.id] ?? null;
      const prediction = predictAvailability({
        lot,
        weatherCode,
        atDate: predictionDate,
        reports: reportsForLot,
        prevDisplayScore: previousDisplayScore,
        ...signalContext,
      });
      const updatedBy =
        prediction.reportCount > 0 && prediction.latestReportAt ? 'Crowd' : prediction.engineScore != null ? 'Engine' : null;
      const updatedAt = updatedBy === 'Crowd' ? prediction.latestReportAt : updatedBy === 'Engine' ? engineUpdatedAt : null;

      predictions[lot.id] = {
        ...prediction,
        score: prediction.displayScore,
        status: prediction.status,
        updatedAt,
        updatedBy,
        engineScore: prediction.engineScore,
        crowdScore: prediction.crowdScore,
        reportCount: prediction.reportCount,
      };
    });
    return predictions;
  }, [
    lots,
    weatherCode,
    crowdsourceReports,
    predictionNowMs,
    firestoreReportsByLot,
    calendarSignals,
    campusLoadBuckets,
  ]);

  const recommendedLot = useMemo(() => {
    if (!userCoordinate || lots.length === 0) {
      return null;
    }

    return lots.reduce((currentBestLot, lot) => {
      const walkingDistance = distanceMeters(userCoordinate, lot.coordinate);
      const prediction = lotPredictions[lot.id];
      const availabilityScore = getAvailabilityScore(prediction, lot);
      const convenienceScore = getConvenienceScore(lot);
      const recommendationScore = getRecommendationScore({
        distance: walkingDistance,
        availabilityScore,
        convenienceScore,
      });

      const scoredLot = {
        ...lot,
        recommendationDistanceMeters: walkingDistance,
        recommendationAvailabilityScore: availabilityScore,
        recommendationScore,
      };

      if (!currentBestLot) {
        return scoredLot;
      }

      if (scoredLot.recommendationScore !== currentBestLot.recommendationScore) {
        return scoredLot.recommendationScore > currentBestLot.recommendationScore
          ? scoredLot
          : currentBestLot;
      }

      return scoredLot.recommendationDistanceMeters < currentBestLot.recommendationDistanceMeters
        ? scoredLot
        : currentBestLot;
    }, null);
  }, [userCoordinate, lots, lotPredictions]);

  const mostOpenLot = useMemo(() => {
    if (lots.length === 0) {
      return null;
    }

    return lots.reduce((currentMostOpen, lot) => {
      const prediction = lotPredictions[lot.id];
      const availabilityScore = getAvailabilityScore(prediction, lot);
      const walkingDistance = userCoordinate ? distanceMeters(userCoordinate, lot.coordinate) : Number.POSITIVE_INFINITY;
      const scoredLot = {
        ...lot,
        recommendationAvailabilityScore: availabilityScore,
        recommendationDistanceMeters: walkingDistance,
      };

      if (!currentMostOpen) {
        return scoredLot;
      }

      if (scoredLot.recommendationAvailabilityScore !== currentMostOpen.recommendationAvailabilityScore) {
        return scoredLot.recommendationAvailabilityScore > currentMostOpen.recommendationAvailabilityScore
          ? scoredLot
          : currentMostOpen;
      }

      return scoredLot.recommendationDistanceMeters < currentMostOpen.recommendationDistanceMeters
        ? scoredLot
        : currentMostOpen;
    }, null);
  }, [lots, lotPredictions, userCoordinate]);

  const searchableLots = useMemo(() => {
    const sortedLots = [...lots].sort((left, right) => left.name.localeCompare(right.name));
    const filteredLots = normalizedSearchQuery
      ? sortedLots.filter((lot) => {
        const target = `${lot.name} ${lot.address} ${lot.campus}`.toLowerCase();
        return target.includes(normalizedSearchQuery);
      })
      : sortedLots;

    if (!recommendedLot) {
      return filteredLots;
    }

    const nextLots = [...filteredLots];
    const priorityIds = [recommendedLot.id];

    if (nearestLot?.id && nearestLot.id !== recommendedLot.id) {
      priorityIds.push(nearestLot.id);
    }

    if (
      mostOpenLot?.id &&
      mostOpenLot.id !== recommendedLot.id &&
      mostOpenLot.id !== nearestLot?.id
    ) {
      priorityIds.push(mostOpenLot.id);
    }

    priorityIds
      .reverse()
      .forEach((lotId) => {
        const lotIndex = nextLots.findIndex((lot) => lot.id === lotId);
        if (lotIndex > 0) {
          const [lotEntry] = nextLots.splice(lotIndex, 1);
          nextLots.unshift(lotEntry);
        }
      });

    return nextLots;
  }, [lots, nearestLot, recommendedLot, mostOpenLot, normalizedSearchQuery]);

  useEffect(() => {
    const nextDisplayScores = {};
    Object.entries(lotPredictions).forEach(([lotId, prediction]) => {
      if (typeof prediction?.score === 'number') {
        nextDisplayScores[lotId] = prediction.score;
      }
    });
    predictionDisplayScoresRef.current = nextDisplayScores;
  }, [lotPredictions]);

  const selectedLotTimelineScores = useMemo(() => {
    if (!selectedLot) {
      return [];
    }

    const now = new Date(predictionNowMs);
    return Array.from({ length: 24 }, (_, hour) => {
      const targetDate = new Date(now);
      targetDate.setHours(hour, 0, 0, 0);
      const signalContext = resolvePredictionSignals({
        date: targetDate,
        lot: selectedLot,
        calendarSignals,
        campusLoadBuckets,
      });
      return predictAvailability({
        lot: selectedLot,
        weatherCode,
        atDate: targetDate,
        reports: [],
        ...signalContext,
      }).score;
    });
  }, [selectedLot, weatherCode, predictionNowMs, calendarSignals, campusLoadBuckets]);

  const selectedLotLatestPhotoUri = useMemo(() => {
    if (!selectedLot) {
      return null;
    }

    const mergedReports = mergeReportsForPrediction(
      firestoreReportsByLot[selectedLot.id] || [],
      crowdsourceReports[selectedLot.id],
      predictionNowMs
    );

    const latestPhotoReport = mergedReports.find((report) => Boolean(getReportPhotoUri(report)));
    return latestPhotoReport ? getReportPhotoUri(latestPhotoReport) : null;
  }, [selectedLot, firestoreReportsByLot, crowdsourceReports, predictionNowMs]);

  const loadWeather = async () => {
    try {
      // If location permission is denied, still show weather from Halifax fallback.
      let coordinate = WEATHER_FALLBACK_COORDINATE;
      const permission = await Location.requestForegroundPermissionsAsync();

      if (permission.status === 'granted') {
        const currentPosition = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        coordinate = {
          latitude: currentPosition.coords.latitude,
          longitude: currentPosition.coords.longitude,
        };
        setUserCoordinate(coordinate);
      }

      const endpoint = `https://api.open-meteo.com/v1/forecast?latitude=${coordinate.latitude}&longitude=${coordinate.longitude}&current=temperature_2m,weather_code&timezone=auto`;
      const response = await fetch(endpoint);
      if (!response.ok) {
        throw new Error('weather_request_failed');
      }

      const payload = await response.json();
      const temperature = payload?.current?.temperature_2m;
      const weatherCode = payload?.current?.weather_code;
      const weatherMeta = mapWeatherCode(weatherCode);

      const label =
        typeof temperature === 'number'
          ? `${Math.round(temperature)}C - ${weatherMeta.text}`
          : weatherMeta.text;
      const temperatureText = typeof temperature === 'number' ? `${Math.round(temperature)}C` : '--';

      setWeather({ label, icon: weatherMeta.icon, temperature: temperatureText });
      setWeatherCode(weatherCode);
      return true;
    } catch (_error) {
      setWeather({
        label: 'Weather unavailable',
        icon: 'cloudy-outline',
        temperature: '--',
      });
      return false;
    }
  };

  const animateSheetTo = (nextOffset) => {
    sheetDragStartRef.current = nextOffset;
    Animated.spring(sheetTranslateY, {
      toValue: nextOffset,
      useNativeDriver: true,
      damping: 24,
      stiffness: 260,
      mass: 0.9,
    }).start();
  };

  useEffect(() => {
    if (!selectedLot) {
      sheetTranslateY.setValue(sheetHiddenOffset);
      sheetDragStartRef.current = sheetHiddenOffset;
      pendingSheetOffsetRef.current = null;
      return;
    }

    const nextOffset =
      pendingSheetOffsetRef.current === null
        ? 0
        : Math.max(0, Math.min(sheetMaxOffset, pendingSheetOffsetRef.current));

    pendingSheetOffsetRef.current = null;
    animateSheetTo(nextOffset);
  }, [selectedLot, sheetMaxOffset, sheetHiddenOffset, sheetTranslateY]);

  useEffect(() => {
    // Initial weather load.
    loadWeather();
    fetchParkingZones()
      .then(setParkingZones)
      .catch(() => { });
  }, []);

  useEffect(() => {
    if (!hasHydratedPreferences.current) {
      return;
    }

    // Debounce region writes while user is panning.
    const timer = setTimeout(() => {
      void saveMapRegion(mapRegion);
    }, 350);

    return () => {
      clearTimeout(timer);
    };
  }, [mapRegion]);

  useEffect(() => {
    if (!hasHydratedPreferences.current) {
      return;
    }

    // Persist live search text.
    void saveSearchQuery(searchQuery);
  }, [searchQuery]);

  useEffect(() => {
    if (!hasHydratedPreferences.current) {
      return;
    }

    // Remember whether list is expanded or hidden.
    void saveLotListVisible(isLotListVisible);
  }, [isLotListVisible]);

  useEffect(() => {
    Animated.timing(lotListAnimation, {
      toValue: isLotListVisible ? 1 : 0,
      duration: 180,
      useNativeDriver: false,
    }).start();
  }, [isLotListVisible, lotListAnimation]);

  useEffect(() => {
    if (!hasHydratedPreferences.current) {
      return;
    }

    // Keep last selected lot id for next launch.
    void saveSelectedLotId(selectedLot?.id ?? null);
  }, [selectedLot]);

  const handleRefresh = async () => {
    const ok = await loadWeather();
    if (ok) {
      Alert.alert('Refreshed', 'Parking dataset and weather were refreshed.');
      return;
    }
    Alert.alert('Refreshed', 'Parking dataset was refreshed. Weather is currently unavailable.');
  };

  const handleNavigate = async () => {
    if (!selectedLot) {
      return;
    }

    const target = selectedLot.navigationCoordinate || selectedLot.coordinate;
    try {
      const opened = await openNavigationToCoordinate({
        latitude: target.latitude,
        longitude: target.longitude,
        label: selectedLot.name,
      });

      if (!opened) {
        Alert.alert('Navigation Error', 'No map app could be opened on this device.');
      }
    } catch (_error) {
      Alert.alert('Navigation Error', 'Unable to open navigation right now.');
    }
  };

  const handleReport = () => {
    if (!selectedLot) return;
    if (!canReportSelectedLot) return;
    setReportModalVisible(true);
  };

  const handleReported = (reportData) => {
    setCrowdsourceReports((prev) => ({
      ...prev,
      [reportData.lotId]: reportData,
    }));
  };

  const handleCloseSheet = () => {
    pendingSheetOffsetRef.current = null;
    setSelectedLot(null);
  };

  const handleSelectLot = (lot) => {
    // Keep the current sheet height if user switches lots without closing it.
    if (selectedLot?.id && selectedLot.id !== lot.id) {
      sheetTranslateY.stopAnimation((value) => {
        pendingSheetOffsetRef.current = Math.max(0, Math.min(sheetMaxOffset, value));
        setSelectedLot(lot);
      });
    } else {
      pendingSheetOffsetRef.current = null;
      setSelectedLot(lot);
    }

    setIsLotListVisible(false);
    mapRef.current?.animateToRegion(
      {
        latitude: lot.coordinate.latitude,
        longitude: lot.coordinate.longitude,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      },
      320
    );
  };

  const handleGoToRecommended = () => {
    if (!userCoordinate) {
      Alert.alert('Location Required', 'Enable location access to jump to a recommended parking lot.');
      return;
    }

    if (!recommendedLot) {
      Alert.alert('No Lot Found', 'Unable to find a recommended parking lot at the moment.');
      return;
    }

    handleSelectLot(recommendedLot);
  };

  const clearSearchQuery = () => {
    setSearchQuery('');
  };

  const sheetPanResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gestureState) =>
          Boolean(selectedLot) &&
          Math.abs(gestureState.dy) > 6 &&
          Math.abs(gestureState.dy) > Math.abs(gestureState.dx),
        onPanResponderGrant: () => {
          sheetTranslateY.stopAnimation((value) => {
            sheetDragStartRef.current = value;
          });
        },
        onPanResponderMove: (_event, gestureState) => {
          const nextOffset = Math.max(
            0,
            Math.min(sheetMaxOffset, sheetDragStartRef.current + gestureState.dy)
          );
          sheetTranslateY.setValue(nextOffset);
        },
        onPanResponderRelease: (_event, gestureState) => {
          const projectedOffset = Math.max(
            0,
            Math.min(sheetMaxOffset, sheetDragStartRef.current + gestureState.dy)
          );
          animateSheetTo(projectedOffset);
        },
        onPanResponderTerminate: (_event, gestureState) => {
          const projectedOffset = Math.max(
            0,
            Math.min(sheetMaxOffset, sheetDragStartRef.current + gestureState.dy)
          );
          animateSheetTo(projectedOffset);
        },
      }),
    [selectedLot, sheetMaxOffset]
  );

  const lotListAnimatedStyle = {
    height: lotListAnimation.interpolate({
      inputRange: [0, 1],
      outputRange: [0, lotListMaxHeight],
      extrapolate: 'clamp',
    }),
    opacity: lotListAnimation.interpolate({
      inputRange: [0, 1],
      outputRange: [0, 1],
      extrapolate: 'clamp',
    }),
    transform: [
      {
        translateY: lotListAnimation.interpolate({
          inputRange: [0, 1],
          outputRange: [-8, 0],
          extrapolate: 'clamp',
        }),
      },
    ],
  };

  return (
    <View style={styles.container}>
      <MapView
        initialRegion={INITIAL_REGION}
        onRegionChange={setMapRegion}
        onRegionChangeComplete={setMapRegion}
        onPress={() => {
          handleCloseSheet();
          setIsLotListVisible(false);
        }}
        ref={mapRef}
        showsCompass={false}
        showsMyLocationButton={false}
        showsPointsOfInterest={false}
        showsUserLocation
        mapPadding={{
          top: insets.top + 116,
          right: componentMetrics.horizontalPadding,
          bottom: selectedLot ? sheetPeekHeight + 24 : 32,
          left: componentMetrics.horizontalPadding,
        }}
        style={styles.map}
      >
        {parkingZones.map((zone) => (
          <Polygon
            coordinates={zone.polygon}
            fillColor={zone.fillColor}
            key={`zone-${zone.id}`}
            strokeColor={zone.strokeColor}
            strokeWidth={2}
            tappable={false}
            zIndex={1}
          />
        ))}

        {showZoneLabels
          ? parkingZones.map((zone) => (
            <Marker
              anchor={{ x: 0.5, y: 0.5 }}
              coordinate={zone.centroid}
              key={`zone-label-${zone.id}`}
              tracksViewChanges={false}
              tappable={false}
            >
              <View pointerEvents="none" style={styles.campusLabel}>
                <Text style={styles.campusLabelText}>{zone.name}</Text>
              </View>
            </Marker>
          ))
          : null}

        {selectedLot && !hideParkingMarkersWhenZoomedOut ? (
          <Circle
            center={selectedLot.coordinate}
            fillColor="rgba(242, 201, 76, 0.12)"
            radius={34}
            strokeColor="rgba(242, 201, 76, 0.9)"
            strokeWidth={2}
            zIndex={3}
          />
        ) : null}

        {lots.map((lot) => {
          const isSelected = selectedLot?.id === lot.id;
          if (hideParkingMarkersWhenZoomedOut) {
            return null;
          }

          return (
            <Marker
              anchor={{ x: 0.5, y: 1 }}
              coordinate={lot.coordinate}
              identifier={lot.id}
              key={lot.id}
              onPress={(event) => {
                event.stopPropagation?.();
                handleSelectLot(lot);
              }}
              zIndex={5}
            >
              <View
                style={[
                  styles.parkingMarker,
                  isSelected && styles.parkingMarkerSelected,
                  { backgroundColor: STATUS_META[lotPredictions[lot.id]?.status || lot.lastStatus].color },
                ]}
              >
                <MaterialCommunityIcons
                  color="#FFFFFF"
                  name="parking"
                  size={15}
                  style={styles.parkingMarkerIcon}
                />
              </View>
            </Marker>
          );
        })}
      </MapView>

      <View style={[styles.topOverlay, { paddingTop: insets.top + appTheme.spacing.md }]}>
        <View style={styles.searchBarCard}>
          <Ionicons color={appTheme.color.textSecondary} name="search-outline" size={18} />
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setSearchQuery}
            onFocus={() => setIsLotListVisible(true)}
            placeholder="Search parking lot"
            placeholderTextColor={appTheme.color.textSecondary}
            style={styles.searchInput}
            value={searchQuery}
          />
          {searchQuery.length > 0 ? (
            <Pressable
              accessibilityLabel="Clear search"
              accessibilityRole="button"
              hitSlop={6}
              onPress={clearSearchQuery}
              style={({ pressed }) => [styles.searchTrailingButton, pressed && styles.iconButtonPressed]}
            >
              <Ionicons color={appTheme.color.textSecondary} name="close-circle" size={18} />
            </Pressable>
          ) : null}
          <Pressable
            accessibilityLabel="Go to recommended parking lot"
            accessibilityRole="button"
            hitSlop={6}
            onPress={handleGoToRecommended}
            style={({ pressed }) => [styles.searchTrailingButton, pressed && styles.iconButtonPressed]}
          >
            <Ionicons color={appTheme.color.brandGold} name="locate-outline" size={18} />
          </Pressable>
          <Pressable
            accessibilityLabel="Refresh lot status"
            accessibilityRole="button"
            hitSlop={6}
            onPress={handleRefresh}
            style={({ pressed }) => [styles.searchTrailingButton, pressed && styles.iconButtonPressed]}
          >
            <Ionicons color={appTheme.color.textPrimary} name="refresh-outline" size={18} />
          </Pressable>
        </View>

        <View style={styles.topMetaRow}>
          <Pressable
            accessibilityLabel="Toggle parking lot list"
            accessibilityRole="button"
            onPress={() => setIsLotListVisible((currentValue) => !currentValue)}
            style={({ pressed }) => [styles.listToggleChip, pressed && styles.listToggleChipPressed]}
          >
            <Ionicons color={appTheme.color.textPrimary} name="list-outline" size={14} />
            <Text style={styles.listToggleText}>
              {isLotListVisible
                ? `Hide lots`
                : `All lots (${searchableLots.length}/${lots.length})`}
            </Text>
          </Pressable>

          <View style={styles.weatherMiniChip}>
            <Ionicons color={appTheme.color.brandGold} name={weather.icon} size={14} />
            <Text style={styles.weatherMiniText}>{weather.temperature}</Text>
          </View>
        </View>

        <Animated.View
          pointerEvents={isLotListVisible ? 'auto' : 'none'}
          style={[styles.lotListCardWrapper, lotListAnimatedStyle]}
        >
          <View style={[styles.lotListCard, { maxHeight: lotListMaxHeight }]}>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              nestedScrollEnabled
              showsVerticalScrollIndicator={false}
              style={[styles.lotListScroll, { maxHeight: lotListMaxHeight }]}
            >
              {searchableLots.length === 0 ? (
                <Text style={styles.emptyListText}>No parking lot matches your search.</Text>
              ) : (
                searchableLots.map((lot) => (
                  <Pressable
                    key={`search-${lot.id}`}
                    onPress={() => handleSelectLot(lot)}
                    style={({ pressed }) => [styles.lotListItem, pressed && styles.lotListItemPressed]}
                  >
                    <View style={styles.lotListRowHead}>
                      <Text numberOfLines={1} style={styles.lotListName}>
                        {lot.name}
                      </Text>
                      <View style={styles.lotListTagRow}>
                        {recommendedLot?.id === lot.id ? (
                          <View style={[styles.nearestTag, styles.recommendedTag]}>
                            <Text style={[styles.nearestTagText, styles.recommendedTagText]}>Recommended</Text>
                          </View>
                        ) : null}
                        {nearestLot?.id === lot.id ? (
                          <View style={styles.nearestTag}>
                            <Text style={styles.nearestTagText}>Nearest</Text>
                          </View>
                        ) : null}
                        {mostOpenLot?.id === lot.id ? (
                          <View style={[styles.nearestTag, styles.mostOpenTag]}>
                            <Text style={[styles.nearestTagText, styles.mostOpenTagText]}>Most Open</Text>
                          </View>
                        ) : null}
                      </View>
                    </View>
                    <Text numberOfLines={1} style={styles.lotListMeta}>
                      {lot.campus === 'studley' ? 'Studley' : 'Sexton'} Campus | {lot.address}
                    </Text>
                  </Pressable>
                ))
              )}
            </ScrollView>
          </View>
        </Animated.View>
      </View>

      <Animated.View
        pointerEvents={selectedLot ? 'auto' : 'none'}
        style={[
          styles.sheetWrapper,
          {
            height: sheetMaxHeight,
            transform: [
              {
                translateY: sheetTranslateY,
              },
            ],
          },
        ]}
      >
        <LotBottomSheet
          canReport={canReportSelectedLot}
          currentTimeMs={predictionNowMs}
          dragHandleProps={sheetPanResponder.panHandlers}
          latestPhotoUri={selectedLotLatestPhotoUri}
          lot={selectedLot}
          predictedStatus={selectedLot ? lotPredictions[selectedLot.id] : null}
          reportDisabledMessage={reportDisabledMessage}
          scrollEnabled
          timelineScores={selectedLotTimelineScores}
          onClose={handleCloseSheet}
          onNavigate={handleNavigate}
          onReport={handleReport}
          visible={Boolean(selectedLot)}
        />
      </Animated.View>

      <ReportModal
        visible={reportModalVisible}
        lot={selectedLot}
        onClose={() => setReportModalVisible(false)}
        onReported={handleReported}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: appTheme.color.bgCanvas,
  },
  map: {
    ...StyleSheet.absoluteFillObject,
  },
  topOverlay: {
    position: 'absolute',
    left: componentMetrics.horizontalPadding,
    right: componentMetrics.horizontalPadding,
    alignItems: 'stretch',
    gap: appTheme.spacing.xs,
    zIndex: 20,
  },
  searchBarCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(11,20,36,0.78)',
    borderRadius: appTheme.radius.lg,
    borderWidth: 1,
    borderColor: appTheme.color.borderDefault,
    paddingHorizontal: appTheme.spacing.sm,
    height: 50,
    gap: appTheme.spacing.xs,
  },
  searchInput: {
    flex: 1,
    color: appTheme.color.textPrimary,
    fontSize: appTheme.typography.size.md,
    paddingVertical: 0,
  },
  searchTrailingButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconButtonPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.95 }],
  },
  topMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: appTheme.spacing.sm,
  },
  listToggleChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: appTheme.spacing.xs,
    minHeight: 36,
    backgroundColor: 'rgba(11,20,36,0.78)',
    borderRadius: appTheme.radius.lg,
    borderWidth: 1,
    borderColor: appTheme.color.borderDefault,
    paddingHorizontal: appTheme.spacing.sm,
  },
  listToggleChipPressed: {
    opacity: 0.92,
  },
  listToggleText: {
    color: appTheme.color.textPrimary,
    fontSize: appTheme.typography.size.xs,
    fontWeight: '600',
  },
  weatherMiniChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 36,
    paddingHorizontal: appTheme.spacing.sm,
    backgroundColor: 'rgba(11,20,36,0.78)',
    borderRadius: appTheme.radius.lg,
    borderWidth: 1,
    borderColor: appTheme.color.borderDefault,
  },
  weatherMiniText: {
    color: appTheme.color.textPrimary,
    fontSize: appTheme.typography.size.xs,
    fontWeight: '700',
  },
  lotListCardWrapper: {
    overflow: 'hidden',
  },
  lotListCard: {
    maxHeight: 280,
    backgroundColor: 'rgba(11,20,36,0.9)',
    borderRadius: appTheme.radius.lg,
    borderWidth: 1,
    borderColor: appTheme.color.borderDefault,
    overflow: 'hidden',
  },
  lotListScroll: {
    maxHeight: 280,
  },
  lotListItem: {
    paddingHorizontal: appTheme.spacing.md,
    paddingVertical: appTheme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(184,194,209,0.25)',
  },
  lotListItemPressed: {
    backgroundColor: 'rgba(47, 128, 237, 0.16)',
  },
  lotListRowHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: appTheme.spacing.sm,
  },
  lotListTagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: appTheme.spacing.xs,
    flexShrink: 0,
  },
  lotListName: {
    flex: 1,
    color: appTheme.color.textPrimary,
    fontSize: appTheme.typography.size.sm,
    fontWeight: '700',
  },
  lotListMeta: {
    marginTop: 2,
    color: appTheme.color.textSecondary,
    fontSize: appTheme.typography.size.xs,
  },
  nearestTag: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: 'rgba(242, 201, 76, 0.26)',
    borderWidth: 1,
    borderColor: 'rgba(242, 201, 76, 0.65)',
  },
  recommendedTag: {
    backgroundColor: 'rgba(39, 174, 96, 0.28)',
    borderColor: 'rgba(39, 174, 96, 0.55)',
  },
  mostOpenTag: {
    backgroundColor: 'rgba(47, 128, 237, 0.26)',
    borderColor: 'rgba(47, 128, 237, 0.58)',
  },
  nearestTagText: {
    color: '#F8FAFC',
    fontSize: 11,
    fontWeight: '700',
  },
  recommendedTagText: {
    color: '#F8FAFC',
  },
  mostOpenTagText: {
    color: '#F8FAFC',
  },
  emptyListText: {
    paddingHorizontal: appTheme.spacing.md,
    paddingVertical: appTheme.spacing.md,
    color: appTheme.color.textSecondary,
    fontSize: appTheme.typography.size.sm,
  },
  parkingMarker: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  parkingMarkerSelected: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderColor: appTheme.color.brandGold,
    borderWidth: 2.5,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3,
    elevation: 4,
  },
  parkingMarkerIcon: {
    marginLeft: 0.5,
  },
  sheetWrapper: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
  campusLabel: {
    backgroundColor: 'transparent',
    paddingHorizontal: 0,
    paddingVertical: 0,
  },
  campusLabelText: {
    color: '#FFFFFF',
    fontSize: appTheme.typography.size.sm,
    fontWeight: '700',
    textShadowColor: 'rgba(0,0,0,0.55)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
});
