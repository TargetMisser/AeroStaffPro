function readStringProperty(value: unknown, property: 'message' | 'name' | 'stack'): string | undefined {
  if ((typeof value !== 'object' || value === null) && typeof value !== 'function') {
    return undefined;
  }

  try {
    const candidate = (value as Record<string, unknown>)[property];
    return typeof candidate === 'string' && candidate ? candidate : undefined;
  } catch {
    return undefined;
  }
}

export function getErrorMessage(error: unknown, fallback = 'unknown_error'): string {
  if (typeof error === 'string') {
    return error || fallback;
  }

  if (error === null || error === undefined) {
    return fallback;
  }

  const errorLikeMessage = readStringProperty(error, 'message');
  if (errorLikeMessage) return errorLikeMessage;

  const errorLikeName = readStringProperty(error, 'name');
  if (errorLikeName) return errorLikeName;

  try {
    const serialized = JSON.stringify(error);
    if (serialized) return serialized;
  } catch {
    // Circular or host-provided values can fail JSON serialization.
  }

  try {
    return String(error) || fallback;
  } catch {
    return fallback;
  }
}

export function getErrorStack(error: unknown): string {
  return readStringProperty(error, 'stack') ?? '';
}
