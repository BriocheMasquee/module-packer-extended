export type ContentLanguage = 'en' | 'fr'
export const DEFAULT_CONTENT_LANGUAGE: ContentLanguage = 'en'

export function normalizeContentLanguage(value: unknown): ContentLanguage {
  return value === 'fr' ? 'fr' : DEFAULT_CONTENT_LANGUAGE
}

export type MeasurementSystem = 'imperial' | 'metric'
export type DefaultMeasurement = 'auto' | MeasurementSystem
export const DEFAULT_MEASUREMENT: DefaultMeasurement = 'auto'

export function normalizeDefaultMeasurement(value: unknown): DefaultMeasurement {
  return value === 'imperial' || value === 'metric' ? value : DEFAULT_MEASUREMENT
}

/** Mirrors old MPX's resolveMeasurementSystem: an explicit imperial/metric
 * choice always wins; only "auto" falls back to the content language
 * (French -> metric, everything else -> imperial). */
export function resolveMeasurementSystem(defaultMeasurement: unknown, language: unknown): MeasurementSystem {
  const normalizedDefault = normalizeDefaultMeasurement(defaultMeasurement)
  if (normalizedDefault === 'imperial' || normalizedDefault === 'metric') {
    return normalizedDefault
  }
  return normalizeContentLanguage(language) === 'fr' ? 'metric' : 'imperial'
}
