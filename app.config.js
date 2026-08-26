module.exports = {
  expo: {
    name: "Elsa Mobile",
    slug: "elsa-mobile",
    version: "1.0.0",
    orientation: "portrait",
    userInterfaceStyle: "automatic",
    ios: {
      bundleIdentifier: "com.elsa.mobile",
      supportsTablet: true
    },
    android: {
      package: "com.elsa.mobile",
      versionCode: 1
    },
    extra: {
      ELSA_API_URL: process.env.ELSA_API_URL || "https://elsa.pin-yi.uk",
      EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL || "https://elsa.pin-yi.uk",
      eas: {
        projectId: "629b1295-9746-41bd-a663-9b021fdc261e"
      }
    }
  }
};
