const appJson = require('./app.json');

module.exports = () => {
  const expoConfig = {
    ...appJson.expo,
  };

  const easProjectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID;
  const easUpdateUrl = process.env.EXPO_PUBLIC_EAS_UPDATE_URL;

  const extra = {
    ...(expoConfig.extra || {}),
  };

  const eas = {
    ...(extra.eas || {}),
  };

  if (easProjectId) {
    eas.projectId = easProjectId;
  } else {
    delete eas.projectId;
  }

  if (Object.keys(eas).length > 0) {
    extra.eas = eas;
  } else {
    delete extra.eas;
  }

  if (Object.keys(extra).length > 0) {
    expoConfig.extra = extra;
  } else {
    delete expoConfig.extra;
  }

  expoConfig.updates = {
    ...(expoConfig.updates || {}),
    ...(easUpdateUrl ? { url: easUpdateUrl } : {}),
  };

  return expoConfig;
};
