// A Places API (New) photo resource name: `places/<placeId>/photos/<photoRef>`.
// Both segments are URL-safe base64-ish ids, so anything else (`../`, `?`,
// `&key=`, extra path segments) can't be a real photo name.
const PHOTO_NAME_RE = /^places\/([A-Za-z0-9_-]+)\/photos\/[A-Za-z0-9_-]+$/;
// Real names top out around 500 chars; anything much longer isn't one.
const MAX_PHOTO_NAME_LENGTH = 1024;

// The photo proxy splices this name straight into a Google URL that carries
// the server API key, so an unchecked value would let a caller point that
// keyed request at an arbitrary Places endpoint. Also requires the name to
// belong to the place in the route path, so the proxy can't be pointed at an
// unrelated place's photo under a different id.
export function isValidPhotoName(photoName: string, placeId: string): boolean {
  if (photoName.length > MAX_PHOTO_NAME_LENGTH) return false;
  const match = PHOTO_NAME_RE.exec(photoName);
  return match !== null && match[1] === placeId;
}
