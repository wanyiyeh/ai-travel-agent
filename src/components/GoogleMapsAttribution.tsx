/**
 * The "Google Maps" logo required wherever Google place content (names,
 * addresses) is shown without a Google Map beside it (Places API policies,
 * "Attribution"). The official, unmodified logo: 18px tall (16–19 allowed),
 * clear space of 10px left, right and top and 5px below, gray on light
 * backgrounds, white on dark, labelled "Google Maps" for screen readers and
 * never translated. Files: public/attribution/ (Google_Maps_Attribution_Assets.zip).
 *
 * Put it near the top or bottom of the content, inside the same container.
 * Not needed on ItineraryMap: the map shows its own attribution.
 */
export default function GoogleMapsAttribution({ className = "" }: { className?: string }) {
  return (
    <div translate="no" className={`flex px-2.5 pt-2.5 pb-[5px] ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- a fixed-size logo file; next/image adds nothing here */}
      <img src="/attribution/google-maps-logo-gray.svg" alt="Google Maps" width={98} height={18} className="h-[18px] w-auto dark:hidden" data-gmaps-logo="light" />
      {/* eslint-disable-next-line @next/next/no-img-element -- see above */}
      <img src="/attribution/google-maps-logo-white.svg" alt="Google Maps" width={98} height={18} className="hidden h-[18px] w-auto dark:block" data-gmaps-logo="dark" />
    </div>
  );
}
