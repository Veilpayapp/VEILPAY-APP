-- ARCH-004: align PrivacyLevel with the app's canonical levels.
-- The consumer app's PrivacyLevel is `standard | stealth | max | private`
-- (settingsStore.ts), but the backend enum only had `standard | max`, so the
-- backend would reject a `stealth`/`private` payment the moment the app sent
-- one. This is purely additive — existing `standard`/`max` rows are untouched
-- and no privacy behavior activates; the backend stores/echoes the value.
--
-- AlterEnum
ALTER TYPE "PrivacyLevel" ADD VALUE 'stealth';
ALTER TYPE "PrivacyLevel" ADD VALUE 'private';
