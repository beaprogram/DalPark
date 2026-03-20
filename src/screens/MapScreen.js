import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated, PanResponder, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import MapView, { Circle, Marker, Polygon } from 'react-native-maps';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { STATUS_META } from '../constants/statusStyle';
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
import { predictAvailability, blendWithCrowdsource, scoreToStatus } from '../utils/engine';
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

export default function MapScreen() {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
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
  const sheetMaxHeight = Math.min(windowHeight * 0.78, 560);
  const sheetPeekHeight = Math.min(windowHeight * 0.5, 25);
  const sheetMaxOffset = Math.max(sheetMaxHeight - sheetPeekHeight, 0);
  const sheetHiddenOffset = sheetMaxHeight + 40;
  const sheetTranslateY = useRef(new Animated.Value(sheetHiddenOffset)).current;
  const sheetDragStartRef = useRef(sheetHiddenOffset);
  const pendingSheetOffsetRef = useRef(null);
  const [weather, setWeather] = useState({
    label: 'Loading weather...',
    icon: 'cloudy-outline',
    temperature: '--',
  });
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();

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

  const nearestLot = useMemo(() => {
    if (!userCoordinate || lots.length === 0) {
      return null;
    }

    // Pick the closest lot from current user location.
    return lots.reduce((currentNearest, lot) => {
      if (!currentNearest) {
        return lot;
      }

      const currentDistance = distanceMeters(userCoordinate, currentNearest.coordinate);
      const nextDistance = distanceMeters(userCoordinate, lot.coordinate);
      return nextDistance < currentDistance ? lot : currentNearest;
    }, null);
  }, [userCoordinate, lots]);

  const selectedLotDistanceMeters = useMemo(() => {
    if (!selectedLot || !userCoordinate) {
      return null;
    }
    return distanceMeters(userCoordinate, selectedLot.coordinate);
  }, [selectedLot, userCoordinate]);

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

  const searchableLots = useMemo(() => {
    // Base list: alphabetical. If user typed text, apply filtering.
    const sortedLots = [...lots].sort((left, right) => left.name.localeCompare(right.name));
    const filteredLots = normalizedSearchQuery
      ? sortedLots.filter((lot) => {
        const target = `${lot.name} ${lot.address} ${lot.campus}`.toLowerCase();
        return target.includes(normalizedSearchQuery);
      })
      : sortedLots;

    if (!nearestLot) {
      return filteredLots;
    }

    const nearestIndex = filteredLots.findIndex((lot) => lot.id === nearestLot.id);
    if (nearestIndex <= 0) {
      return filteredLots;
    }

    // Move nearest to top so users can tap it fast.
    const nextLots = [...filteredLots];
    const [nearestEntry] = nextLots.splice(nearestIndex, 1);
    nextLots.unshift(nearestEntry);
    return nextLots;
  }, [lots, nearestLot, normalizedSearchQuery]);
  const zoomDelta = Math.max(mapRegion.latitudeDelta, mapRegion.longitudeDelta);
  // Keep map clean when zoomed out. Show labels only when zoomed out enough.
  const hideParkingMarkersWhenZoomedOut = zoomDelta > 0.022;
  const showZoneLabels = zoomDelta >= 0.028;

  const lotPredictions = useMemo(() => {
    const predictions = {};
    const engineUpdatedAt = Date.now();

    lots.forEach((lot) => {
      const base = predictAvailability({ lot, weatherCode });
      const report = crowdsourceReports[lot.id];
      if (report) {
        const blended = blendWithCrowdsource(base.score, report);
        predictions[lot.id] = {
          score: blended,
          status: scoreToStatus(blended),
          updatedAt: report.createdAt,
          updatedBy: 'Crowd',
        };
      } else {
        predictions[lot.id] = {
          ...base,
          updatedAt: engineUpdatedAt,
          updatedBy: 'Engine',
        };
      }
    });
    return predictions;
  }, [lots, weatherCode, crowdsourceReports]);

  const selectedLotTimelineScores = useMemo(() => {
    if (!selectedLot) {
      return [];
    }

    const now = new Date();
    return Array.from({ length: 24 }, (_, hour) => {
      const targetDate = new Date(now);
      targetDate.setHours(hour, 0, 0, 0);
      return predictAvailability({ lot: selectedLot, weatherCode, atDate: targetDate }).score;
    });
  }, [selectedLot, weatherCode]);

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

  const handleGoToNearest = () => {
    if (!userCoordinate) {
      Alert.alert('Location Required', 'Enable location access to jump to the nearest parking lot.');
      return;
    }

    if (!nearestLot) {
      Alert.alert('No Lot Found', 'Unable to find nearby parking lots at the moment.');
      return;
    }

    handleSelectLot(nearestLot);
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

        {selectedLot ? (
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
            accessibilityLabel="Go to nearest parking lot"
            accessibilityRole="button"
            hitSlop={6}
            onPress={handleGoToNearest}
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

        {isLotListVisible ? (
          <View style={styles.lotListCard}>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              nestedScrollEnabled
              showsVerticalScrollIndicator={false}
              style={styles.lotListScroll}
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
                      {nearestLot?.id === lot.id ? (
                        <View style={styles.nearestTag}>
                          <Text style={styles.nearestTagText}>Nearest</Text>
                        </View>
                      ) : null}
                    </View>
                    <Text numberOfLines={1} style={styles.lotListMeta}>
                      {lot.campus === 'studley' ? 'Studley' : 'Sexton'} Campus | {lot.address}
                    </Text>
                  </Pressable>
                ))
              )}
            </ScrollView>
          </View>
        ) : null}
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
          dragHandleProps={sheetPanResponder.panHandlers}
          lot={selectedLot}
          predictedStatus={selectedLot ? lotPredictions[selectedLot.id] : null}
          reportDisabledMessage={reportDisabledMessage}
          scrollEnabled={false}
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
    backgroundColor: 'rgba(242, 201, 76, 0.18)',
    borderWidth: 1,
    borderColor: 'rgba(242, 201, 76, 0.5)',
  },
  nearestTagText: {
    color: appTheme.color.brandGold,
    fontSize: 11,
    fontWeight: '700',
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
