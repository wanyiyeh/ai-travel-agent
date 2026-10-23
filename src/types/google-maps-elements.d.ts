// JSX types for the Places UI Kit web components used by PlaceDetailsDialog.
import type { DetailedHTMLProps, HTMLAttributes } from "react";

type GmpElement = DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>;

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "gmp-place-details": GmpElement;
      "gmp-place-details-place-request": GmpElement & { place?: string };
      "gmp-place-all-content": GmpElement;
    }
  }
}
