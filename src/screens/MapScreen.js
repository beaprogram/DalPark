import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import MapView, { Circle, Marker, Polygon } from 'react-native-maps';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { STATUS_META } from '../constants/statusStyle';
import { appTheme, componentMetrics } from '../theme/tokens';
import LotBottomSheet from '../components/map/LotBottomSheet';
import { PARKING_LOTS } from '../data/parkingLots';
import { openNavigationToCoordinate } from '../utils/navigation';

const INITIAL_REGION = {
  latitude: 44.6383,
  longitude: -63.5859,
  latitudeDelta: 0.08,
  longitudeDelta: 0.06,
};

const CAMPUS_STYLE = {
  sexton: {
    strokeColor: '#2F80ED',
    fillColor: 'rgba(47, 128, 237, 0.14)',
    label: 'Sexton',
  },
  studley: {
    strokeColor: '#F2C94C',
    fillColor: 'rgba(242, 201, 76, 0.16)',
    label: 'Studley',
  },
};

const STUDLEY_POLYGON = [
  { latitude: 44.63765, longitude: -63.59663 },
  { latitude: 44.63956, longitude: -63.58881 },
  { latitude: 44.63847, longitude: -63.58828 },
  { latitude: 44.63897, longitude: -63.58619 },
  { latitude: 44.63801, longitude: -63.58572 },
  { latitude: 44.63786, longitude: -63.58623 },
  { latitude: 44.63701, longitude: -63.58586 },
  { latitude: 44.63657, longitude: -63.58731 },
  { latitude: 44.63606, longitude: -63.58707 },
  { latitude: 44.63528, longitude: -63.59026 },
  { latitude: 44.63404, longitude: -63.58972 },
  { latitude: 44.63323, longitude: -63.59317 },
  { latitude: 44.6345, longitude: -63.59379 },
  { latitude: 44.63424, longitude: -63.59518 },
];

const SEXTON_POLYGON = [
  { latitude: 44.64088, longitude: -63.57472 },
  { latitude: 44.64226, longitude: -63.57545 },
  { latitude: 44.64253, longitude: -63.57467 },
  { latitude: 44.6435, longitude: -63.57509 },
  { latitude: 44.6437, longitude: -63.57438 },
  { latitude: 44.64342, longitude: -63.57416 },
  { latitude: 44.64345, longitude: -63.57392 },
  { latitude: 44.64326, longitude: -63.5738 },
  { latitude: 44.64348, longitude: -63.57309 },
  { latitude: 44.64309, longitude: -63.57288 },
  { latitude: 44.64329, longitude: -63.5721 },
  { latitude: 44.64176, longitude: -63.57131 },
];

const WEATHER_FALLBACK_COORDINATE = {
  latitude: 44.6488,
  longitude: -63.5752,
};

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

const polygonCentroid = (points) => {
  const sum = points.reduce(
    (acc, point) => ({
      latitude: acc.latitude + point.latitude,
      longitude: acc.longitude + point.longitude,
    }),
    { latitude: 0, longitude: 0 }
  );

  return {
    latitude: sum.latitude / points.length,
    longitude: sum.longitude / points.length,
  };
};

const toRadians = (value) => (value * Math.PI) / 180;

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
  const mapRef = useRef(null);
  const [selectedLot, setSelectedLot] = useState(PARKING_LOTS[0]);
  const [mapRegion, setMapRegion] = useState(INITIAL_REGION);
  const sheetProgress = useRef(new Animated.Value(0)).current;
  const [searchQuery, setSearchQuery] = useState('');
  const [isLotListVisible, setIsLotListVisible] = useState(true);
  const [userCoordinate, setUserCoordinate] = useState(null);
  const [weather, setWeather] = useState({
    label: 'Loading weather...',
    icon: 'cloudy-outline',
    temperature: '--',
  });
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();

  const nearestLot = useMemo(() => {
    if (!userCoordinate || PARKING_LOTS.length === 0) {
      return null;
    }

    return PARKING_LOTS.reduce((currentNearest, lot) => {
      if (!currentNearest) {
        return lot;
      }

      const currentDistance = distanceMeters(userCoordinate, currentNearest.coordinate);
      const nextDistance = distanceMeters(userCoordinate, lot.coordinate);
      return nextDistance < currentDistance ? lot : currentNearest;
    }, null);
  }, [userCoordinate]);

  const searchableLots = useMemo(() => {
    const sortedLots = [...PARKING_LOTS].sort((left, right) => left.name.localeCompare(right.name));
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

    const nextLots = [...filteredLots];
    const [nearestEntry] = nextLots.splice(nearestIndex, 1);
    nextLots.unshift(nearestEntry);
    return nextLots;
  }, [nearestLot, normalizedSearchQuery]);

  const zoomDelta = Math.max(mapRegion.latitudeDelta, mapRegion.longitudeDelta);
  const hideParkingMarkersWhenZoomedOut = zoomDelta > 0.022;
  const showCampusLabels = zoomDelta >= 0.028;
  const campusOverlays = useMemo(() => {
    const grouped = PARKING_LOTS.reduce((acc, lot) => {
      if (!acc[lot.campus]) {
        acc[lot.campus] = [];
      }
      acc[lot.campus].push(lot.coordinate);
      return acc;
    }, {});

    return Object.entries(grouped)
      .map(([campus, coordinates]) => {
        let polygon;
        if (campus === 'studley') {
          polygon = STUDLEY_POLYGON;
        } else if (campus === 'sexton') {
          polygon = SEXTON_POLYGON;
        } else {
          polygon = coordinates;
        }

        if (!polygon || polygon.length < 3) {
          return null;
        }

        return {
          campus,
          polygon,
          centroid: polygonCentroid(polygon),
          style: CAMPUS_STYLE[campus] || CAMPUS_STYLE.studley,
        };
      })
      .filter(Boolean);
  }, []);

  const loadWeather = async () => {
    try {
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

  useEffect(() => {
    Animated.timing(sheetProgress, {
      toValue: selectedLot ? 1 : 0,
      duration: 220,
      useNativeDriver: true,
    }).start();
  }, [selectedLot, sheetProgress]);

  useEffect(() => {
    loadWeather();
  }, []);

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
    if (!selectedLot) {
      return;
    }
    Alert.alert('Status Report', `Report flow for ${selectedLot.name} will open here.`);
  };

  const handleSelectLot = (lot) => {
    setSelectedLot(lot);
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

  return (
    <View style={styles.container}>
      <MapView
        initialRegion={INITIAL_REGION}
        onRegionChange={setMapRegion}
        onRegionChangeComplete={setMapRegion}
        onPress={() => {
          setSelectedLot(null);
          setIsLotListVisible(false);
        }}
        ref={mapRef}
        showsCompass={false}
        showsPointsOfInterest={false}
        showsUserLocation
        style={styles.map}
      >
        {campusOverlays.map((overlay) => (
          <Polygon
            coordinates={overlay.polygon}
            fillColor={overlay.style.fillColor}
            key={`${overlay.campus}-polygon`}
            strokeColor={overlay.style.strokeColor}
            strokeWidth={2}
            tappable={false}
            zIndex={1}
          />
        ))}

        {showCampusLabels
          ? campusOverlays.map((overlay) => (
              <Marker
                anchor={{ x: 0.5, y: 0.5 }}
                coordinate={overlay.centroid}
                key={`${overlay.campus}-label`}
                tracksViewChanges={false}
                tappable={false}
              >
                <View pointerEvents="none" style={styles.campusLabel}>
                  <Text style={styles.campusLabelText}>{overlay.style.label} Campus</Text>
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

        {PARKING_LOTS.map((lot) => {
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
                  { backgroundColor: STATUS_META[lot.lastStatus].color },
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

      <View style={[styles.topOverlay, { paddingTop: insets.top + appTheme.spacing.xs }]}>
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
                : `All lots (${searchableLots.length}/${PARKING_LOTS.length})`}
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
        style={[
          styles.sheetWrapper,
          {
            transform: [
              {
                translateY: sheetProgress.interpolate({
                  inputRange: [0, 1],
                  outputRange: [220, 0],
                }),
              },
            ],
          },
        ]}
      >
        <LotBottomSheet
          lot={selectedLot}
          onClose={() => setSelectedLot(null)}
          onNavigate={handleNavigate}
          onReport={handleReport}
          visible={Boolean(selectedLot)}
        />
      </Animated.View>
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

