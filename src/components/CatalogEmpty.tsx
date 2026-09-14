import { ButtonLink } from "./ui";

/** Shared copy for a marketplace with no published homes. No seed fiction. */
export const CATALOG_EMPTY_COPY = {
  title: "No homes are listed right now.",
  body: "The first homes will come from people who list them. If you have a place to share, you can start today.",
} as const;

/**
 * Host-led first-user actions on an empty catalog.
 * Acquisition (`/for-homeowners`) and setup (`/host/start`) are both offered.
 */
export function CatalogEmptyActions() {
  return (
    <>
      <ButtonLink to="/for-homeowners">List your home</ButtonLink>
      <ButtonLink to="/host/start" variant="secondary">
        Start your listing
      </ButtonLink>
    </>
  );
}
