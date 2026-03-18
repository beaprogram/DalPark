const hrWeights = [
    0.95, 0.95, 0.95, 0.95, 0.95, 0.90,
    0.80, 0.60, 0.35, 0.25, 0.20, 0.15,
    0.20, 0.25, 0.30, 0.35, 0.45, 0.55,
    0.65, 0.75, 0.80, 0.85, 0.90, 0.95,
];

const dayFactors = [1.0, 0.75, 0.70, 0.65, 0.70, 0.75, 0.95];

const roughWeather = new Set([
    51, 53, 55, 61, 63,
    65, 66, 67, 71, 73,
    75, 77, 80, 81, 82,
    85, 86, 95, 96, 99,
]);

export const scoreToStatus = (n) => {
    if (n > 75) return 'EMPTY';
    if (n > 50) return 'NORMAL';
    if (n > 25) return 'CROWDED';
    return 'FULL';
};

export const isEveningTime = (date = new Date()) => date.getHours() >= 17;

export const getCapacityForCurrentPeriod = (lot, date = new Date()) => {
    if (isEveningTime(date)) {
        return (lot.eveningGeneralSpaces || 0) + (lot.eveningShortTermSpaces || 0);
    }
    return (lot.generalSpaces || 0) + (lot.reservedSpaces || 0) + (lot.shortTermSpaces || 0);
};

export const predictAvailability = ({ lot, weatherCode, atDate }) => {
    const now = atDate instanceof Date ? atDate : new Date();
    const hr = now.getHours();
    const dow = now.getDay();

    let pts = hrWeights[hr] * 100;

    pts *= dayFactors[dow];

    if (roughWeather.has(weatherCode)) {
        pts *= 0.80;
    }

    const totalSpots = getCapacityForCurrentPeriod(lot, now);
    if (totalSpots > 100) {
        pts += 8;
    } else if (totalSpots < 20) {
        pts -= 10;
    }

    const score = Math.max(0, Math.min(100, Math.round(pts)));

    return { score, status: scoreToStatus(score) };
};

const FADE_MINS = 60;

const ratingToNum = (r) => (r - 1) * 25;

export const blendWithCrowdsource = (engineScore, rpt) => {
    if (!rpt || !rpt.createdAt) return engineScore;

    const ageMs = Date.now() - rpt.createdAt;
    const ageMins = ageMs / 60000;
    if (ageMins >= FADE_MINS) return engineScore;

    const w = Math.max(0, 1 - ageMins / FADE_MINS);
    const rptPts = ratingToNum(rpt.rating);

    const mixed = Math.round(w * rptPts + (1 - w) * engineScore);
    return Math.max(0, Math.min(100, mixed));
};
