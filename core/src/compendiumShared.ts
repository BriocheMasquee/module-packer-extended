export interface ValidationIssue {
  file: string
  message: string
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isEmptyOptionalValue(value: unknown): boolean {
  return (typeof value === 'string' && value.trim() === '') || (Array.isArray(value) && value.length === 0)
}

export function stripEmptyValues(record: Record<string, unknown>, fields: readonly string[]): Record<string, unknown> {
  const cleaned = { ...record }
  for (const field of fields) {
    if (isEmptyOptionalValue(cleaned[field])) {
      delete cleaned[field]
    }
  }
  return cleaned
}

/** Strips a nested object's own empty optional fields in place, then drops
 * the whole field if nothing meaningful is left in it. */
export function stripEmptyNestedField(
  record: Record<string, unknown>,
  field: string,
  optionalFields: readonly string[],
): void {
  if (!isPlainObject(record[field])) {
    return
  }
  const cleaned = stripEmptyValues(record[field], optionalFields)
  if (Object.keys(cleaned).length === 0) {
    delete record[field]
  } else {
    record[field] = cleaned
  }
}

export const COMPENDIUM_ATTRIBUTES_OPTIONAL_FIELDS = ['measurement', 'ruleset']
