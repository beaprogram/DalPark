const app = require('./app.json');

module.exports = {
  ...app,
  expo: {
    ...app.expo,
    android: {
      ...app.expo.android,
      config: {
        ...app.expo.android.config,
        googleMaps: {
          apiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || '',
        },
      },
    },
  },
};
